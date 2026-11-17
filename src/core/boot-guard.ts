import { isIOSLike, isName, QUALITY_NAMES, type QualityName } from './quality';

export const BOOT_GUARD_KEY = 'galebound.bootGuard';
export const BOOT_RETRY_KEY = 'galebound.bootRetry';
export const BOOT_MAX_AGE = 10 * 60 * 1000;
export const QUALITY_LABELS: Record<QualityName, string> = { low: '低', medium: '中', high: '高', ultra: '极致' };

export function lowerQuality(name: QualityName): QualityName | null {
  return QUALITY_NAMES[QUALITY_NAMES.indexOf(name) - 1] ?? null;
}
const read = (storage: Storage, key: string): Record<string, unknown> | null => {
  try {
    const value: unknown = JSON.parse(storage.getItem(key) ?? 'null');
    return value && typeof value === 'object' ? value as Record<string, unknown> : null;
  } catch { return null; }
};
// Accessing a Storage property itself can throw in restricted/private browsing.
function storage(session = false): Storage | undefined {
  try { return session ? window.sessionStorage : window.localStorage; } catch { return undefined; }
}
function write(session: boolean, key: string, value: unknown): boolean {
  try {
    const target = storage(session);
    if (!target) return false;
    if (value === null) target.removeItem(key);
    else target.setItem(key, JSON.stringify(value));
    return true;
  } catch { return false; }
}
export function resetBootRecovery(): void {
  write(true, BOOT_RETRY_KEY, null);
  write(false, BOOT_GUARD_KEY, null);
}

/** Persistent across process death; retry overrides never change the saved preference. */
export class BootGuard {
  readonly isIOS = isIOSLike();
  readonly selectedQuality: QualityName;
  quality: QualityName;
  stage = '正在生成世界…';
  interruptedStage: string | null = null;
  downgradedByGuard = false;
  autoRetry = true;
  retries = 0;
  private begun = false;
  private recoveryOverride = false;
  private readonly now: () => number;

  constructor(selected: QualityName, readonly disabled = false, now = Date.now) {
    this.selectedQuality = this.quality = selected;
    this.now = now;
    if (disabled) return;
    const session = storage(true), local = storage();
    const retry = session && read(session, BOOT_RETRY_KEY);
    if (retry && isName(retry.quality)) {
      // A recovery override may lower a request, but must never raise a new lower choice.
      this.quality = QUALITY_NAMES[Math.min(QUALITY_NAMES.indexOf(selected), QUALITY_NAMES.indexOf(retry.quality))];
      this.recoveryOverride = true;
      this.retries = typeof retry.retries === 'number' ? Math.max(0, retry.retries) : 0;
    }
    const previous = local && read(local, BOOT_GUARD_KEY);
    // Consume once. A caught error clears this too, avoiding a second downgrade on reload.
    write(false, BOOT_GUARD_KEY, null);
    if (previous && isName(previous.quality) && typeof previous.ts === 'number'
      && now() >= previous.ts && now() - previous.ts < BOOT_MAX_AGE) {
      this.recoveryOverride = true;
      this.interruptedStage = typeof previous.stage === 'string' ? previous.stage.slice(0, 80) : '加载';
      const lower = lowerQuality(previous.quality) ?? 'low';
      if (QUALITY_NAMES.indexOf(lower) < QUALITY_NAMES.indexOf(this.quality)) {
        this.quality = lower;
        this.downgradedByGuard = true;
      }
      this.autoRetry = previous.quality !== 'low';
      this.retries++;
      this.persistRetry();
    }
  }

  private persistRetry(): boolean {
    return write(true, BOOT_RETRY_KEY, { quality: this.quality, retries: this.retries });
  }
  begin(): void { this.begun = true; this.update(this.stage); }
  update(stage: string): void {
    this.stage = stage;
    if (this.begun && !this.disabled) write(false, BOOT_GUARD_KEY, { quality: this.quality, stage, ts: this.now() });
  }
  ready(): void {
    this.begun = false;
    if (this.disabled) return;
    write(false, BOOT_GUARD_KEY, null);
    this.retries = 0;
    if (this.recoveryOverride) this.persistRetry();
    else write(true, BOOT_RETRY_KEY, null);
  }
  /** Returns the next tier only when its override was saved, preventing reload loops. */
  fail(): QualityName | null {
    if (this.disabled) return null;
    this.begun = false;
    write(false, BOOT_GUARD_KEY, null);
    const lower = lowerQuality(this.quality);
    if (!this.autoRetry || !lower || this.retries >= QUALITY_NAMES.length - 1) { this.autoRetry = false; return null; }
    this.quality = lower;
    this.retries++;
    this.recoveryOverride = true;
    if (this.persistRetry()) return lower;
    this.autoRetry = false;
    return null;
  }
}
