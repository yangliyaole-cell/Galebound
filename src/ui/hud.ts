import type { QualityName } from '../core/quality';
import { QUALITY_LABELS } from '../core/boot-guard';
import type { Wind } from '../world/wind';
import { VISTAS, type EntryPrefs } from './entry';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

type Stage = 'loading' | 'ready' | 'setup' | 'leaving';

/** Everything drawn over the game: the way in, counters, the wind dial and brief messages. */
export class Hud {
  private readonly root = $('hud');
  private readonly title = $('title');
  private readonly startButton = $<HTMLButtonElement>('start');
  private readonly orbCount = $('orb-count');
  private readonly orbPanel = $('orbs');
  private readonly windBox = $('wind');
  private readonly arrow = $('wind-arrow');
  private readonly arc = $('wind-arc');
  private readonly windLabel = $('wind-label');
  private readonly toastBox = $('toast');
  private readonly zoneBox = $('zone');
  private readonly hint = $('hint');
  private readonly guide = $('touch-guide');
  private readonly line = $('title-line');
  private toastTimer = 0;
  private zoneTimer = 0;
  private hintTimer = 0;
  private guideTimer = 0;
  private readonly styleBox = $('style-label');
  private styleTimeout = 0;
  private touch: boolean;
  private prefs: EntryPrefs = { vista: VISTAS[0].id, walk: false, look: 1 };

  /** Fires when the player leaves the title for good (after the setup panel). */
  onStart: () => void = () => {};
  /** Fires on the first press of the title button: a user gesture, so sound may begin. */
  onSetup: () => void = () => {};
  onPrefs: (prefs: EntryPrefs) => void = () => {};
  onSound: () => boolean = () => true;
  onCinema: () => Promise<boolean> = async () => false;

  constructor(touch: boolean) {
    this.touch = touch;
    this.renderKeys();
    if (touch) this.showTouch();

    this.startButton.addEventListener('click', () => {
      if (this.startButton.dataset.bootFailed || this.startButton.disabled) return;
      this.stage('setup');
      const vista = VISTAS.find((v) => v.id === this.prefs.vista);
      if (vista) this.titleLine(vista.line);
      this.onSetup();
    });
    $('depart').addEventListener('click', () => this.depart());
    window.addEventListener('keydown', (e) => {
      // Enter walks through the way in: open the setup, then set off.
      if (e.key !== 'Enter' || this.startButton.dataset.bootFailed) return;
      const stage = this.title.dataset.stage as Stage;
      if (stage === 'ready') this.startButton.click();
      else if (stage === 'setup') this.depart();
    });

    // Vista cards.
    const vistas = $('vistas');
    for (const vista of VISTAS) {
      const card = document.createElement('button');
      card.className = 'vista';
      card.dataset.v = vista.id;
      card.innerHTML = `<b>${vista.name}</b><span>${vista.sub}</span>`;
      card.addEventListener('click', () => this.setPrefs({ vista: vista.id }));
      vistas.append(card);
    }
    this.segment('seg-gait', (v) => this.setPrefs({ walk: v === 'walk' }));
    this.segment('seg-look', (v) => this.setPrefs({ look: Number(v) }));
    this.segment('seg-sound', (v) => {
      const on = this.onSound();
      // onSound toggles; only call it when the choice differs from the current state.
      if (on !== (v === '1')) this.onSound();
      this.soundLabel(v === '1');
    });
    this.segment('seg-cinema', (v) => {
      void this.onCinema().then((on) => {
        if (on !== (v === '1')) return this.onCinema();
        return on;
      }).then((on) => this.cinemaLabel(on)).catch(() => this.toast('风格加载失败'));
    });

    const sound = $('sound');
    sound.addEventListener('click', () => this.soundLabel(this.onSound()));
    sound.textContent = '声音 · 开';
    const cinema = $('cinema');
    cinema.addEventListener('click', () => {
      void this.onCinema().then((on) => this.cinemaLabel(on)).catch(() => this.toast('风格加载失败'));
    });
  }

  private segment(id: string, choose: (value: string) => void): void {
    const seg = $(id);
    for (const button of seg.querySelectorAll('button')) {
      button.addEventListener('click', () => {
        if (button.classList.contains('on')) return;
        choose(button.dataset.v!);
      });
    }
  }

