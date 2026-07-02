import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { V1AudibleResult } from '@shared/schemas/v1/metadata';
import type { RequestStatus } from '@shared/schemas/request';
import type { UpdateUserBody } from '@shared/schemas/user';
import type {
  UpdateConnectorSettingsBody,
  TestConnectorBody,
  CreateNotifierBody,
  UpdateNotifierBody,
  NotifierTestBody,
} from '@shared/schemas/connectors';
import {
  getMe,
  searchCatalog,
  listMyRequests,
  listAdminQueue,
  requestBookFrom,
  decideRequest,
  listUsers,
  updateUser,
  listUserRequests,
  getConnectorSettings,
  getSystemInfo,
  updateConnectorSettings,
  testConnector,
  createNotifier,
  updateNotifier,
  deleteNotifier,
  testNotifier,
  getAuthProviders,
  localLogin,
  localSignup,
  ApiError,
} from './api';

export const qk = {
  me: ['me'] as const,
  search: (q: string) => ['search', q] as const,
  // The bare `['requests','mine']` key is the stable default-first-page variant Search
  // reads (and the invalidation prefix); the paged views key on their growing `limit`
  // under it, so invalidating the prefix still refreshes every loaded page.
  myRequests: ['requests', 'mine'] as const,
  myRequestsPaged: (limit: number) => ['requests', 'mine', 'paged', limit] as const,
  // The bare `['admin','requests']` prefix a decide-mutation invalidates; the queue
  // variants key their `status`/`limit` under it, so invalidating the prefix refetches
  // every loaded admin-queue page.
  adminRequests: ['admin', 'requests'] as const,
  adminQueue: (status?: RequestStatus) => ['admin', 'requests', status ?? 'all'] as const,
  adminQueuePaged: (status: RequestStatus | undefined, limit: number) =>
    ['admin', 'requests', status ?? 'all', limit] as const,
  // The bare `['admin','users']` prefix (user list + the per-user request lists nest
  // under it); an update invalidates the prefix so both refresh together.
  users: ['admin', 'users'] as const,
  userRequests: (publicId: string, limit: number) =>
    ['admin', 'users', publicId, 'requests', limit] as const,
  // The connectors settings blob — one entry shared by the query, its optimistic
  // setQueryData write, and the notifier mutations that invalidate it. These must agree
  // byte-for-byte or save → cache-write → invalidate silently no-ops.
  connectors: ['admin', 'settings', 'connectors'] as const,
  system: ['admin', 'system'] as const,
  authProviders: ['auth', 'providers'] as const,
};

export const useMe = () =>
  useQuery({ queryKey: qk.me, queryFn: getMe, retry: false, staleTime: 60_000 });

export const useSearch = (q: string) =>
  useQuery({
    queryKey: qk.search(q),
    queryFn: () => searchCatalog(q),
    enabled: q.trim().length > 0,
    staleTime: 60_000,
  });

/** The caller's default first page — the request set Search badges against. Kept bare
 *  (no limit/offset) so it reads exactly what it did before paging landed. */
export const useMyRequests = () =>
  useQuery({ queryKey: qk.myRequests, queryFn: () => listMyRequests(), refetchInterval: 4000 });

/** My Requests list view — a bounded growing-limit page, polled so `acquiring → available`
 *  transitions show up live. `keepPreviousData` holds the loaded rows on-screen while a
 *  larger page fetches, so "Load more" (and each poll at a stable limit) never blanks the list. */
export const useMyRequestsPaged = (limit: number) =>
  useQuery({
    queryKey: qk.myRequestsPaged(limit),
    queryFn: () => listMyRequests({ limit }),
    refetchInterval: 4000,
    placeholderData: keepPreviousData,
  });

export const useAdminQueue = (status: RequestStatus | undefined, limit: number) =>
  useQuery({
    queryKey: qk.adminQueuePaged(status, limit),
    queryFn: () => listAdminQueue(status, { limit }),
    refetchInterval: 5000,
    placeholderData: keepPreviousData,
  });

export function useRequestBook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (result: V1AudibleResult) => requestBookFrom(result),
    onSuccess: (req) => {
      toast.success(req.status === 'available' ? `“${req.title}” is already available!` : `Requested “${req.title}”`);
      void qc.invalidateQueries({ queryKey: qk.myRequests });
      void qc.invalidateQueries({ queryKey: qk.me });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Request failed'),
  });
}

