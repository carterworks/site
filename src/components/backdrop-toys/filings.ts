import { clamp } from "../../lib/clamp";
import { line } from "./line";
import {
  fixedStep,
  frameLoop,
  pointOn,
  visibleCells,
  type CellRect,
  type Point,
  type Toy,
} from "./toy";

const PITCH = 4;
const MIN_LENGTH = 2;
const MAX_LENGTH = 4;
const STEP_MS = 1000 / 60;
/** A frame after a long pause, like a hidden tab, replays this much, not the whole gap. */
const MAX_CATCH_UP_MS = 100;
/** The share of the visible height between the magnet's poles. */
const POLE_GAP = 0.12;
/** Per step, how far a filing, the dragged magnet and a hovered one close on their targets. */
const FILING_EASE = 0.3;
const DRAG_EASE = 0.3;
const HOVER_EASE = 0.1;
const TURN_EASE = 0.15;
/** Below these a filing or the magnet is where it is going, and stops. */
const ANGLE_EPSILON = 0.004;
const POSITION_EPSILON = 0.05;
/** A drag shorter than this per event is jitter, not a direction. */
const MIN_DRAG = 2;
const SOUTH_SIDE_LEVEL = 0.6;
const FIELD_FLOOR = 0.2;

/** The angle in (-half, half] a turn of `angle` is equal to, for a period of `period`. */
const wrap = (angle: number, period: number) =>
  angle - period * Math.round(angle / period);

/**
 * Iron filings over a hidden bar magnet. Each filing lies along the field of
 * the magnet's two poles, brighter where the field is strong and on the north
 * side. The pointer is the magnet's centre: hovering nudges it, dragging
 * carries it and turns it to face the way it travels, and a tap flips its
 * poles with a half turn. Filings swing round to their new angle over a few
 * frames, and the loop sleeps once they have all arrived.
 *
 * It draws white on transparent into its own image data put whole each frame.
 */
