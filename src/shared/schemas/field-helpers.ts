import { z } from 'zod';

// Reusable field validators shared by the connector schemas (connectors.ts) and the
// notifier registry (notifier-registry.ts). Kept in their own module so both can import
// them without a cycle (connectors.ts ← notifier-registry.ts ← field-helpers.ts).

/**
 * An http(s) URL, trimmed and with trailing slashes stripped so deep links
 * (`${url}/admin`) and ntfy publish URLs never get a double slash from a pasted base.
 */
export const httpUrl = z
  .string()
  .trim()
  .regex(/^https?:\/\//, 'must be an http(s) URL')
  .transform((v) => v.replace(/\/+$/, ''));

/**
 * ntfy priority: the documented words or a 1-5 digit. A typo would otherwise be sent
 * verbatim in the Priority header and silently rejected by ntfy.
 */
export const ntfyPriority = z
  .string()
  .trim()
  .regex(/^(min|low|default|high|max|[1-5])$/, 'must be min/low/default/high/max or 1-5');
