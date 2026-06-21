import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestDto } from '@shared/schemas/request';
import type { UserDto } from '@shared/schemas/user';
import type { ConnectorSettingsDto, TestConnectorResult } from '@shared/schemas/connectors';

// Node-only hook testing — no render harness. We mock @tanstack/react-query so
// `useMutation` returns the options object passed to it (so the hook hands us its
// onSuccess/onError callbacks directly) and `useQueryClient` returns a fake client
// of spies. `sonner`'s toast is spied so we can assert the surfaced text.
const hoisted = vi.hoisted(() => ({
  qc: { invalidateQueries: vi.fn(), setQueryData: vi.fn() },
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: (options: unknown) => options,
  useQuery: () => ({}),
  useQueryClient: () => hoisted.qc,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from 'sonner';
import {
  qk,
  useRequestBook,
  useUpdateUser,
  useDecide,
  useUpdateConnectors,
  useTestConnector,
} from './hooks';
import { ApiError } from './api';

const success = vi.mocked(toast.success);
const error = vi.mocked(toast.error);

// The mocked `useMutation` returns the raw options object, but its declared return
// type is `UseMutationResult` (no onSuccess/onError). Cast to the callbacks we drive.
interface Callbacks {
  onSuccess: (...args: any[]) => unknown;
  onError: (...args: any[]) => unknown;
}
const cb = (hook: unknown): Callbacks => hook as Callbacks;

// Minimal cast helpers — the callbacks only read the few fields we set.
const req = (over: Partial<RequestDto>): RequestDto => ({ title: 'Dune', status: 'pending', ...over } as RequestDto);

beforeEach(() => vi.clearAllMocks());

describe('qk query-key builders', () => {
  it('builds the static and parameterized keys', () => {
    expect(qk.me).toEqual(['me']);
    expect(qk.myRequests).toEqual(['requests', 'mine']);
    expect(qk.search('')).toEqual(['search', '']);
    expect(qk.search('a')).toEqual(['search', 'a']);
    expect(qk.search('')).not.toEqual(qk.search('a'));
  });

  it('collapses an absent admin-queue status to "all"', () => {
    expect(qk.adminQueue(undefined)).toEqual(['admin', 'requests', 'all']);
    expect(qk.adminQueue('pending')).toEqual(['admin', 'requests', 'pending']);
  });
});

describe('useRequestBook', () => {
  it('toasts "already available" and invalidates myRequests + me on an available result', () => {
    cb(useRequestBook()).onSuccess(req({ status: 'available', title: 'Dune' }));
    expect(success).toHaveBeenCalledWith('“Dune” is already available!');
    expect(hoisted.qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.myRequests });
    expect(hoisted.qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.me });
    // Keys must equal the qk definitions verbatim (no drift).
    expect(hoisted.qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['requests', 'mine'] });
    expect(hoisted.qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['me'] });
  });

  it('toasts "Requested" for a non-available result', () => {
    cb(useRequestBook()).onSuccess(req({ status: 'pending', title: 'Dune' }));
    expect(success).toHaveBeenCalledWith('Requested “Dune”');
  });

  it('surfaces an ApiError message, else the generic fallback, on error', () => {
    const h = cb(useRequestBook());
    h.onError(new ApiError(400, 'BAD', 'boom'));
    expect(error).toHaveBeenCalledWith('boom');
    h.onError(new Error('raw'));
    expect(error).toHaveBeenCalledWith('Request failed');
  });
});

describe('useDecide', () => {
  it('toasts Approved/Denied with curly quotes and invalidates the admin-requests prefix', () => {
    const h = cb(useDecide());
    h.onSuccess(req({ title: 'Dune' }), { action: 'approve' });
    expect(success).toHaveBeenCalledWith('Approved “Dune”');
    h.onSuccess(req({ title: 'Dune' }), { action: 'deny' });
    expect(success).toHaveBeenCalledWith('Denied “Dune”');
    // DRY-1 guard: the hardcoded invalidation tuple must match qk.adminQueue's prefix.
    expect(hoisted.qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['admin', 'requests'] });
    expect(qk.adminQueue(undefined).slice(0, 2)).toEqual(['admin', 'requests']);
  });

  it('surfaces ApiError message, else "Action failed", on error', () => {
    const h = cb(useDecide());
    h.onError(new ApiError(409, 'C', 'conflict'));
    expect(error).toHaveBeenCalledWith('conflict');
    h.onError(new Error('x'));
    expect(error).toHaveBeenCalledWith('Action failed');
  });
});

describe('useUpdateUser', () => {
  const user = { username: 'todd' } as UserDto;

  it('toasts the saved username and invalidates admin/users', () => {
    cb(useUpdateUser()).onSuccess(user);
    expect(success).toHaveBeenCalledWith('Saved changes to todd');
    expect(hoisted.qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['admin', 'users'] });
  });

  it('surfaces ApiError message, else "Failed to update user", on error', () => {
    const h = cb(useUpdateUser());
    h.onError(new ApiError(400, 'B', 'bad patch'));
    expect(error).toHaveBeenCalledWith('bad patch');
    h.onError(new Error('x'));
    expect(error).toHaveBeenCalledWith('Failed to update user');
  });
});

describe('useUpdateConnectors', () => {
  const dto = { publicUrl: null } as ConnectorSettingsDto;

  it('writes the connectors cache directly (not invalidate) and toasts "Settings saved"', () => {
    cb(useUpdateConnectors()).onSuccess(dto);
    expect(hoisted.qc.setQueryData).toHaveBeenCalledWith(['admin', 'settings', 'connectors'], dto);
    expect(success).toHaveBeenCalledWith('Settings saved');
    expect(hoisted.qc.invalidateQueries).not.toHaveBeenCalled();
  });

  it('surfaces ApiError message, else "Save failed", on error', () => {
    const h = cb(useUpdateConnectors());
    h.onError(new ApiError(422, 'V', 'invalid url'));
    expect(error).toHaveBeenCalledWith('invalid url');
    h.onError(new Error('x'));
    expect(error).toHaveBeenCalledWith('Save failed');
  });
});

describe('useTestConnector', () => {
  it('routes a success result to toast.success and a failure to toast.error', () => {
    const h = cb(useTestConnector());
    h.onSuccess({ success: true, message: 'Connected' } as TestConnectorResult);
    expect(success).toHaveBeenCalledWith('Connected');
    h.onSuccess({ success: false, message: 'Unauthorized' } as TestConnectorResult);
    expect(error).toHaveBeenCalledWith('Unauthorized');
  });

  it('surfaces ApiError message, else "Test failed", on error', () => {
    const h = cb(useTestConnector());
    h.onError(new ApiError(500, 'E', 'upstream down'));
    expect(error).toHaveBeenCalledWith('upstream down');
    h.onError(new Error('x'));
    expect(error).toHaveBeenCalledWith('Test failed');
  });
});