export const filings: Toy = {
  id: "filings",
  label: "Filings",
  look: { ghost: 30, noise: 6 },
  start(canvas) {
    const context = canvas.getContext("2d");
    if (context === null) return () => {};
    const { width, height } = canvas;
    const columns = Math.ceil(width / PITCH);
    const count = columns * Math.ceil(height / PITCH);
    const image = context.createImageData(width, height);
    const pixels = image.data;
    const x = new Float32Array(count);
    const y = new Float32Array(count);
    const half = new Float32Array(count);
    const angle = new Float32Array(count);
    const target = new Float32Array(count);
    const level = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      x[i] = ((i % columns) + 0.5 + (Math.random() - 0.5) * 0.8) * PITCH;
      y[i] =
        (Math.floor(i / columns) + 0.5 + (Math.random() - 0.5) * 0.8) * PITCH;
      half[i] = (MIN_LENGTH + Math.random() * (MAX_LENGTH - MIN_LENGTH)) / 2;
    }
    let visible = visibleCells(canvas);
    let gap = 0;
    const magnet = { x: 0, y: 0 };
    const goal = { x: 0, y: 0 };
    let heading = 0;
    let turn = 0;
    let flipped = false;
    let held = false;
    let dragged = false;
    let touched = false;
    let aimed = false;

    const centre = (rect: CellRect) => {
      gap = POLE_GAP * (rect.bottom - rect.top);
      magnet.x = goal.x = (rect.left + rect.right) / 2;
      magnet.y = goal.y = (rect.top + rect.bottom) / 2;
    };

    const aim = () => {
      const reach = gap / 2;
      const northX = magnet.x + Math.cos(turn) * reach;
      const northY = magnet.y + Math.sin(turn) * reach;
      const southX = magnet.x - Math.cos(turn) * reach;
      const southY = magnet.y - Math.sin(turn) * reach;
      const soften = gap * gap * 0.01;
      for (let i = 0; i < count; i += 1) {
        const nx = x[i] - northX;
        const ny = y[i] - northY;
        const sx = x[i] - southX;
        const sy = y[i] - southY;
        const nSquared = nx * nx + ny * ny + soften;
        const sSquared = sx * sx + sy * sy + soften;
        const nPull = 1 / (nSquared * Math.sqrt(nSquared));
        const sPull = 1 / (sSquared * Math.sqrt(sSquared));
        const fx = nx * nPull - sx * sPull;
        const fy = ny * nPull - sy * sPull;
        target[i] = Math.atan2(fy, fx);
        const strength = clamp((Math.hypot(fx, fy) * gap * gap) / 3, 0, 1);
        level[i] =
          (FIELD_FLOOR + (1 - FIELD_FLOOR) * Math.sqrt(strength)) *
          (nSquared < sSquared ? 1 : SOUTH_SIDE_LEVEL);
      }
    };

    const from: Point = { x: 0, y: 0 };
    const to: Point = { x: 0, y: 0 };
    let shade = 0;
    const plot = (column: number, row: number) => {
      if (column < 0 || row < 0 || column >= width || row >= height) return;
      const o = (row * width + column) * 4;
      pixels[o] = pixels[o + 1] = pixels[o + 2] = 255;
      pixels[o + 3] = shade;
    };

    const draw = () => {
      pixels.fill(0);
      for (let i = 0; i < count; i += 1) {
        const dx = Math.cos(angle[i]) * half[i];
        const dy = Math.sin(angle[i]) * half[i];
        from.x = Math.round(x[i] - dx);
        from.y = Math.round(y[i] - dy);
        to.x = Math.round(x[i] + dx);
        to.y = Math.round(y[i] + dy);
        shade = Math.round(level[i] * 255);
        line(from, to, plot);
      }
      context.putImageData(image, 0, 0);
    };

    const pace = fixedStep(STEP_MS, MAX_CATCH_UP_MS);
    let busy = false;

    const simulate = () => {
      const ease = held ? DRAG_EASE : HOVER_EASE;
      const dx = goal.x - magnet.x;
      const dy = goal.y - magnet.y;
      const travelling = Math.abs(dx) + Math.abs(dy) > POSITION_EPSILON;
      magnet.x += travelling ? dx * ease : dx;
      magnet.y += travelling ? dy * ease : dy;

      const toTurn = wrap(
        heading + (flipped ? Math.PI : 0) - turn,
        2 * Math.PI,
      );
      const turning = Math.abs(toTurn) > ANGLE_EPSILON;
      turn += turning ? toTurn * TURN_EASE : toTurn;

      if (travelling || turning || !aimed) {
        aim();
        aimed = true;
      }

      busy = travelling || turning;
      for (let i = 0; i < count; i += 1) {
        const off = wrap(target[i] - angle[i], Math.PI);
        const arriving = Math.abs(off) > ANGLE_EPSILON;
        angle[i] += arriving ? off * FILING_EASE : off;
        busy ||= arriving;
      }
    };

    const step = (now: number) => {
      pace.advance(now, simulate);
      draw();
      if (!busy) pace.restart();
      return busy;
    };

    const { wake, stop } = frameLoop(step);

    const onDown = (event: PointerEvent) => {
      held = true;
      dragged = false;
      const point = pointOn(canvas, event);
      goal.x = point.x;
      goal.y = point.y;
      touched = true;
      wake();
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "touch" && !held) return;
      const point = pointOn(canvas, event);
      if (held && Math.hypot(point.x - goal.x, point.y - goal.y) >= MIN_DRAG) {
        heading = Math.atan2(point.y - goal.y, point.x - goal.x);
        dragged = true;
      }
      goal.x = point.x;
      goal.y = point.y;
      touched = true;
      wake();
    };

    const onUp = () => {
      if (held && !dragged) flipped = !flipped;
      held = false;
      wake();
    };

    const onCancel = () => {
      held = false;
    };

    const onResize = () => {
      visible = visibleCells(canvas);
      if (touched) return;
      centre(visible);
      aimed = false;
      wake();
    };

    centre(visible);
    const listening = new AbortController();
    const { signal } = listening;
    canvas.addEventListener("pointerdown", onDown, { signal });
    canvas.addEventListener("pointermove", onMove, { signal });
    canvas.addEventListener("pointerup", onUp, { signal });
    canvas.addEventListener("pointercancel", onCancel, { signal });
    window.addEventListener("resize", onResize, { signal });
    wake();

    return () => {
      listening.abort();
      stop();
    };
  },
};
