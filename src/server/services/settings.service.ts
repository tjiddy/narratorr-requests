import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { appSettings, type AppSettingsRow } from '../../db/schema.js';

const SINGLETON_ID = 1;

/** Seeded onto a fresh/empty settings row — the default request quota (limit + rolling window).
 *  The quota is now admin-editable in Settings, so these are just sane out-of-the-box values
 *  (no longer sourced from env). 10 requests per rolling 30 days. */
const SEED_DEFAULT_QUOTA = 10;
const SEED_QUOTA_WINDOW_DAYS = 30;

export class SettingsService {
  constructor(private readonly db: Db) {}

  /** Get the singleton settings row, creating it (seeded with the default quota) if absent. */
  async ensure(): Promise<AppSettingsRow> {
    const existing = await this.db.query.appSettings.findFirst({
      where: eq(appSettings.id, SINGLETON_ID),
    });
    if (existing) return existing;

    await this.db
      .insert(appSettings)
      .values({
        id: SINGLETON_ID,
        defaultQuota: SEED_DEFAULT_QUOTA,
        defaultQuotaWindowDays: SEED_QUOTA_WINDOW_DAYS,
        autoApproveRoles: ['admin'],
      })
      .onConflictDoNothing();

    const row = await this.db.query.appSettings.findFirst({
      where: eq(appSettings.id, SINGLETON_ID),
    });
    if (!row) throw new Error('failed to create app_settings singleton');
    return row;
  }

  async get(): Promise<AppSettingsRow | undefined> {
    return this.db.query.appSettings.findFirst({ where: eq(appSettings.id, SINGLETON_ID) });
  }
}
