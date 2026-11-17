import { isIOSLike, isName, QUALITY_NAMES, storedTier, storeTier, type QualityName } from '../core/quality';
import { QUALITY_LABELS, resetBootRecovery } from '../core/boot-guard';

const names: Record<QualityName | 'auto', string> = { auto: '自动', ...QUALITY_LABELS };
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
let installed = false;

export function qualityLabel(tier: QualityName): string {
  const q = new URLSearchParams(location.search).get('q');
  const source = isName(q) ? ' · 网址指定' : storedTier() === 'auto' ? ' · 自动' : '';
  return `${names[tier]}${source}${isIOSLike() ? ' · 省内存' : ''}`;
}

/** Shared by the title and game menus; applying always clears previous recovery overrides. */
export function applyQualityChoice(picked: QualityName | 'auto'): void {
  storeTier(picked);
  resetBootRecovery();
  const url = new URL(location.href);
  url.searchParams.delete('q');
  history.replaceState(null, '', url);
  location.reload();
}

/** Installed before Input or WebGL is created, so it remains available on startup failures. */
export function installQualityPicker(tier: QualityName): void {
  if (installed) return;
  installed = true;
  const q = new URLSearchParams(location.search).get('q');
  const current = isName(q) ? q : storedTier();
  const triggers = [$('quality'), $('title-quality')];
  // The in-game menu stays short on phones; the title chip says where the choice came from.
  $('quality').textContent = `画质 · ${names[tier]}`;
  $('title-quality').textContent = qualityLabel(tier);
  const picker = $('quality-picker'), options = $('quality-options'), note = $('quality-note');
  const apply = $<HTMLButtonElement>('quality-apply');
  const notes: Record<string, string> = {
    auto: '按设备自动选择。', low: '最快，照顾低端设备。', medium: '流畅优先，手机可用。',
    high: '高画质，兼顾帧率。', ultra: '画面拉满，不考虑性能。',
  };
  let picked: QualityName | 'auto' = current;
  const render = (): void => {
    for (const button of options.querySelectorAll('button')) {
      button.classList.toggle('picked', button.dataset.tier === picked);
      button.classList.toggle('current', button.dataset.tier === current);
    }
    apply.disabled = picked === current;
    note.textContent = `${isIOSLike() ? '此设备启用内存保护，世界细节以低档为上限。' : notes[picked]}${picked === current ? '（当前）' : ' 应用后会重新加载一次。'}`;
  };
  for (const option of ['auto', ...QUALITY_NAMES] as const) {
    const button = document.createElement('button');
    button.dataset.tier = option; button.textContent = names[option];
    button.addEventListener('click', () => { picked = option; render(); });
    options.append(button);
  }
  const close = (): void => { picker.classList.add('hidden'); picked = current; render(); };
  for (const trigger of triggers) trigger.addEventListener('click', () => {
    if (picker.classList.contains('hidden')) { picked = current; render(); picker.classList.remove('hidden'); }
    else close();
  });
  $('quality-cancel').addEventListener('click', close);
  apply.addEventListener('click', () => {
    if (picked === current) return close();
    apply.disabled = true; apply.textContent = '正在重新加载…';
    applyQualityChoice(picked);
  });
  window.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  render();
}
