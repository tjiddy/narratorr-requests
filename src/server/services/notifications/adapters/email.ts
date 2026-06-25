import nodemailer, { type Transporter } from 'nodemailer';
import type { NotificationChannel, SendContext } from '../types.js';

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  pass: string | null;
  from: string;
  to: string;
}

/**
 * SMTP email via nodemailer. The transport is built once. Phase-1 sends a plain
 * heads-up with a link to the queue; tokened approve/deny buttons are a fast-follow
 * (and on email they'd route through a confirm page, since link-prefetchers can fire
 * a bare GET and auto-action it).
 */
export class EmailChannel implements NotificationChannel {
  readonly name = 'email';
  // The SMTP password (when set) is the secret — exposed for dispatcher-log redaction.
  readonly secrets: readonly string[];
  private readonly transport: Transporter;

  constructor(private readonly cfg: EmailConfig) {
    this.secrets = cfg.pass ? [cfg.pass] : [];
    this.transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      // Bound a dead/slow SMTP server — notify() is fire-and-forget per request, so
      // an unbounded send would leak a pending promise (and a socket) every time.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      ...(cfg.user && cfg.pass ? { auth: { user: cfg.user, pass: cfg.pass } } : {}),
    });
  }

  async send({ message }: SendContext): Promise<void> {
    // Escape EVERY value interpolated into this HTML at the boundary (href, label, body)
    // rather than reasoning per-value about trust. url + linkLabel are renderer-owned today,
    // but uniform escaping keeps the email injection-proof if PUBLIC_URL (in the href) or a
    // future dynamic label ever carries a metacharacter.
    const link = message.url
      ? `<p><a href="${escapeHtml(message.url)}">${escapeHtml(message.linkLabel)}</a></p>`
      : '';
    await this.transport.sendMail({
      from: this.cfg.from,
      to: this.cfg.to,
      subject: message.title,
      text: message.url ? `${message.body}\n\n${message.url}` : message.body,
      html: `<p>${escapeHtml(message.body)}</p>${link}`,
    });
  }
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}
