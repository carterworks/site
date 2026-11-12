import { clamp } from "../../lib/clamp";
import { line } from "./line";
import {
  fixedStep,
  pointOn,
  TUNED_GRID,
  visibleCells,
  type Point,
  type Toy,
} from "./toy";

const DISC_PX = 3;
const GAP_SHARE = 1 / 6;
const DARK_ALPHA = 60;
const EDGE_ALPHA = 170;
const LIGHT_ALPHA = 255;

const STEP_MS = 1000 / 60;
const MAX_CATCH_UP_MS = 100;
/** A flip is old face half shut, edge on, new face half open: three phases. */
const PHASE_STEPS = 3;
const FLIP_PHASES = 3;
const DOUBLE_TAP_MS = 350;
const WIPE_STEPS_PER_COLUMN = 2;
const IDLE_MS = 3000;
const BAND_PERIOD = 16;
const BAND_WIDTH = 4;
const BAND_STEPS_PER_DIAGONAL = 2;

/**
 * A flip-disc sign. Moving the pointer across a disc flips it to its other
 * face, squashing through an edge-on line; a stroke flips each disc once
 * until the pointer leaves it. A press flips a plus of five discs, and a
 * second press soon after wipes the board back to dark in a wave from the
 * left.
 *
 * Three seconds after the last input one diagonal band of discs flips in a
 * slow sweep, once, then the toy is still. Only discs mid-flip are stepped
 * and drawn, so the loop sleeps with none.
 *
 * It draws white on transparent, the face as opacity, into its own image data
 * put whole each frame.
 */
