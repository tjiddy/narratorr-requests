import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { USER_ROLES } from '../shared/schemas/user.js';
import { REQUEST_STATUSES, ACTIVE_REQUEST_STATUSES } from '../shared/schemas/request.js';

// ============ USERS ============
// Identity is owned here, keyed on Plex (plexId). The dev-admin (AUTH_BYPASS)
// is a real row with a sentinel plexId so request creation always runs against a
// genuine user boundary (Codex risk #1), never a retrofitted fake.
export const users = sqliteTable(
  'users',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    publicId: text('public_id').notNull().unique(), // us_...
    // External identity — exactly one is set per user. Plex covers family/requesters;
    // Authelia covers the operator's admin SSO. Both nullable + unique (SQLite allows
    // multiple NULLs). `plexUsername` holds the display name for either provider.
    plexId: text('plex_id').unique(),
    autheliaSubject: text('authelia_subject').unique(),
    plexUsername: text('plex_username').notNull(),
    email: text('email'),
    thumb: text('thumb'),
    role: text('role', { enum: USER_ROLES }).notNull().default('user'),
    // Per-user override of the app default. null = unlimited.
    requestQuota: integer('request_quota'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [index('idx_users_plex_username').on(table.plexUsername)],
);

// ============ REQUESTS ============
export const requests = sqliteTable(
  'requests',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    publicId: text('public_id').notNull().unique(), // rq_...
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    asin: text('asin').notNull(),
    // Snapshot of the catalog entry at request time — keeps the queue renderable
    // even if upstream metadata changes.
    title: text('title').notNull(),
    author: text('author'),
    narrator: text('narrator'),
    coverUrl: text('cover_url'),
    status: text('status', { enum: REQUEST_STATUSES }).notNull().default('pending'),
    // Handoff linkage into Narratorr: the library book we added + poll
    // (nullable until approved + handed off).
    narratorrBookId: text('narratorr_book_id'), // bk_...
    note: text('note'),
    // Quota accounting: a `failed` request is normally refunded, EXCEPT when the
    // failure was the user's fault (PLAN decision #5). Defaults false.
    userCausedFailure: integer('user_caused_failure', { mode: 'boolean' }).notNull().default(false),
    failureReason: text('failure_reason'),
    requestedAt: integer('requested_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    decidedAt: integer('decided_at', { mode: 'timestamp' }),
    decidedBy: integer('decided_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (table) => [
    index('idx_requests_user_id').on(table.userId),
    index('idx_requests_status').on(table.status),
    index('idx_requests_asin').on(table.asin),
    // Dedupe guard: at most ONE active request per (user, asin). We scope to the
    // user (not globally) because this is multi-user — two people may both want a
    // book; global dedupe is handled downstream by Narratorr's idempotent
    // ASIN-keyed acquisition. Deviates from PLAN's literal "unique(asin)" with
    // cause: a global guard would wrongly block a second requester. Re-requesting
    // after denied/failed/available is allowed (those aren't "active").
    uniqueIndex('idx_requests_user_asin_active')
      .on(table.userId, table.asin)
      .where(sql`status IN ('${sql.raw(ACTIVE_REQUEST_STATUSES.join("','"))}')`),
  ],
);

// ============ APP SETTINGS ============
// Singleton (id = 1). Seeded from config on first boot.
export const appSettings = sqliteTable('app_settings', {
  id: integer('id').primaryKey(),
  // null = unlimited. Overrides config.defaultRequestQuota once set in-app.
  defaultQuota: integer('default_quota'),
  // Which roles are auto-approved on request create. MVP: ['admin'].
  autoApproveRoles: text('auto_approve_roles', { mode: 'json' })
    .notNull()
    .$type<string[]>()
    .default(sql`'["admin"]'`),
  // Free-form notification config (placeholder for fast-follow).
  notifyConfig: text('notify_config', { mode: 'json' }).$type<Record<string, unknown>>(),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type RequestRow = typeof requests.$inferSelect;
export type NewRequestRow = typeof requests.$inferInsert;
export type AppSettingsRow = typeof appSettings.$inferSelect;
