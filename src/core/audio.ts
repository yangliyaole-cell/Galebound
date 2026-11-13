/**
 * All sound is synthesised: wind from filtered noise, chimes and a slow
 * drifting melody from oscillators. Nothing is downloaded.
 */
export class Sound {
  muted = false;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private echo: DelayNode | null = null;
  private noise: AudioBuffer | null = null;
  private nextNote = 0;
  private nextBird = 4;
  private lastNote = 2;

  /** Must be called from a click or tap; browsers block audio otherwise. */
  start(): void {
    if (this.ctx) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.9;
    master.connect(ctx.destination);
    this.master = master;

    const len = ctx.sampleRate * 2;
    const noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noise.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      // Slightly smoothed noise: less hiss, more rush.
      last = last * 0.6 + (Math.random() * 2 - 1) * 0.4;
      data[i] = last;
    }
    this.noise = noise;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 400;
    filter.Q.value = 0.6;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(master);
    src.start();
    this.windFilter = filter;
    this.windGain = gain;

    // A feedback delay gives the notes a soft tail.
    const echo = ctx.createDelay(1);
    echo.delayTime.value = 0.42;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.38;
    echo.connect(feedback).connect(echo);
    echo.connect(master);
    this.echo = echo;
  }

  toggle(): boolean {
    this.muted = !this.muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.05);
    return !this.muted;
  }

  private tone(freq: number, when: number, attack: number, release: number, volume: number, type: OscillatorType = 'sine', wet = true): void {
    const { ctx, master, echo } = this;
    if (!ctx || !master) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(volume, when + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + attack + release);
    osc.connect(g);
    g.connect(master);
    if (wet && echo) g.connect(echo);
    osc.start(when);
    osc.stop(when + attack + release + 0.05);
  }

  private burst(when: number, duration: number, freq: number, volume: number): void {
    const { ctx, master, noise } = this;
    if (!ctx || !master || !noise) return;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(volume, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    src.connect(filter).connect(g).connect(master);
    src.start(when, Math.random() * 1.5, duration + 0.05);
  }

  /** Rising arpeggio; climbs a little higher with each orb found. */
  chime(count: number): void {
    if (!this.ctx) return;
    const scale = [0, 2, 4, 7, 9];
    const t = this.ctx.currentTime;
    const base = 587.33 * Math.pow(2, scale[count % 5] / 12);
    [1, 1.5, 2, 3].forEach((m, i) => this.tone(base * m, t + i * 0.085, 0.01, 1.3, 0.11, 'sine'));
    this.tone(base * 4, t + 0.34, 0.01, 1.8, 0.05, 'triangle');
  }

  step(running: boolean): void {
    if (this.ctx) this.burst(this.ctx.currentTime, 0.07, running ? 900 : 650, running ? 0.09 : 0.05);
  }

  jump(): void {
    if (this.ctx) this.burst(this.ctx.currentTime, 0.14, 1400, 0.08);
  }

  land(impact: number): void {
    if (this.ctx) this.burst(this.ctx.currentTime, 0.2, 380, Math.min(0.35, 0.06 + impact * 0.012));
  }

  splash(): void {
    if (this.ctx) this.burst(this.ctx.currentTime, 0.5, 2600, 0.22);
  }

  /** Cloths snapping open. */
  whoosh(): void {
    if (this.ctx) this.burst(this.ctx.currentTime, 0.7, 1800, 0.25);
  }

  /**
   * @param wind 0..1 gust strength
   * @param rush 0..1 how fast the air passes the player's ears
   */
  update(dt: number, wind: number, rush: number): void {
    const { ctx } = this;
    if (!ctx || !this.windGain || !this.windFilter) return;
    const t = ctx.currentTime;
    const level = 0.035 + wind * 0.2 + rush * 0.3;
    this.windGain.gain.setTargetAtTime(level, t, 0.4);
    this.windFilter.frequency.setTargetAtTime(320 + wind * 500 + rush * 900, t, 0.4);

    // A slow pentatonic melody that never quite repeats.
    this.nextNote -= dt;
    if (this.nextNote <= 0) {
      const scale = [146.83, 164.81, 185, 220, 246.94, 293.66, 329.63, 369.99, 440];
      this.lastNote = Math.max(0, Math.min(scale.length - 1, this.lastNote + Math.floor(Math.random() * 5) - 2));
      const f = scale[this.lastNote];
      this.tone(f * 2, t, 0.9, 4.5, 0.04, 'sine');
      this.tone(f * 3, t, 1.2, 3.5, 0.012, 'triangle');
      if (Math.random() < 0.35) this.tone(f, t, 1.5, 6, 0.035, 'sine', false);
      this.nextNote = 2.2 + Math.random() * 3.6;
    }
    // Birdsong when the air is calm.
    this.nextBird -= dt;
    if (this.nextBird <= 0) {
      this.nextBird = 5 + Math.random() * 9;
      if (wind < 0.5) {
        const base = 2400 + Math.random() * 1600;
        const notes = 2 + Math.floor(Math.random() * 4);
        for (let i = 0; i < notes; i++) {
          this.tone(base * (1 + (Math.random() - 0.4) * 0.25), t + i * 0.11, 0.015, 0.09, 0.022, 'sine', false);
        }
      }
    }
  }
}