export const flipdots: Toy = {
  id: "flipdots",
  label: "Flip dots",
  look: { ghost: 20, noise: 6 },
  start(canvas) {
    const context = canvas.getContext("2d");
    if (context === null) return () => {};
    const { width, height } = canvas;
    const pitch = Math.max(DISC_PX, Math.round((DISC_PX * width) / TUNED_GRID));
    const size = pitch - Math.max(1, Math.round(pitch * GAP_SHARE));
    const columns = Math.floor(width / pitch);
    const rows = Math.floor(height / pitch);
    const left = Math.floor((width - columns * pitch) / 2);
    const top = Math.floor((height - rows * pitch) / 2);
    const image = context.createImageData(width, height);
    const pixels = image.data;
    const discs = columns * rows;
    const face = new Uint8Array(discs);
    const want = new Uint8Array(discs);
    const phase = new Uint8Array(discs);
    const ticks = new Uint8Array(discs);
    const delay = new Uint16Array(discs);
    const isActive = new Uint8Array(discs);
    const active = new Int32Array(discs);
    let activeCount = 0;
    let visible = visibleCells(canvas);
    const last: Point = { x: -1, y: -1 };
    const here: Point = { x: 0, y: 0 };
    let lastTapAt = -Infinity;
    let changed = false;
    let frame: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const drawDisc = (index: number) => {
      const column = index % columns;
      const row = (index - column) / columns;
      const squashed = phase[index] === 1 || phase[index] === 3;
      const edgeOn = phase[index] === 2;
      const alpha = edgeOn
        ? EDGE_ALPHA
        : face[index] === 1
          ? LIGHT_ALPHA
          : DARK_ALPHA;
      const shut = edgeOn ? 1 : squashed ? Math.round(size / 2) : size;
      const first = Math.floor((size - shut) / 2);
      const x0 = left + column * pitch;
      const y0 = top + row * pitch;
      for (let y = 0; y < size; y += 1) {
        const lit = y >= first && y < first + shut;
        for (let x = 0; x < size; x += 1) {
          const at = ((y0 + y) * width + x0 + x) * 4;
          pixels[at] = pixels[at + 1] = pixels[at + 2] = 255;
          pixels[at + 3] = lit ? alpha : 0;
        }
      }
      changed = true;
    };

    const activate = (index: number) => {
      if (isActive[index] === 1) return;
      isActive[index] = 1;
      active[activeCount++] = index;
    };

    const request = (index: number, to: number, after = 0) => {
      want[index] = to;
      delay[index] = after;
      if (face[index] !== to || phase[index] !== 0) activate(index);
    };

    const flip = (index: number) => {
      if (isActive[index] === 0) request(index, 1 - face[index]);
    };

    const advance = (index: number) => {
      if (delay[index] > 0) {
        delay[index] -= 1;
        return true;
      }
      if (phase[index] === 0) {
        if (face[index] === want[index]) return false;
        phase[index] = 1;
        ticks[index] = 0;
        drawDisc(index);
        return true;
      }
      ticks[index] += 1;
      if (ticks[index] < PHASE_STEPS) return true;
      ticks[index] = 0;
      if (phase[index] === 2) face[index] = 1 - face[index];
      phase[index] = phase[index] === FLIP_PHASES ? 0 : phase[index] + 1;
      drawDisc(index);
      return true;
    };

    const simulate = () => {
      let kept = 0;
      for (let k = 0; k < activeCount; k += 1) {
        const index = active[k];
        if (advance(index)) active[kept++] = index;
        else isActive[index] = 0;
      }
      activeCount = kept;
    };

    const pace = fixedStep(STEP_MS, MAX_CATCH_UP_MS);

    const step = (now: number) => {
      frame = undefined;
      pace.advance(now, simulate);
      if (changed) {
        context.putImageData(image, 0, 0);
        changed = false;
      }
      if (activeCount > 0) wake();
      else pace.restart();
    };

    const wake = () => {
      frame ??= requestAnimationFrame(step);
    };

    const wipe = () => {
      for (let index = 0; index < discs; index += 1) {
        request(index, 0, (index % columns) * WIPE_STEPS_PER_COLUMN);
      }
    };

    const sweepBand = () => {
      timer = undefined;
      const from = Math.max(0, Math.floor((visible.left - left) / pitch));
      const to = Math.min(columns, Math.ceil((visible.right - left) / pitch));
      const above = Math.max(0, Math.floor((visible.top - top) / pitch));
      const below = Math.min(rows, Math.ceil((visible.bottom - top) / pitch));
      for (let row = above; row < below; row += 1) {
        for (let column = from; column < to; column += 1) {
          const diagonal = column + row;
          if (diagonal % BAND_PERIOD >= BAND_WIDTH) continue;
          const index = row * columns + column;
          if (isActive[index] === 0) {
            request(index, 1 - face[index], diagonal * BAND_STEPS_PER_DIAGONAL);
          }
        }
      }
      wake();
    };

    const discAt = (event: PointerEvent, into: Point) => {
      const point = pointOn(canvas, event);
      into.x = clamp(Math.floor((point.x - left) / pitch), 0, columns - 1);
      into.y = clamp(Math.floor((point.y - top) / pitch), 0, rows - 1);
    };

    const touched = () => {
      clearTimeout(timer);
      timer = setTimeout(sweepBand, IDLE_MS);
      wake();
    };

    const onMove = (event: PointerEvent) => {
      discAt(event, here);
      if (last.x < 0) {
        last.x = here.x;
        last.y = here.y;
        flip(here.y * columns + here.x);
      } else if (here.x !== last.x || here.y !== last.y) {
        line(last, here, (x, y) => {
          if (x !== last.x || y !== last.y) flip(y * columns + x);
        });
        last.x = here.x;
        last.y = here.y;
      }
      touched();
    };

    const onDown = (event: PointerEvent) => {
      discAt(event, here);
      last.x = here.x;
      last.y = here.y;
      const doubled = performance.now() - lastTapAt < DOUBLE_TAP_MS;
      lastTapAt = doubled ? -Infinity : performance.now();
      if (doubled) wipe();
      else {
        flip(here.y * columns + here.x);
        if (here.x > 0) flip(here.y * columns + here.x - 1);
        if (here.x < columns - 1) flip(here.y * columns + here.x + 1);
        if (here.y > 0) flip((here.y - 1) * columns + here.x);
        if (here.y < rows - 1) flip((here.y + 1) * columns + here.x);
      }
      touched();
    };

    const onLeave = () => {
      last.x = last.y = -1;
    };

    const onResize = () => {
      visible = visibleCells(canvas);
    };

    for (let index = 0; index < discs; index += 1) drawDisc(index);
    context.putImageData(image, 0, 0);
    changed = false;

    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerleave", onLeave);
    window.addEventListener("resize", onResize);

    return () => {
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(frame ?? 0);
      clearTimeout(timer);
    };
  },
};
