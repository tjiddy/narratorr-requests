import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { V1AudibleResult } from '@shared/schemas/narratorr-v1';
import type { RequestStatus } from '@shared/schemas/request';
import type { UpdateUserBody } from '@shared/schemas/user';
import type { UpdateConnectorSettingsBody } from '@shared/schemas/connectors';
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
  updateConnectorSettings,
  testConnector,
  getAuthProviders,
  localLogin,
  localSignup,
  type ConnectorChannel,
  ApiError,
} from './api';

export const qk = {
  me: ['me'] as const,
  search: (q: string) => ['search', q] as const,
  myRequests: ['requests', 'mine'] as const,
  adminQueue: (status?: RequestStatus) => ['admin', 'requests', status ?? 'all'] as const,
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

/** My requests — polled so `acquiring → available` transitions show up live. */
export const useMyRequests = () =>
  useQuery({ queryKey: qk.myRequests, queryFn: listMyRequests, refetchInterval: 4000 });

export const useAdminQueue = (status?: RequestStatus) =>
  useQuery({ queryKey: qk.adminQueue(status), queryFn: () => listAdminQueue(status), refetchInterval: 5000 });

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
  useQuery({ queryKey: ['admin', 'users'], queryFn: listUsers });

export const useUserRequests = (publicId: string) =>
  useQuery({ queryKey: ['admin', 'users', publicId, 'requests'], queryFn: () => listUserRequests(publicId) });

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { publicId: string; patch: UpdateUserBody }) => updateUser(v.publicId, v.patch),
    onSuccess: (user) => {
      toast.success(`Saved changes to ${user.username}`);
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
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
      void qc.invalidateQueries({ queryKey: ['admin', 'requests'] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Action failed'),
  });
}

// --- Connector settings (admin) ----------------------------------------------
export const useConnectorSettings = () =>
  // No refetch-on-focus: the Settings form remounts on cache change, so a background
  // refetch would discard in-progress edits.
  useQuery({
    queryKey: ['admin', 'settings', 'connectors'],
    queryFn: getConnectorSettings,
    refetchOnWindowFocus: false,
  });

export function useUpdateConnectors() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateConnectorSettingsBody) => updateConnectorSettings(body),
    onSuccess: (dto) => {
      qc.setQueryData(['admin', 'settings', 'connectors'], dto);
      toast.success('Settings saved');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Save failed'),
  });
}

export function useTestConnector() {
  return useMutation({
    mutationFn: (channel: ConnectorChannel) => testConnector(channel),
    onSuccess: (res) => (res.success ? toast.success(res.message) : toast.error(res.message)),
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Test failed'),
  });
}

// --- Auth: login screen + local auth -----------------------------------------
// Drives the server-rendered login screen. Static for the session (provider config
// only changes via env + restart), so no refetch-on-focus.
export const useAuthProviders = () =>
  useQuery({ queryKey: ['auth', 'providers'], queryFn: getAuthProviders, staleTime: Infinity, retry: false });

/** Local signup/login. On success the server set a session cookie — refetch `me` so
 *  App routes to the app (or the pending screen). Errors surface on the form, not a toast. */
export function useLocalAuth(mode: 'login' | 'signup') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { username: string; password: string }) =>
      (mode === 'login' ? localLogin : localSignup)(v.username, v.password),
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
