import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { V1AudibleResult } from '@shared/schemas/narratorr-v1';
import type { RequestStatus } from '@shared/schemas/request';
import {
  getMe,
  searchCatalog,
  listMyRequests,
  listAdminQueue,
  requestBookFrom,
  decideRequest,
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
