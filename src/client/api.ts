import type { MeDto, UserDto, UpdateUserBody } from '@shared/schemas/user';
import type { RequestDto, RequestStatus } from '@shared/schemas/request';
import type { V1AudibleResult } from '@shared/schemas/narratorr-v1';
import type { ListEnvelope } from '@shared/schemas/v1/common';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    throw new ApiError(res.status, 'NON_JSON', `Unexpected non-JSON response (${res.status})`);
  }
  if (!res.ok) {
    const envelope = json as { error?: { code?: string; message?: string } } | undefined;
    throw new ApiError(
      res.status,
      envelope?.error?.code ?? `HTTP_${res.status}`,
      envelope?.error?.message ?? `Request failed (${res.status})`,
    );
  }
  return json as T;
}

const opts = (init?: RequestInit): RequestInit => ({ credentials: 'same-origin', ...init });

export const getMe = () => fetch('/api/me', opts()).then(parse<MeDto>);

export const searchCatalog = (q: string) =>
  fetch(`/api/search?q=${encodeURIComponent(q)}`, opts()).then(parse<{ data: V1AudibleResult[] }>);

export const listMyRequests = () =>
  fetch('/api/requests', opts()).then(parse<ListEnvelope<RequestDto>>);

export const listAdminQueue = (status?: RequestStatus) =>
  fetch(`/api/admin/requests${status ? `?status=${status}` : ''}`, opts()).then(parse<ListEnvelope<RequestDto>>);

export function requestBookFrom(result: V1AudibleResult) {
  const body = {
    asin: result.asin,
    title: result.title,
    author: result.authors[0]?.name ?? null,
    narrator: result.narrators[0]?.name ?? null,
    coverUrl: result.cover,
  };
  return fetch('/api/requests', opts({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })).then(parse<RequestDto>);
}

export const decideRequest = (publicId: string, action: 'approve' | 'deny', note?: string) =>
  fetch(`/api/admin/requests/${publicId}/decision`, opts({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, note: note ?? null }),
  })).then(parse<RequestDto>);

export const listUsers = () =>
  fetch('/api/admin/users', opts()).then(parse<ListEnvelope<UserDto>>);

export const updateUser = (publicId: string, patch: UpdateUserBody) =>
  fetch(`/api/admin/users/${publicId}`, opts({
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  })).then(parse<UserDto>);

export const listUserRequests = (publicId: string) =>
  fetch(`/api/admin/users/${publicId}/requests`, opts()).then(parse<ListEnvelope<RequestDto>>);

export const logout = () => fetch('/api/auth/logout', opts({ method: 'POST' })).then(parse<{ ok: true }>);
