# Narratorr Public API v1 — Consumer Handoff

**The request-app action & discovery surface, from the first native v1 consumer.**

Audience: the Narratorr API team. Author: narrator-request (the first native `/api/v1`
consumer). Status of Narratorr: API reads landed on `develop` (S3/S5); the
action/discovery surface this consumer needs has not.

---

## TL;DR

narrator-request is built, reviewed, deployed, and runs **fully green against a mock** of the
`/api/v1` contract — but it can't go live against real Narratorr yet. The **read** surface
shipped (books, downloads, authors, narrators, series), but the **three endpoints this consumer
actually calls** don't exist:

| Consumer calls | On `develop` today | Verdict |
|---|---|---|
| `GET /api/v1/metadata/search?q=` | — nothing — | ❌ missing |
| `POST /api/v1/acquisitions {asin}` | — nothing — | ❌ missing |
| `GET /api/v1/acquisitions/:id` | — nothing — | ❌ missing |
| `GET /api/v1/books`, `/books/:id` | ✅ exist | consumer doesn't call them live (see §2) |
| `POST /api/v1/books/:id/search` + `/grab` (#1452) | ✅ exist | the release-picker path — **not** this consumer's path (§3) |

This proposes those three endpoints, grounded in the vendored contract
(`src/shared/schemas/narratorr-v1.ts`), and is the source of the "still not there" symptom: it's
**contract divergence, not a deploy bug.**

> **Framing.** This is not "build the API for narrator-request." We're the first real exercise
> of the native action/write surface (prowlarr-compat is the documented shim exception), so we
> have **input, not authority**. Treat the schemas here as a considered proposal plus a concrete
> set of consumer constraints. Where Narratorr's conventions already differ from our vendored
> guesses, Narratorr wins and we reconcile.

### How to read the markers

- 🔒 **Hard requirement** — the consumer can't function without this; changing it breaks us.
- 🤝 **Proposed — your call** — a suggested shape; you own the decision, we'll adapt.
- ↩️ **We'll reconcile** — our vendored guess differs from your shipped convention; we change.

---

## 1. Who's calling, and how

- **Contract-first sidecar, Overseerr-style.** Users sign in (Plex OIDC), search a catalog,
  request audiobooks; an admin approves; approved requests hand off to Narratorr; the requester
  is notified when the book is available. narrator-request talks to Narratorr **only** over
  `/api/v1` + an API key — no shared DB, no filesystem, no SSE.
- **Auth:** sends `X-Api-Key: <key>` on every call (matches your auth plugin's `x-api-key`).
  🔒 the key must be valid on the metadata-search + acquisitions paths (same `/api/v*` scope as
  the reads — the de-god-moded key from #1453/#1453's path gate).
- **Polls, doesn't subscribe.** The key can't reach SSE (S7), so lifecycle is tracked by polling
  `GET /api/v1/acquisitions/:id`. By design — no realtime needed from you.
- **Every response is Zod-parsed; mismatch → hard fail.** The client parses each response through
  the contract schema and raises `502 CONTRACT_MISMATCH` on any mismatch
  (`src/server/services/narratorr-client.ts`). **Good news:** the consumer's schemas are
  **non-`.strict()`** — extra fields are ignored. So you can add fields freely; the only breakers
  are **renaming, removing, or retyping** the fields specified in §4. Your `.strict()`
  fail-closed serializers don't conflict with this.
- **Conventions already mirrored** from your S0 ADR and kept byte-compatible
  (`src/shared/schemas/v1/common.ts`): `{ data, total }` lists, `{ error: { code, message } }`
  errors, ISO-8601 date strings, opaque prefixed ids, offset/limit pagination.

---

## 2. What's missing vs. what exists

The complete v1 surface on `develop` is: reads (`books`, `downloads`, `authors`, `narrators`,
`series`) + the two book-scoped actions from **#1452** (`POST /books/:id/search`,
`POST /books/:id/grab`). There is no metadata search, no acquisitions resource, and no v1
book-create.

**The book/download read drift is NOT a blocker.** The consumer's client *defines*
`getBook`/`listBooks`, but its live flow never calls them (only `searchMetadata`,
`createAcquisition`, `getAcquisition` are invoked). So the fact that your shipped `BookV1`
(nested `series`, `{id,name}` people, no `coverUrl`/`asin`/`createdAt`) differs from our vendored
`V1Book` guess doesn't matter today. ↩️ if the consumer ever reads books live, it reconciles to
your shipped shape.

---

## 3. Why not the #1452 `search` + `grab` path?

#1452 built **interactive release-picking**: list candidate torrent releases for an existing
book, then grab a chosen `releaseId`. That's a legitimate path for an admin/power-user client —
but **end users of a request app never wrangle torrents**, and release ranking must stay
server-side in Narratorr (`searchAndGrabForBook`). It also presupposes the book already exists
(`:publicId`), and there's no v1 book-create.

So instead of *book-create → list releases → pick → grab → correlate downloads*, the consumer
wants **one idempotent "acquire this ASIN" command + a status projection to poll.** This is
**additive** — #1452's endpoints stay exactly as they are for their own consumers.

---

## 4. The three endpoints

### 4.1 `GET /api/v1/metadata/search` — discovery

The free-text Audible/metadata search behind the "Discover" page. **This is the same capability
behind your own Add-Book UI** (`MetadataService.search(query)`, `metadata.service.ts:76`) —
proposal is to expose it on v1 as a thin wrapper.

- **Auth:** API key.
- **Query:** `?q=<string>` — 🔒 required. Consumer validates `trim().min(1).max(500)` and sends
  it raw.
- **200 response:** `{ "data": V1AudibleResult[] }`
  🤝 `{ data, total }` is fine too — the consumer ignores `total`.
- **`V1AudibleResult`** (fields the consumer reads):

  ```ts
  {
    asin: string,                              // 🔒 the acquire key — MUST be the same ASIN that
                                               //    POST /acquisitions accepts (this is the join)
    title: string,                             // 🔒
    authors: { name: string, asin?: string }[],// 🔒 name required; asin optional
    narrators: { name: string }[],             // 🔒 name required
    coverUrl: string | null,                   // 🔒 UI renders covers (null is fine)
    duration?: number | null,                  // 🤝 seconds
    publishedDate?: string | null,             // 🤝
    seriesName?: string | null,                // 🤝
    seriesPosition?: number | null,            // 🤝
    language?: string | null,                  // 🤝
  }
  ```

  Non-strict on our side; add fields freely.
- **Status codes:** `200` (no matches → `{ "data": [] }`, 🔒 **not** 404); `400 BAD_REQUEST`
  on empty/oversize `q`; `401` invalid key.
- **Consumer call site:** `search.service` (per-user throttle + short-TTL cache) →
  `narratorr-client.searchMetadata`. Low volume.
- **Acceptance:** `q=dune` returns audiobook **metadata** including `asin` + `coverUrl`; it's an
  Audible/metadata lookup, **not** an indexer/release search; empty `data` on no match.
- 🤝 **Open question:** people are `{ name, asin? }` here, not `{ id, name }` like `BookV1` —
  because these are *pre-add* metadata results with no `bk_`/person `publicId` yet. If you prefer
  a different identity, say so; we'll adapt. (See §6.)
- 🤝 **NEW ask — library cross-reference (Overseerr tri-state).** Today the consumer can only show
  "already requested" for books **this user** personally requested (it cross-references the user's
  own request list client-side). It has **no way to know a result is already in the Narratorr
  library** (imported by someone else, or pre-existing), so it shows a "Request" button on books
  the library already owns — the most confusing gap vs. Overseerr. `V1AudibleResult` is pure
  Audible metadata; only Narratorr knows its own library, so this must come from you.

  **Proposal — annotate each result with its library status, matched by `asin` server-side:**

  ```ts
  {
    // …existing V1AudibleResult fields…
    library?: {                 // 🤝 null/absent = not in library (→ "Request")
      bookId: string,           //    bk_… of the existing library book
      status: BookStatus,       //    'wanted'|'searching'|'downloading'|'importing'|'imported'|'failed'|'missing'
    } | null,
  }
  ```

  Consumer renders the tri-state from it: `imported` → **"In library"** (no Request button);
  in-flight (`wanted`/`searching`/`downloading`/`importing`) → **"On the way"**; `failed`/`missing`
  or absent → **"Request"** (re-request allowed). This is exactly Overseerr's Available/Requested/
  Request, minus the per-user "Requested" piece we already do ourselves.

  - **Why on the search response (not a separate consumer call):** Narratorr owns the library, so
    matching the result ASINs against it is one indexed lookup on your side — vs. the consumer
    firing an N-result fan-out of "do you have this ASIN?" calls. Keeps the consumer thin and
    avoids hammering you. 🤝 your call: if you'd rather expose a batch
    `POST /api/v1/library/by-asin { asins[] } → { asin: { bookId, status } }` and let us join,
    that's fine too — we'll adapt.
  - **Compat / failure mode:** purely additive + optional. We're non-strict, so absent = "not in
    library." Best-effort — if the cross-ref fails, omit it; never fail the search over it.
  - **Auth/scope:** same key + scope as the base search call.
  - **Acceptance:** searching a title already imported in Narratorr returns that result with
    `library.status === 'imported'`; a title not in the library returns `library` null/absent.

### 4.2 `POST /api/v1/acquisitions` — the request-app write path

One idempotent domain command: **"acquire the book identified by this ASIN."** Server-side it
composes what you already have — create book (`book.service.ts:228 create()`) → immediate search
+ auto-grab best release (`trigger-immediate-search.ts` / your search-and-grab pipeline). 🤝
implementation entirely your call; release ranking stays inside Narratorr.

- **Auth:** API key.
- **Body:** `{ "asin": "<string>" }` — 🔒 `.strict()`, `asin` min length 1.
- **Header:** `Idempotency-Key: <opaque>` — 🔒 **honor it.** The consumer **always** sends one,
  set to the request's own publicId (`rq_…`). Two idempotency guarantees, both 🔒 required:
  1. **Idempotent on ASIN** — a second acquire for an ASIN that already has a book/acquisition
     returns the **existing** acquisition (no second download). Lean on your unique-ASIN index,
     not just a preflight check (race-safe).
  2. **Idempotency-Key replay** — a retry with the same key after a **lost response** returns the
     same acquisition, not a new one. (The consumer retries on timeout: the grab likely
     succeeded; only the response was lost.)
- **Response:** `V1Acquisition` (see §4.3 schema). `200` (existing) or `201` (created) — 🤝 the
  consumer doesn't branch on the code. 🔒 must include the acquisition `id` (consumer persists it
  and polls it).
- **Retry-by-state** (🤝 your call; here's what the consumer assumes): already-`imported` book →
  return acquisition with status `imported` (the "already available" short-circuit);
  `failed`/`missing` → bounded re-acquire.
- **Status codes:** `200`/`201` success; `400` bad asin; `401`; `5xx` upstream. 🔒 a
  network/timeout/`5xx` **must be safe to retry** — that's what the Idempotency-Key buys. On a
  failed handoff the consumer marks the request `failed` (refundable, not user-caused).
- **Consumer call site:** `request.service.handoff` (on admin approve, and poller self-heal for
  requests stranded between approve and handoff). `Idempotency-Key = request.publicId`.
- **Acceptance:** POST `{asin}` twice (same key; and same asin, different key) → exactly one book,
  one download, **same acquisition id** returned both times; a lost-response retry never
  double-grabs.

### 4.3 `GET /api/v1/acquisitions/:id` — the lifecycle the poller reads

The single resource the consumer polls to drive request lifecycle. A **projection** over book +
download (+ import). 🤝 implement as a projection, not necessarily a new table (§5).

- **Auth:** API key.
- **Path param:** `:id` = the `aq_…` from POST. 🔒 round-trips verbatim (opaque; consumer
  `encodeURIComponent`s it). ⚠️ see §7 on id charset.
- **200 response — `V1Acquisition`:**

  ```ts
  {
    id: string,                  // "aq_…" opaque                                 🔒
    bookId: string | null,       // "bk_…" once a book row exists; null in the    🔒
                                 //   brief pre-book window
    asin: string,                //                                               🔒
    status: AcquisitionStatus,   // see below                                     🔒
    progress?: number | null,    // 0–100; consumer tolerates null/absent         🤝
    updatedAt: string,           // ISO-8601 (read but not branched on)           🤝
  }
  ```

- **`AcquisitionStatus`** = your `BOOK_STATUSES` ∪ `'queued'`:
  `'queued' | 'wanted' | 'searching' | 'downloading' | 'importing' | 'imported' | 'missing' | 'failed'`
  🤝 `'queued'` is the synthetic pre-book state; if your projection always has a book by the time
  POST returns, you may never emit it — fine.
- 🔒 **How the consumer collapses status — so you know which states are terminal:**

  | acquisition status | → request status | meaning |
  |---|---|---|
  | `imported` | **`available`** | **TERMINAL SUCCESS** — requester is notified, polling stops |
  | `failed`, `missing` | **`failed`** | **TERMINAL FAILURE** |
  | `queued`,`wanted`,`searching`,`downloading`,`importing` | `acquiring` | in-flight — keep polling |

  Implications: **don't emit `imported` until the book is actually available/importable**; once
  you emit it the consumer stops looking, so **don't transition out of `imported`** afterward.
- 🔒 **404 is terminal.** A `404` here makes the consumer mark the request **permanently
  `failed`** ("acquisition vanished upstream"). So an acquisition **must stay queryable by its id
  for its whole lifetime** — and ideally afterward, still returning the terminal
  `imported`/`failed` state. Never `404` a still-valid or just-completed acquisition.
- **Poll cadence:** ~every 15s per in-flight acquisition, batched (≤25/tick), 250ms jitter,
  exponential backoff on upstream errors. Low load (single-user homelab). No SSE.
- **Acceptance:** the id from POST is GETtable across the lifecycle; status walks
  `wanted → … → imported`; `progress` is 0–100 while downloading; `404` only for an id that truly
  never existed.

---

## 5. The acquisition resource — design notes (your call, our input)

This is where, as first consumer, we have the most input but the least claim — it's a brand-new
public concept. Our proposal:

- **Model it as a projection, not a CRUD table** (unless you want an audit trail). It collapses
  the books↔downloads correlation + import overlay into one lifecycle the consumer can poll
  without re-implementing your two-axis (`clientStatus`/`pipelineStage`) download model.
- **`aq_` id:** if it's a pure projection with no row, the id needs to encode enough to re-resolve
  on GET (e.g. wrap the book `publicId` or the ASIN). 🤝 your call — the consumer treats it as
  fully opaque and only round-trips it.
- **`progress`:** roll up the active download's progress; `null` before a download exists. 🤝
- **Genuine fork (§6.3):** if you'd rather **not** introduce an `acquisitions` abstraction, the
  alternative is to expose **v1 book-create** + richer status on `GET /books/:id`, and let the
  consumer orchestrate create-then-poll-book. The consumer **can** adapt to that. We argue for the
  command because it buys two things the book-centric path doesn't: (a) idempotent recovery on a
  lost-response retry, and (b) encapsulating release-picking so no client ever ranks torrents.
  Your call.

---

## 6. Open questions for the API team

1. **Metadata-result identity** — people as `{ name, asin? }` (our proposal, since pre-add
   results have no publicId) vs `{ id, name }` to match `BookV1`.
2. **Acquisition: projection vs table**, and what `aq_` encodes.
3. **Keep the `acquisitions` command at all** vs. expose book-create + book-status and let the
   consumer orchestrate (§5). This is a real architectural fork — your decision.
4. **publicId charset** (§7) — needs a decision so ids round-trip cleanly.

---

## 7. Known hazards / coordination

- ⚠️ **publicId charset round-trip.** Your `generatePublicId` uses **base64url**
  (`A-Za-z0-9-_`), so an `aq_`/`bk_` body can contain `-` or `_`. The consumer's vendored id
  validator is currently `^<prefix>_[A-Za-z0-9]+$`, which would **reject** (→ 502
  `CONTRACT_MISMATCH`) any id containing `-`/`_` — roughly half of real ids. **This is a
  consumer-side bug**; narrator-request will loosen its regex to `[A-Za-z0-9_-]+` to match your
  documented format. Flagged only so we both know ids must round-trip byte-for-byte. *(Tracked as
  a narrator-request fix — not your work.)*
- **Strictness is compatible.** Your v1 serializers are `.strict()` (fail-closed) — fine; the
  consumer is non-strict and tolerant of additive fields. Only renames/removals/retypes of the §4
  fields break it.
- **The vendored contract is the machine-readable version of this doc.**
  `src/shared/schemas/narratorr-v1.ts` is the annotated Zod, with `PROPOSED` tags — the
  lift-and-shift seed for `narratorr/src/shared/schemas/v1/{metadata,acquisitions}.ts`. Endgame
  (your S9): Narratorr owns the canonical contract + OpenAPI, publishes
  `@narratorr/api-contract`, and this consumer depends on the pinned package and runs contract
  tests instead of vendoring.

---

## 8. Out of scope (no change needed from you)

- Existing reads (`books`/`downloads`/`authors`/`narrators`/`series`) — consumer doesn't call them
  live; leave as-is.
- The #1452 `books/:id/search` + `/grab` release-picker — stays; this work is additive.
- SSE / realtime — the consumer polls by design.

---

## 9. Suggested issue breakdown (epic #1441)

Labels per the narratorr convention: `automate, status/backlog, type/feature, priority/high,
scope/api`.

- **Story A — `GET /api/v1/metadata/search`**: wrap `MetadataService.search`. Pin the
  `V1AudibleResult` schema + `q` validation + status codes. Mirror #1454 for OpenAPI.
- **Story B — `POST /api/v1/acquisitions`**: idempotent acquire command (ASIN-idempotent +
  Idempotency-Key replay) composing book-create + immediate-search + auto-grab.
- **Story C — `GET /api/v1/acquisitions/:id`**: lifecycle projection over book + download; pin
  the status vocabulary + terminal/404 semantics from §4.3.

Each story should pin **exact schema, status codes, and failure modes** (this doc + the vendored
Zod are the spec), add OpenAPI docs, and ship contract tests against the vendored schemas
(anti-drift).

---

## 10. References

**Consumer (narrator-request):**
- `src/shared/schemas/narratorr-v1.ts` — canonical proposal, annotated Zod (the spec).
- `src/shared/schemas/v1/common.ts` — mirrored envelopes/id/date conventions.
- `src/server/services/narratorr-client.ts` — exact call shapes, headers, error handling.
- `src/server/services/status-poller.ts` — poll cadence + the 404-is-terminal behavior.
- `src/server/services/request.service.ts` — `handoff` (Idempotency-Key = request publicId) +
  `mapAcquisitionToStatus` (the status collapse in §4.3).

**Provider (narratorr, `develop`) — building blocks to wrap:**
- `src/server/services/metadata.service.ts:76` — `search(query)` for Story A.
- `src/server/services/book.service.ts:228` — `create(...)` for Story B.
- `src/server/services/trigger-immediate-search.ts` + search-and-grab pipeline — auto-grab.
- `src/server/routes/v1/actions.ts` — the #1452 pattern (encapsulated plugin, v1 error handler,
  idempotency-by-keyed-mutex) to mirror.
- `src/server/routes/v1/_helpers.ts` — `v1ErrorHandler`, `fetchByPublicId`, `V1NotFoundError`.
- `src/server/utils/public-id.ts` — `generatePublicId` (base64url — see §7).
- `src/shared/schemas/v1/common.ts` — `v1ListResponseSchema`, `v1ErrorEnvelopeSchema`.

**Commits/stories:** #1450/#1451 reads · #1452 search+grab · #1454 OpenAPI · epic #1441.
