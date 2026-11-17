import * as THREE from 'three';

/** Lossless CPU storage only. WebGL still receives the original Float32 attribute. */
export interface FloatBlock {
  readonly length: number;
  readonly bytes: number;
  get(index: number): number;
  unpack(): Float32Array;
}

export function packFloats(array: Float32Array): FloatBlock {
  const words = new Uint32Array(array.buffer, array.byteOffset, array.length);
  const dictionary = new Map<number, number>(), ids = new Uint32Array(array.length);
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    let id = dictionary.get(word);
    if (id === undefined) { id = dictionary.size; dictionary.set(word, id); }
    ids[i] = id;
  }
  const bits = Math.ceil(Math.log2(Math.max(1, dictionary.size)));
  const packedLength = Math.ceil(array.length * bits / 32);
  if (dictionary.size * 4 + packedLength * 4 >= array.byteLength) {
    return rawBlock(array);
  }
  const values = new Float32Array(dictionary.size), valueWords = new Uint32Array(values.buffer);
  for (const [word, id] of dictionary) valueWords[id] = word;
  const packed = new Uint32Array(packedLength);
  for (let i = 0; i < ids.length; i++) {
    const at = i * bits, slot = Math.floor(at / 32), shift = at % 32;
    packed[slot] |= ids[i] << shift;
    if (shift + bits > 32) packed[slot + 1] |= ids[i] >>> (32 - shift);
  }
  return packedBlock(values, packed, bits, array.length);
}

// Separate scope: the retained decoder must not capture the encoder's source/dictionary/IDs.
function packedBlock(values: Float32Array, packed: Uint32Array, bits: number, length: number): FloatBlock {
  const mask = 2 ** bits - 1;
  const get = (index: number): number => {
    if (bits === 0) return values[0];
    const at = index * bits, slot = Math.floor(at / 32), shift = at % 32;
    let id = packed[slot] >>> shift;
    if (shift + bits > 32) id |= packed[slot + 1] << (32 - shift);
    return values[id & mask];
  };
  return {
    length, bytes: values.byteLength + packed.byteLength, get,
    unpack() {
      const output = new Float32Array(length);
      for (let i = 0; i < output.length; i++) output[i] = get(i);
      return output;
    },
  };
}
function rawBlock(array: Float32Array): FloatBlock {
  return { length: array.length, bytes: array.byteLength, get: index => array[index], unpack: () => array };
}

/** Bounds, PBR classification and Node ray audits read individual values without expanding
 * the entire attribute. Only WebGL's .array access materializes the final contiguous copy.
 * Once materialized, the encoded blocks are discarded; onUpload may then discard that copy.
 */
export class PackedStaticAttribute extends THREE.BufferAttribute {
  private blocks: FloatBlock[];
  private readonly ends: number[] = [];
  private blockIndex = 0;
  private dense: Float32Array | null | undefined;

  constructor(blocks: FloatBlock[], itemSize: number) {
    super(new Float32Array(0), itemSize);
    this.blocks = blocks;
    let length = 0;
    for (const block of blocks) { length += block.length; this.ends.push(length); }
    Object.defineProperty(this, 'count', { value: length / itemSize });
    Object.defineProperty(this, 'array', {
      configurable: true,
      get: () => {
        if (this.dense === undefined) {
          const output = new Float32Array(length);
          let offset = 0;
          for (const block of this.blocks) { output.set(block.unpack(), offset); offset += block.length; }
          this.dense = output;
          this.blocks = []; // Never retain both compressed and contiguous copies after upload preparation.
        }
        return this.dense;
      },
      set: (value: Float32Array | null) => { this.dense = value; this.blocks = []; },
    });
  }

  override clone(): THREE.BufferAttribute {
    return new THREE.BufferAttribute(new Float32Array(this.array), this.itemSize, this.normalized).setUsage(this.usage);
  }
  get cpuBytes(): number {
    return this.dense ? this.dense.byteLength : this.blocks.reduce((sum, block) => sum + block.bytes, 0);
  }
  private scalar(index: number): number {
    if (this.dense) return this.dense[index];
    if (this.dense === null) throw new Error('Static geometry CPU data was released after upload');
    let block = this.blockIndex, start = block ? this.ends[block - 1] : 0;
    if (index < start || index >= this.ends[block]) {
      let lo = 0, hi = this.ends.length - 1;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (index < this.ends[mid]) hi = mid; else lo = mid + 1; }
      block = this.blockIndex = lo; start = block ? this.ends[block - 1] : 0;
    }
    return this.blocks[block].get(index - start);
  }
  override getX(index: number): number { return this.scalar(index * this.itemSize); }
  override getY(index: number): number { return this.scalar(index * this.itemSize + 1); }
  override getZ(index: number): number { return this.scalar(index * this.itemSize + 2); }
  override getW(index: number): number { return this.scalar(index * this.itemSize + 3); }
  override getComponent(index: number, component: number): number { return this.scalar(index * this.itemSize + component); }
}
