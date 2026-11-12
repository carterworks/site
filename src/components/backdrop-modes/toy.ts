import { clamp } from "../emulated-canvas-limits";

/**
 * The 2D context a toy draws with: what a plain canvas's and an
 * `OffscreenCanvas`'s contexts share.
 */
export type ToyContext = Omit<OffscreenCanvasRenderingContext2D, "canvas">;

/**
 * What a toy draws on and listens to: a plain `<canvas>`, or an
 * `<emulated-canvas>`, which has the same shape. Its `width` and `height` are
 * the bitmap's, in pixels.
 */
export type ToyCanvas = HTMLElement & {
  width: number;
  height: number;
  getContext(contextId: "2d"): ToyContext | null;
};

/** The canvas ghost and noise intensity, both 0–100, that suit a toy. */
export type Look = { ghost: number; noise: number };

/**
 * A backdrop toy, written as it would be for any canvas. It draws through
 * `canvas.getContext("2d")`, in any colour, listens for pointer events on the
 * canvas itself, and runs its own `requestAnimationFrame` loop, which stops
 * scheduling once nothing moves. `start` returns the stop, which removes its
 * listeners and cancels its frames and timers.
 *
 * An owner may style what it draws: `<pixel-backdrop>` recolours it in the
 * theme's palette, lays noise under it and dissolves between toys, but the toy
 * never sees any of that. `look` is the ghost and noise it was tuned with, for
 * an owner that has them.
 */
export type Toy = {
  id: string;
  label: string;
  look?: Look;
  start(canvas: ToyCanvas): () => void;
};

/**
 * The width toys' sizes were tuned at: a size authored in its pixels scales
 * by `canvas.width / TUNED_GRID`, so it covers as much of any canvas.
 */
export const TUNED_GRID = 80;

const REFERENCE_WIDTH_PX = 1440;

/**
 * How many canvas pixels span one design cell of `designCellPx` pixels, with
 * the canvas `width` pixels drawn across the reference viewport. Multiply a
 * size authored in design cells by it to keep the same size on screen.
 */
export const cellScale = (designCellPx: number, width: number) =>
  (designCellPx * width) / REFERENCE_WIDTH_PX;

export type Point = { x: number; y: number };

/** A span of the canvas in pixels; `right` and `bottom` are exclusive. */
export type CellRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export const sameRect = (a: CellRect, b: CellRect) =>
  a.left === b.left &&
  a.top === b.top &&
  a.right === b.right &&
  a.bottom === b.bottom;

/**
 * Where a pointer event falls on the canvas, in its pixels: fractional, and
 * past its edges when the pointer is off it.
 */
export function pointOn(
  canvas: ToyCanvas,
  { clientX, clientY }: { clientX: number; clientY: number },
): Point {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) * canvas.width) / rect.width,
    y: ((clientY - rect.top) * canvas.height) / rect.height,
  };
}

let probe: HTMLElement | undefined;

/**
 * The small viewport: the area on screen even with mobile toolbars out, less
 * the safe areas a status bar or iOS's floating toolbar may sit over. Fitting
 * to the visual viewport instead would reshape a toy on every frame of a
 * scroll that slides the toolbars away. Only a probe can measure it, and a
 * page swap replaces the body it sits in.
 */
function smallViewport() {
  if (probe?.isConnected !== true) {
    probe = document.createElement("div");
    probe.ariaHidden = "true";
    probe.style.cssText = `
      position: fixed;
      left: env(safe-area-inset-left);
      top: env(safe-area-inset-top);
      inline-size: calc(100svw - env(safe-area-inset-left) - env(safe-area-inset-right));
      block-size: calc(100svh - env(safe-area-inset-top) - env(safe-area-inset-bottom));
      visibility: hidden;
      pointer-events: none;
    `;
    document.body.append(probe);
  }
  return probe.getBoundingClientRect();
}

/**
 * The part of the canvas on screen, in its pixels, for a toy to fit its scene
 * to: the backdrop's square canvas overhangs the viewport on one axis. A toy
 * measures it on start and on `resize`. A canvas not laid out yet counts as
 * visible whole.
 */
export function visibleCells(canvas: ToyCanvas): CellRect {
  const { width, height } = canvas;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return { left: 0, top: 0, right: width, bottom: height };
  }
  const view = smallViewport();
  const across = (offset: number, extent: number, count: number) =>
    clamp((offset * count) / extent, 0, count);
  return {
    left: across(view.left - rect.left, rect.width, width),
    top: across(view.top - rect.top, rect.height, height),
    right: across(view.right - rect.left, rect.width, width),
    bottom: across(view.bottom - rect.top, rect.height, height),
  };
}
