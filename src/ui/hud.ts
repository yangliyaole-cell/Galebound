import { QUALITY_NAMES, storeTier, storedTier, type QualityName } from '../core/quality';
import type { Wind } from '../world/wind';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

/** Everything drawn over the game: counters, the wind dial, messages, touch buttons. */
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
  private toastTimer = 0;
  private zoneTimer = 0;
  private hintTimer = 14;
  private readonly styleBox = $('style-label');
  private styleTimeout = 0;

  onStart: () => void = () => {};
  onJump: () => void = () => {};
  onRun: () => boolean = () => false;
  onSound: () => boolean = () => true;
  onCinema: () => Promise<boolean> = async () => false;

  constructor(touch: boolean, tier: QualityName) {
    $('keys').innerHTML = touch
      ? '左侧拖动：移动（推到底奔跑）　右侧拖动：视角　双指：缩放'
      : 'WASD 移动　·　Shift 奔跑　·　空格 跳跃　·　鼠标 视角　·　滚轮 缩放<br />空中再按空格：张开风布滑翔　·　A / D 转向　·　W 俯冲　·　S 拉升　·　按住 Shift 收臂加速　·　空格 收起风布';
    this.hint.textContent = touch ? '' : 'WASD 移动 · Shift 奔跑 · 空格 跳跃 · 鼠标 视角';
    if (touch) this.showTouch();

    this.startButton.addEventListener('click', () => {
      this.title.classList.add('hidden');
      this.root.classList.remove('hidden');
      setTimeout(() => (this.title.style.display = 'none'), 1200);
      this.onStart();
    });
    const jump = $('jump');
    jump.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.onJump();
    });
    const run = $('run');
    run.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      run.classList.toggle('on', this.onRun());
    });

    const names: Record<string, string> = { auto: '自动', low: '低', medium: '中', high: '高', ultra: '极致' };
    const quality = $('quality');
    const stored = storedTier();
    quality.textContent = `画质：${stored === 'auto' ? `自动（${names[tier]}）` : names[stored]}`;
    quality.addEventListener('click', () => {
      // Changing tier rebuilds the world, so reload.
      const order: (QualityName | 'auto')[] = ['auto', ...QUALITY_NAMES];
      storeTier(order[(order.indexOf(storedTier()) + 1) % order.length]);
      location.reload();
    });
    const sound = $('sound');
    sound.addEventListener('click', () => {
      sound.textContent = `声音：${this.onSound() ? '开' : '关'}`;
    });
    sound.textContent = '声音：开';
    const cinema = $('cinema');
    cinema.addEventListener('click', () => {
      void this.onCinema().then((on) => this.cinemaLabel(on)).catch(() => this.toast('风格加载失败，请重试'));
    });
  }

  cinemaLabel(on: boolean): void {
    $('cinema').textContent = `电影感：${on ? '开' : '关'}`;
  }

  style(name: string): void {
    window.clearTimeout(this.styleTimeout);
    this.styleBox.textContent = name;
    this.styleBox.classList.remove('hidden');
    this.styleTimeout = window.setTimeout(() => this.styleBox.classList.add('hidden'), 1500);
  }

  showTouch(): void {
    this.hint.classList.add('hidden');
    $('touch').style.display = 'block';
  }

  loading(text: string): void {
    this.startButton.textContent = text;
  }

  ready(): void {
    this.startButton.disabled = false;
    this.startButton.textContent = '启程';
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

  toast(text: string, seconds = 3.5): void {
    this.toastBox.textContent = text;
    this.toastBox.classList.remove('hidden');
    this.toastTimer = seconds;
  }

  zone(name: string, sub: string): void {
    (this.zoneBox.querySelector('.name') as HTMLElement).textContent = name;
    (this.zoneBox.querySelector('.sub') as HTMLElement).textContent = sub;
    this.zoneBox.classList.remove('hidden');
    this.zoneTimer = 3.6;
  }

  update(dt: number, wind: Wind, cameraYaw: number, playerYaw: number): void {
    if (this.toastTimer > 0 && (this.toastTimer -= dt) <= 0) this.toastBox.classList.add('hidden');
    if (this.zoneTimer > 0 && (this.zoneTimer -= dt) <= 0) this.zoneBox.classList.add('hidden');
    if (this.hintTimer > 0 && (this.hintTimer -= dt) <= 0) this.hint.classList.add('hidden');

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
      : wind.state === 'warning' ? '阵风将至'
      : wind.state === 'fading' ? '风渐息' : '微风';
  }
}
