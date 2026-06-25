import { useState } from 'react';
import type { ConnectorSettingsDto, TestConnectorBody } from '@shared/schemas/connectors';
import { useUpdateConnectors, useTestConnector } from '../hooks';
import { Button } from '../components/Button';
import { CheckIcon, SendIcon, SlidersIcon, ServerIcon } from '../components/icons';
import { Field, SectionHeader, SettingsCard } from './settings-ui';
import { inputCls, secretPlaceholder } from './settings-fields';
import { initNarratorr, buildNarratorr, isNarratorrDirty, isPublicUrlDirty } from './settings-narratorr';
import {
  initDefaultQuota,
  buildDefaultQuota,
  isDefaultQuotaDirty,
  isLimitValid,
  daysLabel,
  QUOTA_UNITS,
  type QuotaUnit,
} from './settings-default-quota';

// The General + Narratorr connection sections. Each owns its form state and saves
// independently (per-card save), seeded from its own slice of the settings DTO — the
// parent keys each on that slice so a save reseeds only the saved card. The Save button
// renders only when the card is dirty (mirroring narratorr's `{isDirty && <Save/>}`); no
// "unsaved" label. `useUpdateConnectors` is omit-to-keep, so sending only `publicUrl` or
// only `narratorr` leaves the other untouched.

/** Primary Save button shown only when a card is dirty. */
function SaveButton({ pending }: { pending: boolean }) {
  return (
    <Button variant="primary" size="sm" icon={CheckIcon} loading={pending} type="submit">
      Save
    </Button>
  );
}

// The General section: the section header over two independently-saved cards (Public URL +
// Default request quota). Each card is keyed on its own slice of the DTO so a save reseeds
// only that card (per-card save, mirroring the Narratorr section).
export function GeneralSection({
  publicUrl,
  defaultQuota,
}: {
  publicUrl: ConnectorSettingsDto['publicUrl'];
  defaultQuota: ConnectorSettingsDto['defaultQuota'];
}) {
  return (
    <div className="flex flex-col gap-5">
      <SectionHeader icon={SlidersIcon} title="General" subtitle="App-wide settings for this install." />
      <PublicUrlCard key={publicUrl ?? ''} saved={publicUrl} />
      <DefaultQuotaCard key={JSON.stringify(defaultQuota)} saved={defaultQuota} />
    </div>
  );
}

function PublicUrlCard({ saved }: { saved: string | null }) {
  const update = useUpdateConnectors();
  const [publicUrl, setPublicUrl] = useState(saved ?? '');
  const dirty = isPublicUrlDirty(publicUrl, saved);

  function save() {
    update.mutate({ publicUrl: publicUrl.trim() || null });
  }

  return (
    <SettingsCard delay="60ms">
      <form
        className="flex flex-col gap-4 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field
          label="Public URL"
          hint="Where this app is reached (e.g. https://requests.example.com). Used to deep-link notifications to the queue."
        >
          <input
            className={inputCls}
            value={publicUrl}
            onChange={(e) => setPublicUrl(e.target.value)}
            placeholder="https://requests.example.com"
          />
        </Field>
        {dirty && (
          <div className="flex justify-end">
            <SaveButton pending={update.isPending} />
          </div>
        )}
      </form>
    </SettingsCard>
  );
}

// The default request quota: a number (the limit) + a day/week/month unit, reading like
// "3 requests per [week]". Blank/0 → unlimited. The window unit maps to a fixed rolling-window
// day count, shown as a `= N days` hint. Pure decision logic lives in settings-default-quota.ts.
function DefaultQuotaCard({ saved }: { saved: ConnectorSettingsDto['defaultQuota'] }) {
  const update = useUpdateConnectors();
  const initial = initDefaultQuota(saved);
  const [quota, setQuota] = useState(initial);
  const dirty = isDefaultQuotaDirty(quota, initial);
  const valid = isLimitValid(quota.limit);

  function save() {
    if (!valid) return;
    update.mutate({ defaultQuota: buildDefaultQuota(quota) });
  }

  return (
    <SettingsCard delay="120ms">
      <form
        className="flex flex-col gap-4 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field
          label="Default request quota"
          hint="Applies only to users without a per-user quota override (overrides set on the Users page still win). Admins are always unlimited. Here 0 (or blank) means no cap / unlimited — the opposite of the per-user field on the Users page, where 0 blocks all requests."
          error={valid ? undefined : 'Enter a whole number, or leave blank for unlimited.'}
        >
          <div className="flex flex-wrap items-center gap-3">
            <input
              className={`${inputCls} w-24`}
              inputMode="numeric"
              value={quota.limit}
              onChange={(e) => setQuota((s) => ({ ...s, limit: e.target.value }))}
              placeholder="∞"
              aria-label="Request limit (blank for unlimited)"
            />
            <span className="text-sm text-muted-foreground">requests per</span>
            <select
              className={`${inputCls} w-32 capitalize`}
              value={quota.unit}
              onChange={(e) => setQuota((s) => ({ ...s, unit: e.target.value as QuotaUnit }))}
              aria-label="Quota window"
            >
              {QUOTA_UNITS.map((u) => (
                <option key={u} value={u} className="capitalize">
                  {u}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground/70">{daysLabel(quota.unit)}</span>
          </div>
        </Field>
        {dirty && valid && (
          <div className="flex justify-end">
            <SaveButton pending={update.isPending} />
          </div>
        )}
      </form>
    </SettingsCard>
  );
}

export function NarratorrSection({ saved }: { saved: ConnectorSettingsDto['narratorr'] }) {
  const update = useUpdateConnectors();
  const test = useTestConnector();
  const initial = initNarratorr(saved);
  const [narr, setNarr] = useState(initial);
  const dirty = isNarratorrDirty(narr, initial);

  const testBody: TestConnectorBody = { channel: 'narratorr', narratorr: buildNarratorr(narr) };

  function save() {
    update.mutate({ narratorr: buildNarratorr(narr) });
  }

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        icon={ServerIcon}
        title="Narratorr"
        subtitle="The library this app sends approved requests to."
      />
      <SettingsCard delay="60ms">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="flex flex-col gap-4 p-5">
            <Field label="Server URL" hint="Full base URL, including scheme (e.g. http://narratorr:3000). Blank it and save to disconnect.">
              <input
                className={inputCls}
                value={narr.url}
                onChange={(e) => setNarr((s) => ({ ...s, url: e.target.value }))}
                placeholder="http://narratorr:3000"
              />
            </Field>
            <Field
              label="API key"
              hint={narr.hasKey ? 'Leave blank to keep the current key.' : 'From narratorr → Settings → API.'}
            >
              <input
                className={inputCls}
                type="password"
                autoComplete="off"
                value={narr.key}
                onChange={(e) => setNarr((s) => ({ ...s, key: e.target.value }))}
                placeholder={secretPlaceholder(narr.hasKey, true)}
              />
            </Field>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-border/50 px-5 py-4">
            <Button
              variant="secondary"
              size="sm"
              icon={SendIcon}
              type="button"
              loading={test.isPending}
              onClick={() => test.mutate(testBody)}
            >
              Test
            </Button>
            {dirty && <SaveButton pending={update.isPending} />}
          </div>
        </form>
      </SettingsCard>
    </div>
  );
}
