/**
 * Redact secret-bearing substrings from an arbitrary error/log value before it is
 * returned to the admin (the Settings notifier Test response) or written to a log line.
 *
 * Adapter errors mostly carry safe messages we construct ourselves ("Discord responded
 * 401"), but an underlying fetch / network error embeds the REQUEST URL — and for the
 * capability-URL notifiers (Slack / Discord) the whole webhook URL is the secret, while
 * Telegram puts the bot token in the URL path. The two sinks see only a stringified
 * error, not the originating config, so URL-class secrets are scrubbed by PATTERN. The
 * caller may additionally pass known secret VALUES (e.g. the resolved Pushover keys /
 * Gotify token from a Test candidate) to scrub those by exact match.
 *
 * Shared (not per-adapter) per the reviewer's DRY note — wired into notifier.service.ts
 * (the dispatcher log) and routes/settings.ts (the Test response).
 */

const REDACTED = '«redacted»';

// Patterns whose match is (or contains) a secret regardless of the configured value —
// these cover the leak vector where a fetch/network error embeds the request URL.
const URL_SECRET_PATTERNS: { re: RegExp; replace: string }[] = [
  // Telegram bot token in the path: https://api.telegram.org/bot<id>:<token>/sendMessage
  { re: /bot\d+:[A-Za-z0-9_-]+/gi, replace: REDACTED },
  // Discord webhook: redact the token segment after the numeric webhook id.
  { re: /(discord(?:app)?\.com\/api\/webhooks\/\d+)\/[A-Za-z0-9._-]+/gi, replace: `$1/${REDACTED}` },
  // Slack incoming webhook: redact the services path.
  { re: /(hooks\.slack\.com\/services)\/[A-Za-z0-9/_-]+/gi, replace: `$1/${REDACTED}` },
];

function toMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  return String(value);
}

/**
 * Stringify `value` (Error → message) and scrub secrets. Known secret VALUES (capability
 * URLs, tokens, keys) are replaced by exact match; URL-embedded secrets the caller can't
 * enumerate (network errors) are scrubbed by pattern. Returns a string safe to surface.
 */
export function redact(value: unknown, secrets: Iterable<string> = []): string {
  let out = toMessage(value);
  // 1. Exact-match scrub of known secret values. The length guard avoids redacting trivial
  //    strings (e.g. an empty/short value) that would blank out unrelated text.
  for (const s of secrets) {
    if (s && s.length >= 4) out = out.split(s).join(REDACTED);
  }
  // 2. Pattern scrub for secrets embedded in a URL we can't enumerate from the sink.
  for (const { re, replace } of URL_SECRET_PATTERNS) out = out.replace(re, replace);
  return out;
}
