/**
 * Whether an error is a SQLite unique-constraint breach, as surfaced by libSQL.
 *
 * Shared by the insert-time race-resolution catch in both `RequestService` and
 * `UserService`: when the partial-unique index fires between a preflight de-dupe and
 * the insert, the catch re-queries and resolves to the existing row instead of
 * creating a duplicate. Both services classify the breach the same way, so the check
 * lives here once (DRY).
 *
 * A `RangeError` is short-circuited to `false`: it's a programmer/value error (e.g. a
 * value out of range), never a constraint breach, and must not be swallowed by the
 * race-resolution path. Non-`Error` throws are stringified so they classify without
 * throwing.
 *
 * NOTE: the `SQLITE_CONSTRAINT` arm is intentionally broad — it also matches FK / CHECK
 * / NOT-NULL breaches, not only `SQLITE_CONSTRAINT_UNIQUE`. Narrowing it (to route only
 * unique breaches into the re-query path) would be a deliberate, test-visible change.
 */
export function isUniqueViolation(err: unknown): boolean {
  if (err instanceof RangeError) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return /UNIQUE constraint failed/i.test(msg) || /SQLITE_CONSTRAINT/i.test(msg);
}
