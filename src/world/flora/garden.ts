import type { ShrubKind } from './tree-models';

/**
 * Plants set by the builders: beds, urns, window boxes, hedges and climbers.
 * Buildings are put up before the trees are planted, so they leave their
 * plants here and the forest takes them in with everything else that grows.
 */
export interface Planting {
  kind: ShrubKind;
  x: number;
  y: number;
  z: number;
  scale: number;
  /** Which way the plant faces; a climber's front is its local +z. */
  turn?: number;
  /** Stretch along the plant's own x, y and z, for a long window box or a flattened bed. */
  stretch?: [number, number, number];
}

const queue: Planting[] = [];

export function plant(kind: ShrubKind, x: number, y: number, z: number, scale: number, turn?: number, stretch?: [number, number, number]): void {
  queue.push({ kind, x, y, z, scale, turn, stretch });
}

/** Everything planted so far, emptying the list. */
export function takePlantings(): Planting[] {
  return queue.splice(0);
}