  private mark(id: string, value: string): void {
    for (const button of $(id).querySelectorAll('button')) button.classList.toggle('on', button.dataset.v === value);
  }

  private stage(stage: Stage): void {
    this.title.dataset.stage = stage;
    document.body.classList.toggle('entry-setup', stage === 'setup');
  }

  private renderKeys(): void {
    const rows = this.touch
      ? [['左侧按住', '移动 · 推远奔跑'], ['右侧轻点', '跳跃 · 空中再点，乘风'], ['右侧滑动', '转视角 · 双指缩放']]
      : [['<kbd>W A S D</kbd>', '奔跑'], ['<kbd>Ctrl</kbd>', '按住漫步 · 轻点切换'], ['<kbd>空格</kbd>', '跳跃 · 空中再按，乘风'],
        ['<kbd>W</kbd> <kbd>S</kbd>', '飞行中俯冲 · 拉升'], ['<kbd>Shift</kbd>', '飞行中收臂加速'], ['鼠标', '视角 · 滚轮远近']];
    $('keys').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    // The gait preference is a keyboard notion; on touch the stick decides.
    $('row-gait').style.display = this.touch ? 'none' : '';
    this.hint.textContent = this.touch ? '' : 'WASD 奔跑 · Ctrl 漫步 · 空格 跳跃';
  }

  /** Reflect stored preferences in the setup panel without announcing them. */
  showPrefs(prefs: EntryPrefs): void {
    this.prefs = { ...prefs };
    for (const card of $('vistas').querySelectorAll<HTMLElement>('.vista')) card.classList.toggle('on', card.dataset.v === prefs.vista);
    this.mark('seg-gait', prefs.walk ? 'walk' : 'run');
    const look = [0.7, 1, 1.4].reduce((a, b) => (Math.abs(b - prefs.look) < Math.abs(a - prefs.look) ? b : a));
    this.mark('seg-look', String(look));
    const vista = VISTAS.find((v) => v.id === prefs.vista);
    if (vista && this.title.dataset.stage === 'setup') this.titleLine(vista.line);
  }

  private setPrefs(change: Partial<EntryPrefs>): void {
    this.showPrefs({ ...this.prefs, ...change });
    this.onPrefs(this.prefs);
  }

  private titleLine(text: string): void {
    if (this.line.textContent === text) return;
    this.line.style.opacity = '0';
    window.setTimeout(() => {
      this.line.textContent = text;
      this.line.style.opacity = '';
    }, 300);
  }

  private depart(): void {
    if (this.title.dataset.stage !== 'setup') return;
    $('quality-picker').classList.add('hidden');
    this.stage('leaving');
    this.root.classList.remove('hidden');
    window.setTimeout(() => {
      if (!this.startButton.dataset.bootFailed) this.title.style.display = 'none';
    }, 1500);
    this.hintTimer = 10;
    if (this.touch) this.guideTimer = 7;
    this.onStart();
  }

  /** Also works before HUD/Input/renderer construction has completed. */
  static bootNotice(text: string): void {
    $('boot-status').textContent = text;
  }

  static bootFailure(stage: string, message: string, quality: QualityName, next: QualityName | null): void {
    const title = $('title'), button = $<HTMLButtonElement>('start');
    title.classList.remove('hidden');
    title.style.display = '';
    title.dataset.stage = 'ready';
    document.body?.classList.remove('entry-setup');
    $('hud').classList.add('hidden');
    $('boot-status').classList.add('error');
    $('boot-status').textContent = `加载失败：${stage}（${QUALITY_LABELS[quality]}画质）。${message}\n${next
      ? `将在 2.5 秒后自动改用「${QUALITY_LABELS[next]}」画质重试。`
      : '请关闭其他标签页后重试，并确认 Safari 已启用 WebGL；也可更新系统后再试。'}`;
    button.dataset.bootFailed = 'true';
    button.disabled = !!next;
    button.textContent = next ? '正在准备重试…' : '重试';
    button.onclick = () => location.reload();
  }

  cinemaLabel(on: boolean): void {
    $('cinema').textContent = `电影感 · ${on ? '开' : '关'}`;
    this.mark('seg-cinema', on ? '1' : '0');
  }

  soundLabel(on: boolean): void {
    $('sound').textContent = `声音 · ${on ? '开' : '关'}`;
    this.mark('seg-sound', on ? '1' : '0');
  }

