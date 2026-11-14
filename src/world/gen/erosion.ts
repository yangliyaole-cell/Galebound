/**
 * Landscape evolution on a square grid: rain collects into streams, streams cut
 * valleys (stream-power law, solved implicitly), slopes steeper than the rock
 * can hold slump, and soil creeps downhill. Base-level cells (sea, lakes, the
 * surveyed rivers) never move and everything else drains toward them, so the
 * valleys that appear are tributaries of the designed water.
 */
export interface ErosionOptions {
  /** Points per side. */
  n: number;
  /** Metres between points. */
  cell: number;
  iterations: number;
  /** Erodibility x time step: the fraction a headwater cell moves toward its outlet per iteration. About 0.003 to 0.02. */
  strength: Float32Array | number;
  /** Drainage-area exponent; 0.4 to 0.5. */
  m: number;
  /** Metres added per iteration to every free cell. */
  uplift?: Float32Array;
  /** 1 where the height is a fixed base level. */
  fixed: Uint8Array;
  /** Steepest stable slope (rise / run). */
  talus: Float32Array | number;
  /** 0..0.2: soil creep per iteration. */
  creep: number;
  /** Called after each iteration, for progress and previews. */
  onStep?: (iteration: number) => void;
}

export interface Drainage {
  /** Upstream area in square metres. */
  area: Float32Array;
  /** Index of the cell each cell drains to (itself for a base-level cell). */
  receiver: Int32Array;
}

const NX = [1, 1, 0, -1, -1, -1, 0, 1];
const NZ = [0, 1, 1, 1, 0, -1, -1, -1];

export function erode(h: Float32Array, opt: ErosionOptions): Drainage {
  const { n, cell, fixed } = opt;
  const count = n * n;
  const area = new Float32Array(count);
  const receiver = new Int32Array(count);
  const order = new Int32Array(count);
  const filled = new Float32Array(count);
  const seen = new Uint8Array(count);
  const scratch = new Float32Array(count);
  // Binary min-heap of cell indices keyed by flooded height.
  const heap = new Int32Array(count);
  let size = 0;
  const push = (c: number): void => {
    let i = size++;
    const key = filled[c];
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (filled[heap[p]] <= key) break;
      heap[i] = heap[p]; i = p;
    }
    heap[i] = c;
  };
  const pop = (): number => {
    const top = heap[0];
    const last = heap[--size];
    const key = filled[last];
    let i = 0;
    for (;;) {
      let c = i * 2 + 1;
      if (c >= size) break;
      if (c + 1 < size && filled[heap[c + 1]] < filled[heap[c]]) c++;
      if (filled[heap[c]] >= key) break;
      heap[i] = heap[c]; i = c;
    }
    heap[i] = last;
    return top;
  };
  const weights = new Float64Array(8);
  const hash = (c: number, it: number): number => {
    let v = Math.imul(c + 1, 374761393) ^ Math.imul(it + 7, 668265263);
    v = Math.imul(v ^ (v >>> 13), 1274126177);
    return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
  };
  const strengthAt = typeof opt.strength === 'number' ? null : opt.strength;
  const talusAt = typeof opt.talus === 'number' ? null : opt.talus;
  const cellArea = cell * cell;
  const diagonal = cell * Math.SQRT2;

  for (let it = 0; it < opt.iterations; it++) {
    if (opt.uplift) for (let i = 0; i < count; i++) if (!fixed[i]) h[i] += opt.uplift[i];

    // Priority flood from every base-level and border cell. The pop order runs
    // from outlets upstream, and each cell's parent is its lowest neighbour.
    seen.fill(0);
    size = 0;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const c = j * n + i;
      if (fixed[c] || i === 0 || j === 0 || i === n - 1 || j === n - 1) {
        seen[c] = 1; receiver[c] = c; filled[c] = h[c]; push(c);
      }
    }
    let k = 0;
    while (size > 0) {
      const c = pop();
      order[k++] = c;
      const ci = c % n, cj = (c - ci) / n;
      for (let d = 0; d < 8; d++) {
        const i = ci + NX[d], j = cj + NZ[d];
        if (i < 0 || j < 0 || i >= n || j >= n) continue;
        const q = j * n + i;
        if (seen[q]) continue;
        seen[q] = 1; receiver[q] = c;
        filled[q] = Math.max(h[q], filled[c] + 1e-3);
        push(q);
      }
    }

    // On an even slope, steepest descent can only follow the eight grid directions
    // and draws ruled parallel valleys. Let each cell instead choose among its lower
    // neighbours, favouring the steepest, and choose afresh every iteration.
    for (let o = 0; o < count; o++) {
      const c = order[o];
      if (receiver[c] === c) continue;
      const ci = c % n, cj = (c - ci) / n, here = filled[c];
      let total = 0;
      for (let d = 0; d < 8; d++) {
        const i = ci + NX[d], j = cj + NZ[d];
        if (i < 0 || j < 0 || i >= n || j >= n) { weights[d] = 0; continue; }
        const drop = here - filled[j * n + i];
        const w = drop > 2e-3 ? drop / (d & 1 ? diagonal : cell) : 0;
        weights[d] = w * w * w;
        total += weights[d];
      }
      if (total <= 0) continue;
      let pick = hash(c, it) * total;
      for (let d = 0; d < 8; d++) {
        pick -= weights[d];
        if (pick <= 0 && weights[d] > 0) { receiver[c] = (cj + NZ[d]) * n + ci + NX[d]; break; }
      }
    }

    area.fill(cellArea);
    for (let o = count - 1; o >= 0; o--) {
      const c = order[o], r = receiver[c];
      if (r !== c) area[r] += area[c];
    }

    for (let o = 0; o < count; o++) {
      const c = order[o], r = receiver[c];
      if (r === c) continue;
      const step = Math.abs(c - r);
      const length = step === 1 || step === n ? cell : diagonal;
      const f = (strengthAt ? strengthAt[c] : opt.strength as number) * Math.pow(area[c] / cellArea, opt.m) * cell / length;
      let v = (h[c] + f * h[r]) / (1 + f);
      const limit = h[r] + (talusAt ? talusAt[c] : opt.talus as number) * length;
      if (v > limit) v = limit;
      h[c] = v;
    }

    if (opt.creep > 0) {
      scratch.set(h);
      for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
        const c = j * n + i;
        if (fixed[c]) continue;
        h[c] += opt.creep * (scratch[c - 1] + scratch[c + 1] + scratch[c - n] + scratch[c + n] - 4 * scratch[c]);
      }
    }
    opt.onStep?.(it);
  }
  return { area, receiver };
}
