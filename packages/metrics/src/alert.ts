// Owner alerts (spec 015 tech §2, §5.2; FR-OBS-001, 010, 012). One e-mail to the owner's own address through Resend
// (no sending domain needed), or a chat webhook when ALERT_CHANNEL=chat. Each key alerts at most once per 6 hours.
// Messages carry keys, levels and counts only — never descriptions, e-mail addresses or other personal data.
import { observability } from '@domains-all/config/defaults';
import { timedFetch } from '@domains-all/config/net';

export type AlertLevel = 'info' | 'warning' | 'critical';

export interface Alert {
  level: AlertLevel;
  /** Stable key such as `job-failed-twice:refresh-prices` or `budget-db-80`. */
  key: string;
  message: string;
  data?: Record<string, number | string | boolean>;
  /** Deliver even at info level (the monthly report). */
  notify?: boolean;
}

/** Claims a key for `ttlSeconds`; false when it was already claimed inside that window. */
export interface DedupeStore {
  claim(key: string, level: AlertLevel, ttlSeconds: number): Promise<boolean>;
}

export class MemoryDedupe implements DedupeStore {
  private readonly until = new Map<string, number>();
  constructor(private readonly now: () => number = Date.now) {}
  async claim(key: string, _level: AlertLevel, ttlSeconds: number) {
    const t = this.now();
    if ((this.until.get(key) ?? 0) > t) return false;
    this.until.set(key, t + ttlSeconds * 1000);
    return true;
  }
}

export interface AlertConfig {
  channel: 'email' | 'chat';
  siteName: string;
  resendApiKey?: string;
  ownerEmail?: string;
  /** Sender; Resend's shared test sender works for mail to the account owner's own address. */
  from?: string;
  webhookUrl?: string;
}

export type AlertOutcome = 'sent' | 'logged' | 'deduped' | 'not_configured' | 'failed';

export const RESEND_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'Owner alerts <onboarding@resend.dev>';

/** Info alerts are only logged unless `notify`; warnings and critical alerts reach the owner (NFR-OBS-002: few,
 *  useful alerts). */
export async function sendAlert(
  alert: Alert,
  cfg: AlertConfig,
  deps: { dedupe: DedupeStore; fetchFn?: typeof fetch },
): Promise<AlertOutcome> {
  if (alert.level === 'info' && !alert.notify) return 'logged';
  const ready = cfg.channel === 'chat' ? !!cfg.webhookUrl : !!(cfg.resendApiKey && cfg.ownerEmail);
  if (!ready) return 'not_configured';
  if (!(await deps.dedupe.claim(alert.key, alert.level, observability.alertDedupeSeconds))) return 'deduped';

  const subject = `[${cfg.siteName}] ${alert.level}: ${alert.key}`;
  const details = Object.entries(alert.data ?? {}).map(([k, v]) => `${k}: ${v}`);
  const text = [alert.message, ...(details.length ? ['', ...details] : [])].join('\n');
  const res =
    cfg.channel === 'chat'
      ? await timedFetch(cfg.webhookUrl!, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // `text` for Slack-style hooks, `content` for Discord-style hooks.
          body: JSON.stringify({ text: `${subject}\n${text}`, content: `${subject}\n${text}` }),
          timeoutMs: 10_000,
          fetchFn: deps.fetchFn,
        })
      : await timedFetch(RESEND_URL, {
          method: 'POST',
          headers: { authorization: `Bearer ${cfg.resendApiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ from: cfg.from ?? DEFAULT_FROM, to: [cfg.ownerEmail], subject, text }),
          timeoutMs: 10_000,
          fetchFn: deps.fetchFn,
        });
  return res?.ok ? 'sent' : 'failed';
}