  style(name: string): void {
    window.clearTimeout(this.styleTimeout);
    this.styleBox.textContent = name;
    this.styleBox.classList.remove('hidden');
    this.styleTimeout = window.setTimeout(() => this.styleBox.classList.add('hidden'), 1500);
  }

  /** Switch the copy and guide to touch once a finger is seen. */
  showTouch(): void {
    this.hint.classList.add('hidden');
    this.guide.style.display = 'block';
    if (!this.touch) {
      this.touch = true;
      this.renderKeys();
      // Touch noticed only after setting off (e.g. a laptop with a touch screen): guide once now.
      if (this.title.dataset.stage === 'leaving' && this.guideTimer <= 0) this.guideTimer = 4;
    }
  }

  /** Any real movement or look on touch retires the guide early. */
  touchUsed(): void {
    if (this.guideTimer > 1.2) this.guideTimer = 1.2;
  }

  loading(text: string): void {
    this.startButton.textContent = text;
  }

  ready(): void {
    this.startButton.disabled = false;
    this.startButton.textContent = '启程';
    if (this.title.dataset.stage === 'loading') this.stage('ready');
  }

  /** Skip the title screen (used by automated screenshots). */
  skipTitle(): void {
    this.title.style.display = 'none';
    this.root.classList.remove('hidden');
  }

  setOrbs(found: number, total: number, pop = false): void {
    this.orbCount.textContent = `${found} / ${total}`;
    if (pop) {
      this.orbPanel.classList.add('pop');
      setTimeout(() => this.orbPanel.classList.remove('pop'), 260);
    }
  }

  toast(text: string, seconds = 3.2): void {
    this.toastBox.textContent = text;
    this.toastBox.classList.remove('hidden');
    this.toastTimer = seconds;
  }

  zone(name: string, sub: string): void {
    if (this.title.dataset.stage === 'leaving' && this.title.style.display !== 'none') {
      // Let the title finish dissolving before the place name rises.
      window.setTimeout(() => this.zone(name, sub), 1600);
      return;
    }
    (this.zoneBox.querySelector('.name') as HTMLElement).textContent = name;
    (this.zoneBox.querySelector('.sub') as HTMLElement).textContent = sub;
    this.zoneBox.classList.remove('hidden');
    this.zoneTimer = 3.6;
  }

  update(dt: number, wind: Wind, cameraYaw: number, playerYaw: number): void {
    if (this.toastTimer > 0 && (this.toastTimer -= dt) <= 0) this.toastBox.classList.add('hidden');
    if (this.zoneTimer > 0 && (this.zoneTimer -= dt) <= 0) this.zoneBox.classList.add('hidden');
    if (this.hintTimer > 0 && (this.hintTimer -= dt) <= 0) this.hint.classList.add('hidden');
    if (this.guideTimer > 0) {
      this.guide.classList.remove('hidden');
      if ((this.guideTimer -= dt) <= 0) this.guide.classList.add('hidden');
    }

    // The dial is drawn as seen from the camera: up is the way you are looking.
    const fx = -Math.sin(cameraYaw);
    const fz = -Math.cos(cameraYaw);
    const rx = Math.cos(cameraYaw);
    const rz = -Math.sin(cameraYaw);
    const angle = Math.atan2(wind.dir.x * rx + wind.dir.y * rz, wind.dir.x * fx + wind.dir.y * fz);
    const scale = 0.72 + 0.28 * wind.gust;
    this.arrow.style.transform = `rotate(${angle}rad) scale(${scale})`;

    const gusting = wind.state === 'gust';
    this.windBox.classList.toggle('gust', gusting || wind.state === 'warning');
    const facing = Math.sin(playerYaw) * wind.dir.x + Math.cos(playerYaw) * wind.dir.y;
    this.windBox.classList.toggle('aligned', gusting && facing > 0.64);
    const left = Math.max(0, wind.timer / wind.duration);
    this.arc.setAttribute('stroke-dasharray', gusting ? `${left * 100} 100` : wind.state === 'warning' ? `${(1 - left) * 100} 100` : '0 100');
    this.windLabel.textContent =
      wind.state === 'gust' ? `阵风 · 向${wind.heading()}`
      : wind.state === 'warning' ? '风起'
      : wind.state === 'fading' ? '风息' : '微风';
  }
}
