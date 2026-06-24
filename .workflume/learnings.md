# Learnings

Curated, durable engineering wisdom for narratorr-requests. `/elaborate` reads this file
and injects entries whose `files`/`tags` match an issue's scope. One `## slug` heading per
entry (slug must contain a hyphen), metadata, `---`, then free-form body.

## frontend-logic-extract-not-jsdom

**source:** #7
**added:** 2026-06-23
**files:** src/client/
**tags:** testing, frontend, react, vitest, test-infra

---

Frontend regression risk lives in **payload / decision logic** (mutation request bodies,
parse-and-guard, sort/format, conditional defaults) — not in rendering. Extract that logic
into pure functions with co-located `.test.ts` coverage. This repo already follows the
pattern: `build*` / `init*` payload helpers in `src/client/pages/settings-channels.ts` and
`settings-narratorr.ts`, mutation lifecycle in `hooks.test.ts`.

The repo deliberately has **no** jsdom / `@testing-library/react` / `user-event` modality
(vitest is a single node project, `.test.ts`-only glob). That is the **intended
architecture**, not a coverage gap. A typed mutation payload is already guarded by typecheck
+ the server's Zod validation (a malformed body 400s, it doesn't silently corrupt), so a
behavior-preserving extraction can't silently drop a payload past those gates.

Reach for jsdom only when a feature has genuine **DOM-only** logic that can't be a pure
function: complex conditional rendering, focus/keyboard handling, or multi-step side-effect
orchestration (e.g. a logout flow chaining clear → navigate → reload with an error path).
When an auto-filed finding says "no component-test modality," first triage what decision
logic is **already pure-testable / pure-tested** — usually the high-value part is covered and
standing up the whole harness is belt-and-suspenders. Prefer extracting one more pure helper
over adding a test modality.

## triage-autofiled-debt-by-proportionality

**source:** #35, #48, #7
**added:** 2026-06-23
**files:** src/shared/schemas/, src/server/services/
**tags:** triage, debt, security, ssrf, validation, proportionality

---

Pipeline auto-filed `[debt]` findings are reliably accurate about the **fact** of a gap but
tend to **over-scope the fix**. Triage each against (a) real exploitability/impact and (b)
whether the proposed remedy is proportionate — *before* acting. A real gap does NOT imply the
filed fix is worth building.

Cases this repo hit:

- **coverUrl DNS-rebinding (#35)** — real residual, but both sinks are **blind/opaque with no
  response readback**: the `<img src>` is the admin's browser (CSP `imgSrc` https-only + schema
  https + opaque load, needs browser-trusted TLS on the internal host) and the ntfy `Icon` is
  fetched by ntfy's server, not ours. Impact ≈ a single blind internal GET by an
  already-approved user. The proposed server-side image proxy would have added a *new* SSRF
  surface to defend a blind GET → closed not-planned as a documented residual (SECURITY.md).
- **narratorr Host validation (#48)** — three claimed cases, but only **bare-IPv6 bracketing**
  was worth fixing; embedded-port/userinfo are user-error on a labeled field, caught instantly
  by the Test button. Rescoped to the one real slice.

Specific hazard: leaving an over-scoped finding on `automate` risks the pipeline actually
**building the disproportionate remedy** (e.g. an image proxy nobody wants). When a finding's
fix is bigger than its impact, rescope the issue to the real slice or close not-planned with
the reasoning — don't let it ride into implementation unexamined.
