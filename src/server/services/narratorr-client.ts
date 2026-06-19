import type { z } from 'zod';
import { v1AudibleSearchSchema, type V1AudibleResult } from '../../shared/schemas/v1/metadata.js';
import { v1BookSchema, type V1Book } from '../../shared/schemas/v1/books.js';
import { errorEnvelopeSchema } from '../../shared/schemas/v1/common.js';
import { ApiError } from '../util/errors.js';

export interface NarratorrClientConfig {
  baseUrl: string;
  apiKey: string;
  /** Per-request timeout (ms). */
  timeoutMs?: number;
}

/**
 * An error talking to Narratorr's `/api/v1`. Always surfaces to OUR clients as a
 * 502 (it's a server-to-server failure), but carries the upstream status/code so
 * callers (e.g. the status poller) can branch — a 404 on a book means it vanished
 * upstream, not that our request was malformed.
 */
export class NarratorrError extends ApiError {
  constructor(
    readonly upstreamStatus: number,
    readonly upstreamCode: string,
    message: string,
    /** Raw upstream JSON body — lets callers read non-envelope fields (e.g. a 409's `existingId`). */
    readonly body?: unknown,
  ) {
    super(502, 'NARRATORR_UPSTREAM', message);
    this.name = 'NarratorrError';
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** Pull `existingId` out of a `POST /books` 409 body (`{ error, existingId }`). */
function readExistingId(body: unknown): string | null {
  const id = (body as { existingId?: unknown } | null)?.existingId;
  return typeof id === 'string' && id ? id : null;
}

/**
 * Typed client over the vendored `/api/v1` contract — three calls: search, add,
 * poll. In standalone mode the same code is intercepted by the MSW handler set
 * (`mocks/narratorr-v1.ts`); in narratorr mode it hits the live API. Responses are
 * parsed through the contract schemas so drift surfaces as a 502 CONTRACT_MISMATCH
 * rather than a silent bad shape leaking into our domain.
 */
export class NarratorrClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(cfg: NarratorrClientConfig) {
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, '');
    this.apiKey = cfg.apiKey;
    this.timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async searchMetadata(q: string): Promise<V1AudibleResult[]> {
    const res = await this.request('GET', '/api/v1/metadata/search', v1AudibleSearchSchema, {
      query: { q },
    });
    return res.data;
  }

  /**
   * The "I want this book" command — add the book by ASIN; returns the (bare) library
   * book. There is no idempotency key: a book that already exists (a lost-response
   * retry, or another user already requested the ASIN) comes back as a 409 carrying
   * `existingId`. That's a success, not a failure — we fetch that book and return it,
   * so callers always get a V1Book and the add is effectively idempotent by ASIN.
   * (Whether narratorr then searches/grabs is its operator's `searchImmediately`
   * setting, not ours.)
   */
  async addBook(asin: string): Promise<V1Book> {
    try {
      return await this.request('POST', '/api/v1/books', v1BookSchema, { body: { asin } });
    } catch (err) {
      if (err instanceof NarratorrError && err.upstreamStatus === 409) {
        const existingId = readExistingId(err.body);
        if (existingId) return this.getBook(existingId);
      }
      throw err;
    }
  }

  /** Poll a book's lifecycle. A 404 means the publicId no longer resolves upstream. */
  async getBook(publicId: string): Promise<V1Book> {
    return this.request('GET', `/api/v1/books/${encodeURIComponent(publicId)}`, v1BookSchema);
  }

  /**
   * Connectivity probe for the Settings "Test" button. A bogus book id that returns a
   * structured 404 proves the URL is reachable AND the API key authenticated — so we
   * treat a 404 as success and let any other error (network, 401/403, contract) surface.
   */
  async ping(): Promise<void> {
    try {
      await this.getBook('__healthcheck__');
    } catch (err) {
      if (err instanceof NarratorrError && err.upstreamStatus === 404) return;
      throw err;
    }
  }

  // --- internals -------------------------------------------------------------

  private buildUrl(path: string, query?: Record<string, unknown>): string {
    const url = new URL(this.baseUrl + path);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  private async request<S extends z.ZodTypeAny>(
    method: string,
    path: string,
    schema: S,
    opts: { body?: unknown; headers?: Record<string, string>; query?: Record<string, unknown> } = {},
  ): Promise<z.infer<S>> {
    const url = this.buildUrl(path, opts.query);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          'X-Api-Key': this.apiKey,
          ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...opts.headers,
        },
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      });
    } catch (err) {
      const reason = err instanceof Error && err.name === 'AbortError' ? 'timed out' : 'unreachable';
      throw new NarratorrError(0, 'NETWORK', `Narratorr ${method} ${path} ${reason}`);
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      throw new NarratorrError(res.status, 'NON_JSON', `Narratorr ${method} ${path} returned non-JSON`);
    }

    if (!res.ok) {
      const parsed = errorEnvelopeSchema.safeParse(json);
      const { code, message } = parsed.success
        ? parsed.data.error
        : { code: `HTTP_${res.status}`, message: `Narratorr ${method} ${path} failed (${res.status})` };
      throw new NarratorrError(res.status, code, message, json);
    }

    const result = schema.safeParse(json);
    if (!result.success) {
      throw new NarratorrError(
        res.status,
        'CONTRACT_MISMATCH',
        `Narratorr ${method} ${path} response did not match the v1 contract`,
      );
    }
    return result.data;
  }
}

export type INarratorrClient = Pick<NarratorrClient, 'searchMetadata' | 'addBook' | 'getBook'>;
