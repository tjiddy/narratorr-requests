import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { appSettings, type AppSettingsRow } from '../../db/schema.js';

const SINGLETON_ID = 1;

export class SettingsService {
  constructor(private readonly db: Db) {}

  /** Get the singleton settings row, creating it (seeded with `seedDefaultQuota`) if absent. */
  async ensure(seedDefaultQuota: number | null): Promise<AppSettingsRow> {
    const existing = await this.db.query.appSettings.findFirst({
      where: eq(appSettings.id, SINGLETON_ID),
    });
    if (existing) return existing;

    await this.db
      .insert(appSettings)
      .values({ id: SINGLETON_ID, defaultQuota: seedDefaultQuota, autoApproveRoles: ['admin'] })
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