export const useUsers = () =>
  useQuery({ queryKey: qk.users, queryFn: listUsers });

export const useUserRequests = (publicId: string, limit: number) =>
  useQuery({
    queryKey: qk.userRequests(publicId, limit),
    queryFn: () => listUserRequests(publicId, { limit }),
    placeholderData: keepPreviousData,
  });

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { publicId: string; patch: UpdateUserBody }) => updateUser(v.publicId, v.patch),
    onSuccess: (user) => {
      toast.success(`Saved changes to ${user.username}`);
      void qc.invalidateQueries({ queryKey: qk.users });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Failed to update user'),
  });
}

export function useDecide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { publicId: string; action: 'approve' | 'deny'; note?: string }) =>
      decideRequest(v.publicId, v.action, v.note),
    onSuccess: (req, v) => {
      toast.success(v.action === 'approve' ? `Approved “${req.title}”` : `Denied “${req.title}”`);
      void qc.invalidateQueries({ queryKey: qk.adminRequests });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Action failed'),
  });
}

// --- System information (admin) ----------------------------------------------
export const useSystemInfo = () =>
  // Read-only diagnostics; refetch on a slow interval so narratorr reachability stays
  // roughly live without hammering the upstream probe.
  useQuery({ queryKey: qk.system, queryFn: getSystemInfo, refetchInterval: 30_000 });

// --- Connector settings (admin) ----------------------------------------------
export const useConnectorSettings = () =>
  // No refetch-on-focus: the Settings form remounts on cache change, so a background
  // refetch would discard in-progress edits.
  useQuery({
    queryKey: qk.connectors,
    queryFn: getConnectorSettings,
    refetchOnWindowFocus: false,
  });

export function useUpdateConnectors() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateConnectorSettingsBody) => updateConnectorSettings(body),
    onSuccess: (dto) => {
      qc.setQueryData(qk.connectors, dto);
      toast.success('Settings saved');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Save failed'),
  });
}

export function useTestConnector() {
  return useMutation({
    mutationFn: (body: TestConnectorBody) => testConnector(body),
    onSuccess: (res) => (res.success ? toast.success(res.message) : toast.error(res.message)),
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Test failed'),
  });
}

// --- Notifiers (admin) -------------------------------------------------------
// Mutations refetch the connector settings (which carries the notifier list) so the
// list reflects the committed state — and the masked secrets reset cleanly. They
// invalidate `qk.connectors`, the same entry the connectors query reads and the save
// writes, so all four sites agree through one registry entry.

export function useCreateNotifier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateNotifierBody) => createNotifier(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.connectors });
      toast.success('Notifier added');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Could not add notifier'),
  });
}

export function useUpdateNotifier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateNotifierBody }) => updateNotifier(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.connectors });
      toast.success('Notifier saved');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Could not save notifier'),
  });
}

export function useDeleteNotifier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteNotifier(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.connectors });
      toast.success('Notifier deleted');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Could not delete notifier'),
  });
}

export function useTestNotifier() {
  return useMutation({
    mutationFn: (body: NotifierTestBody) => testNotifier(body),
    onSuccess: (res) => (res.success ? toast.success(res.message) : toast.error(res.message)),
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Test failed'),
  });
}

// --- Auth: login screen + local auth -----------------------------------------
// Drives the server-rendered login screen. Static for the session (provider config
// only changes via env + restart), so no refetch-on-focus.
export const useAuthProviders = () =>
  useQuery({ queryKey: qk.authProviders, queryFn: getAuthProviders, staleTime: Infinity, retry: false });

/** Local signup/login. On success the server set a session cookie — refetch `me` so
 *  App routes to the app (or the pending screen). Errors surface on the form, not a toast. */
export function useLocalAuth(mode: 'login' | 'signup') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { email: string; password: string }) =>
      (mode === 'login' ? localLogin : localSignup)(v.email, v.password),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.me }),
  });
}

// --- Theme (light/dark) -------------------------------------------------------
// Ported from Narratorr (hooks/useTheme.ts). Source of truth is localStorage
// 'theme'; the no-flash <script> in index.html applies it before first paint, and
// this hook keeps the `.dark` class on <html> in sync once React mounts.
type Theme = 'light' | 'dark';

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('theme') as Theme | null;
      if (stored) return stored;
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));

  return { theme, toggleTheme };
}
