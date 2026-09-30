// Minimal typings for gifenc 1.0.3 (MIT, mattdesl): the package ships none. Only what src/export/media/gif.ts uses.
declare module 'gifenc' {
  export type Palette = number[][];
  export type QuantizeOptions = { format?: 'rgb565' | 'rgb444' | 'rgba4444'; oneBitAlpha?: boolean | number; clearAlpha?: boolean; clearAlphaThreshold?: number; clearAlphaColor?: number };
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, options?: QuantizeOptions): Palette;
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette, format?: 'rgb565' | 'rgb444' | 'rgba4444'): Uint8Array;
  export type WriteFrameOptions = { transparent?: boolean; transparentIndex?: number; delay?: number; palette?: Palette; repeat?: number; colorDepth?: number; dispose?: number };
  export function GIFEncoder(options?: { initialCapacity?: number; auto?: boolean }): {
    writeFrame(index: Uint8Array, width: number, height: number, options?: WriteFrameOptions): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
  };
}
