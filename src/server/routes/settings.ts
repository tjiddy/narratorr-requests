import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { AppDeps } from '../services/deps.js';
import {
  connectorSettingsDtoSchema,
  updateConnectorSettingsBodySchema,
  testConnectorBodySchema,
  testConnectorResultSchema,
} from '../../shared/schemas/connectors.js';
import type { TestConnectorResult } from '../../shared/schemas/connectors.js';
import { requireAdmin } from '../plugins/auth.js';
import { NarratorrClient, NarratorrError } from '../services/narratorr-client.js';
import {
  buildNotifier,
  buildChannel,
  render,
  type NotificationsConfig,
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

function testContext(cfg: NotificationsConfig): SendContext {
  const payload: NotificationPayload = {
    event: 'request.created',
    request: { publicId: 'rq_test', title: 'Test notification', author: 'narratorr-request', asin: 'TEST', coverUrl: null },
    requester: { username: '(settings test)' },
  };
  // Render via the real renderer so a test notification matches production formatting.
  return { payload, message: render(payload, cfg.publicUrl) };
}

export function registerSettingsRoutes(app: FastifyInstance, deps: AppDeps): void {
  const a = app.withTypeProvider<ZodTypeProvider>();

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
      await deps.connectorSettings.update(request.body);
      await reconfigure();
      return deps.connectorSettings.getDto();
    },
  );

  // Fire a live probe against the SAVED config for one connector. Always returns 200
  // with { success, message } — a failed test is a result, not an HTTP error.
  a.post(
    '/api/admin/settings/connectors/test',
    { schema: { body: testConnectorBodySchema, response: { 200: testConnectorResultSchema } } },
    async (request): Promise<TestConnectorResult> => {
      requireAdmin(request);
      const { channel } = request.body;

      if (channel === 'narratorr') {
        const cfg = await deps.connectorSettings.getNarratorrConfig();
        if (!cfg) return { success: false, message: 'Narratorr is not configured.' };
        try {
          await new NarratorrClient({ baseUrl: cfg.url, apiKey: cfg.apiKey }).ping();
          return { success: true, message: 'Connected to narratorr.' };
        } catch (err) {
          return { success: false, message: describeNarratorrError(err) };
        }
      }

      const cfg = await deps.connectorSettings.getNotificationsConfig();
      const ch = buildChannel(channel, cfg);
      if (!ch) return { success: false, message: `${channel} is not configured.` };
      try {
        await ch.send(testContext(cfg));
        return { success: true, message: 'Test notification sent.' };
      } catch (err) {
        return { success: false, message: err instanceof Error ? err.message : 'Unknown error' };
      }
    },
  );
}
