import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '../services/deps.js';
import {
  connectorSettingsDtoSchema,
  notifierDtoSchema,
  updateConnectorSettingsBodySchema,
  createNotifierBodySchema,
  updateNotifierBodySchema,
  notifierTestBodySchema,
  testConnectorBodySchema,
  testConnectorResultSchema,
} from '../../shared/schemas/connectors.js';
import type { TestConnectorResult } from '../../shared/schemas/connectors.js';
import { requireAdmin } from '../plugins/auth.js';
import { NarratorrClient, NarratorrError } from '../services/narratorr-client.js';
import { Mutex } from '../util/mutex.js';
import {
  buildNotifier,
  buildNotifierChannel,
  render,
  type NotificationEvent,
  type NotificationPayload,
  type SendContext,
} from '../services/notifications/index.js';

function describeNarratorrError(err: unknown): string {
  if (err instanceof NarratorrError) {
    if (err.upstreamStatus === 0) return 'Could not reach narratorr — check the URL.';
    if (err.upstreamStatus === 401 || err.upstreamStatus === 403) return 'Authentication failed — check the API key.';
    return `narratorr responded ${err.upstreamStatus}.`;
  }
  return err instanceof Error ? err.message : 'Unknown error';
}

/** The sample payload for an event — so Test exercises the event the notifier is configured for. */
function samplePayload(event: NotificationEvent): NotificationPayload {
  switch (event) {
    case 'request.created':
      return {
        event: 'request.created',
        request: { publicId: 'rq_test', title: 'Test notification', author: 'narratorr-request', asin: 'TEST', coverUrl: null },
        requester: { username: '(settings test)' },
      };
    case 'user.pending':
      return {
        event: 'user.pending',
        user: { publicId: 'us_test', username: '(settings test)', email: null, authProvider: 'local' },
      };
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

/** A sample event rendered with the given public URL, for a Test probe. */
function testContext(event: NotificationEvent, publicUrl: string | null): SendContext {
  const payload = samplePayload(event);
  // Render via the real renderer so a test notification matches production formatting.
  return { payload, message: render(payload, publicUrl) };
}

const idParams = z.object({ id: z.string().min(1) });
const okSchema = z.object({ ok: z.literal(true) });

export function registerSettingsRoutes(app: FastifyInstance, deps: AppDeps): void {
  const a = app.withTypeProvider<ZodTypeProvider>();

  // ONE in-process mutex serializes ALL connector/notifier writes. The critical section
  // wraps the whole read-modify-write + reconfigure(), and covers BOTH the notifier
  // mutations and the /connectors PUT — they share the single app_settings.connectors
  // JSON blob, so an unserialized overlap would lose a change. (Multi-process would need
  // DB-level locking instead — see Mutex.)
  const writeLock = new Mutex();

  // Rebuild the live narratorr client + notifier from the freshly-saved DB settings.
  async function reconfigure(): Promise<void> {
    const ncfg = await deps.connectorSettings.getNarratorrConfig();
    deps.narratorr.set(ncfg ? new NarratorrClient({ baseUrl: ncfg.url, apiKey: ncfg.apiKey }) : null);
    deps.notifier = buildNotifier(await deps.connectorSettings.getNotificationsConfig(), app.log);
  }

  a.get(
    '/api/admin/settings/connectors',
    { schema: { response: { 200: connectorSettingsDtoSchema } } },
    async (request) => {
      requireAdmin(request);
      return deps.connectorSettings.getDto();
    },
  );

  a.put(
    '/api/admin/settings/connectors',
    { schema: { body: updateConnectorSettingsBodySchema, response: { 200: connectorSettingsDtoSchema } } },
    async (request) => {
      requireAdmin(request);
      return writeLock.run(async () => {
        await deps.connectorSettings.update(request.body);
        await reconfigure();
        return deps.connectorSettings.getDto();
      });
    },
  );

  // ---- Notifier CRUD (per-notifier; all admin, all through the write mutex) ----
  a.post(
    '/api/admin/settings/notifiers',
    { schema: { body: createNotifierBodySchema, response: { 200: notifierDtoSchema } } },
    async (request) => {
      requireAdmin(request);
      return writeLock.run(async () => {
        const created = await deps.connectorSettings.createNotifier(request.body);
        await reconfigure();
        // Return the freshly-created notifier from the masked DTO list (no secret leak),
        // matched by its assigned id — not by array position, which is brittle against any
        // future reorder/filter in getDto() (the update route already returns by id).
        const dto = await deps.connectorSettings.getDto();
        return dto.notifiers.find((n) => n.id === created.id)!;
      });
    },
  );

  a.put(
    '/api/admin/settings/notifiers/:id',
    { schema: { params: idParams, body: updateNotifierBodySchema, response: { 200: notifierDtoSchema } } },
    async (request) => {
      requireAdmin(request);
      const { id } = request.params;
      return writeLock.run(async () => {
        await deps.connectorSettings.updateNotifier(id, request.body);
        await reconfigure();
        const dto = await deps.connectorSettings.getDto();
        return dto.notifiers.find((n) => n.id === id)!;
      });
    },
  );

  a.delete(
    '/api/admin/settings/notifiers/:id',
    { schema: { params: idParams, response: { 200: okSchema } } },
    async (request) => {
      requireAdmin(request);
      const { id } = request.params;
      return writeLock.run(async () => {
        await deps.connectorSettings.deleteNotifier(id);
        await reconfigure();
        return { ok: true as const };
      });
    },
  );

  // Fire a sample notification through the CANDIDATE (current, unsaved) notifier values —
  // so Test confirms config BEFORE a save. Edit (id present) → unchanged secrets fall back
  // to the stored value; the path NEVER persists. Always 200 { success, message } — a
  // failed probe is a result, not an HTTP error. The write mutex is held ONLY around
  // candidate-config building (it resolves omit-to-keep secrets from the stored row); the
  // outbound send() runs OUTSIDE the lock so a slow/dead endpoint can't block Save/Delete/Create.
  a.post(
    '/api/admin/settings/notifiers/test',
    { schema: { body: notifierTestBodySchema, response: { 200: testConnectorResultSchema } } },
    async (request): Promise<TestConnectorResult> => {
      requireAdmin(request);
      const body = request.body;
      let channel;
      try {
        // Secret resolution reads stored state → serialize it. Channel construction reads no
        // DB state, so building it here (still inside the try) needs no lock.
        const candidate = await writeLock.run(() => deps.connectorSettings.buildCandidateNotifier(body));
        channel = buildNotifierChannel(candidate.type, candidate.config);
      } catch (err) {
        // A bad candidate (e.g. a required secret that won't resolve) is a failed test.
        return { success: false, message: err instanceof Error ? err.message : 'Unknown error' };
      }
      if (!channel) return { success: false, message: `${body.type} is not configured.` };
      try {
        await channel.send(testContext(body.event, body.publicUrl ?? null));
        return { success: true, message: 'Test notification sent.' };
      } catch (err) {
        return { success: false, message: err instanceof Error ? err.message : 'Unknown error' };
      }
    },
  );

  // Test the narratorr connection (its own card; the /connectors PUT persists it). Probes
  // the candidate (unsaved) discrete fields, omit-to-keep apiKey. Always 200. The write mutex
  // wraps ONLY the candidate-config build (resolves the stored apiKey); the ping() runs OUTSIDE
  // the lock so a slow/dead narratorr can't block a concurrent Save/Delete/Create write.
  a.post(
    '/api/admin/settings/connectors/test',
    { schema: { body: testConnectorBodySchema, response: { 200: testConnectorResultSchema } } },
    async (request): Promise<TestConnectorResult> => {
      requireAdmin(request);
      const body = request.body;
      const cfg = await writeLock.run(() => deps.connectorSettings.buildCandidateNarratorrConfig(body.narratorr));
      if (!cfg) return { success: false, message: 'Narratorr is not configured.' };
      try {
        await new NarratorrClient({ baseUrl: cfg.url, apiKey: cfg.apiKey }).ping();
        return { success: true, message: 'Connected to narratorr.' };
      } catch (err) {
        return { success: false, message: describeNarratorrError(err) };
      }
    },
  );
}
