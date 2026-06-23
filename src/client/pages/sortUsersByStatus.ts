import type { UserDto } from '@shared/schemas/user';

// Pure ordering for the Users list, pulled out of UsersPage so the status-priority
// decision is unit-testable without a DOM (vitest node env), matching the helper
// pattern in quota-display.ts / parseQuota.ts / settings-*.ts.
//
// Surface pending users first (the admin's action list), then active, then rejected.
export const STATUS_ORDER: Record<UserDto['status'], number> = { pending: 0, active: 1, rejected: 2 };

// Returns a new array sorted by status priority. Sort is stable within an equal
// status (JS Array.prototype.sort is stable), so the server's secondary order
// (oldest-first) is preserved within each band. Does not mutate the input.
export function sortUsersByStatus(users: readonly UserDto[]): UserDto[] {
  return [...users].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
}
