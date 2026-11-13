import { clamp } from "../../lib/clamp";
import {
  fixedStep,
  frameLoop,
  pointOn,
  TUNED_GRID,
  visibleCells,
  type Point,
  type Toy,
} from "./toy";

const COUNT = 60;
const STEP_MS = 1000 / 60;
/** A tab that was hidden resumes with a few steps, not the whole gap. */
const MAX_OWED_MS = 5 * STEP_MS;

const PERIOD_STEPS = 72;
const PERIOD_SPREAD = 0.04;
const FLASH_STEPS = 10;
/**
 * Mirollo–Strogatz coupling: each flash lifts a neighbour's concave charge,
 * x = ln(1 + (e^b − 1)φ) / b, by `PULSE`. That pushes a late firefly further
 * than an early one, which is what pulls the swarm into step.
 */
const CONCAVITY = 3;
const PULSE = 0.015;
/**
 * How many fireflies a flash reaches on average. The coupling radius is fitted
 * to the visible area to keep it, so the swarm takes as long to fall into sync
 * on a phone held upright as on a wide screen.
 */
const NEIGHBOURS = 12;

const TURN = 0.2;
const STEER = 0.05;
const RESTING_ALPHA = 70;
const BEACON_STEPS = 14;
/** A firefly near a tap is set to flash this many steps later, further out later still, so replies ripple outward. */
const REPLY_STEPS = 14;
const REPLY_SPREAD_STEPS = 16;

/** Sizes and speeds below are in pixels of the tuned width. */
const SPEED = 0.06;
/** Wide enough that a whole flash, not only its centre, stays on screen. */
const MARGIN = 2;
const BODY_RADIUS = 0.5;
const GLOW_RADIUS = 1.25;
const BEACON_RADIUS = 3;
const TAP_RADIUS = 24;
const ATTRACT_RADIUS = 30;
const ATTRACT = 0.006;
/** Inside this they only wander, so they mill around the pointer rather than pile onto it. */
const ORBIT = 5;

const IDLE_STEPS = 20 * 60;
const FADE_OUT_STEPS = 120;
const FADE_IN_STEPS = 30;

/**
 * A swarm of fireflies drifting in the dark, each blinking on its own clock.
 * A flash nudges the clocks of those nearby forward, so over a quarter of a
 * minute the swarm falls into blinking as one. A tap flashes at the pointer
 * and the fireflies around it flash back, and a hovering pointer draws the
 * nearest toward it. Left alone a while they settle and dim out, and the toy
 * stops asking for frames until the next input.
 *
 * It is simulated in fixed 60 Hz steps, with neighbours found through a
 * coarse grid, and drawn white by alpha into its own image data.
 */
export const fireflies: Toy = {
  id: "fireflies",
  label: "Fireflies",
  look: { ghost: 60, noise: 8 },
  start(canvas) {
    const context = canvas.getContext("2d");
    if (context === null) return () => {};
    const { width, height } = canvas;
    const scale = width / TUNED_GRID;
    const image = context.createImageData(width, height);
    const pixels = image.data;
    const pace = fixedStep(STEP_MS, MAX_OWED_MS);

    const x = new Float32Array(COUNT);
    const y = new Float32Array(COUNT);
    const vx = new Float32Array(COUNT);
    const vy = new Float32Array(COUNT);
    const heading = new Float32Array(COUNT);
    const phase = new Float32Array(COUNT);
    const rate = new Float32Array(COUNT);
    const flash = new Uint8Array(COUNT);
    const firedAt = new Int32Array(COUNT).fill(-1);
    const queue = new Int32Array(COUNT);

    const next = new Int32Array(COUNT);
    let head = new Int32Array(0);
    let cell = 0;
    let gridColumns = 0;
    let gridRows = 0;
    const charged = Math.expm1(CONCAVITY);
    const lift = Math.exp(CONCAVITY * PULSE);

    const bounds = { left: 0, top: 0, right: 0, bottom: 0 };
    const press: Point = { x: 0, y: 0 };
    const pointer: Point = { x: 0, y: 0 };
    let pressed = false;
    let hovering = false;
    let beacon = 0;
    const beaconAt: Point = { x: 0, y: 0 };
    let steps = 0;
    let idle = 0;
    let awake = 1;

    const layout = () => {
      const visible = visibleCells(canvas);
      const margin = MARGIN * scale;
      bounds.left = visible.left + margin;
      bounds.top = visible.top + margin;
      bounds.right = Math.max(bounds.left, visible.right - margin);
      bounds.bottom = Math.max(bounds.top, visible.bottom - margin);
      const area =
        (visible.right - visible.left) * (visible.bottom - visible.top);
      cell = Math.max(
        scale,
        Math.sqrt((area * NEIGHBOURS) / (Math.PI * COUNT)),
      );
      gridColumns = Math.ceil(width / cell);
      gridRows = Math.ceil(height / cell);
      if (head.length !== gridColumns * gridRows) {
        head = new Int32Array(gridColumns * gridRows);
      }
    };

    layout();
    for (let i = 0; i < COUNT; i += 1) {
      x[i] = bounds.left + Math.random() * (bounds.right - bounds.left);
      y[i] = bounds.top + Math.random() * (bounds.bottom - bounds.top);
      heading[i] = Math.random() * 2 * Math.PI;
      phase[i] = Math.random();
      rate[i] = (1 + (Math.random() * 2 - 1) * PERIOD_SPREAD) / PERIOD_STEPS;
    }

    const cellOf = (column: number, row: number) =>
      clamp(row, 0, gridRows - 1) * gridColumns +
      clamp(column, 0, gridColumns - 1);

    const bin = () => {
      head.fill(-1);
      for (let i = 0; i < COUNT; i += 1) {
        const at = cellOf(Math.floor(x[i] / cell), Math.floor(y[i] / cell));
        next[i] = head[at];
        head[at] = i;
      }
    };

    let queued = 0;
    const enqueue = (i: number) => {
      firedAt[i] = steps;
      queue[queued] = i;
      queued += 1;
    };

    const fire = (i: number) => {
      phase[i] = 0;
      flash[i] = FLASH_STEPS;
      const column = Math.floor(x[i] / cell);
      const row = Math.floor(y[i] / cell);
      for (let r = row - 1; r <= row + 1; r += 1) {
        if (r < 0 || r >= gridRows) continue;
        for (let c = column - 1; c <= column + 1; c += 1) {
          if (c < 0 || c >= gridColumns) continue;
          for (let j = head[r * gridColumns + c]; j !== -1; j = next[j]) {
            if (firedAt[j] === steps) continue;
            if ((x[j] - x[i]) ** 2 + (y[j] - y[i]) ** 2 > cell * cell) continue;
            // f⁻¹(f(φ) + PULSE) for the charge f above works out linear in φ.
            phase[j] = phase[j] * lift + (lift - 1) / charged;
            if (phase[j] >= 1) enqueue(j);
          }
        }
      }
    };

    const tap = () => {
      pressed = false;
      beacon = BEACON_STEPS;
      beaconAt.x = press.x;
      beaconAt.y = press.y;
      const radius = TAP_RADIUS * scale;
      for (let i = 0; i < COUNT; i += 1) {
        const distance = Math.hypot(x[i] - press.x, y[i] - press.y);
        if (distance >= radius) continue;
        const after = REPLY_STEPS + (REPLY_SPREAD_STEPS * distance) / radius;
        phase[i] = Math.max(phase[i], 1 - after * rate[i]);
      }
    };

    const wander = (i: number) => {
      heading[i] += (Math.random() - 0.5) * TURN;
      const cos = Math.cos(heading[i]);
      const sin = Math.sin(heading[i]);
      if ((x[i] <= bounds.left && cos < 0) || (x[i] >= bounds.right && cos > 0))
        heading[i] = Math.PI - heading[i];
      if ((y[i] <= bounds.top && sin < 0) || (y[i] >= bounds.bottom && sin > 0))
        heading[i] = -heading[i];
      const speed = SPEED * scale;
      vx[i] += (Math.cos(heading[i]) * speed - vx[i]) * STEER;
      vy[i] += (Math.sin(heading[i]) * speed - vy[i]) * STEER;
      if (hovering) {
        const dx = pointer.x - x[i];
        const dy = pointer.y - y[i];
        const distance = Math.hypot(dx, dy);
        const radius = ATTRACT_RADIUS * scale;
        if (distance > ORBIT * scale && distance < radius) {
          const pull = (ATTRACT * scale * (1 - distance / radius)) / distance;
          vx[i] += dx * pull;
          vy[i] += dy * pull;
        }
      }
      x[i] = clamp(x[i] + vx[i] * awake, bounds.left, bounds.right);
      y[i] = clamp(y[i] + vy[i] * awake, bounds.top, bounds.bottom);
    };

    const step = () => {
      steps += 1;
      idle += 1;
      awake =
        idle < IDLE_STEPS
          ? Math.min(1, awake + 1 / FADE_IN_STEPS)
          : Math.max(0, awake - 1 / FADE_OUT_STEPS);
      if (beacon > 0) beacon -= 1;
      for (let i = 0; i < COUNT; i += 1) {
        wander(i);
        if (flash[i] > 0) flash[i] -= 1;
      }
      bin();
      if (pressed) tap();
      queued = 0;
      for (let i = 0; i < COUNT; i += 1) {
        phase[i] += rate[i];
        if (phase[i] >= 1) enqueue(i);
      }
      for (let k = 0; k < queued; k += 1) fire(queue[k]);
    };

    const glow = (cx: number, cy: number, radius: number, peak: number) => {
      if (peak <= 0) return;
      const edge = radius + 0.5;
      const left = Math.max(0, Math.floor(cx - edge));
      const right = Math.min(width - 1, Math.floor(cx + edge));
      const top = Math.max(0, Math.floor(cy - edge));
      const bottom = Math.min(height - 1, Math.floor(cy + edge));
      for (let py = top; py <= bottom; py += 1) {
        for (let px = left; px <= right; px += 1) {
          const cover = 1 - Math.hypot(px + 0.5 - cx, py + 0.5 - cy) / edge;
          if (cover <= 0) continue;
          const alpha = Math.round(peak * Math.min(1, cover * 2));
          const i = (py * width + px) * 4;
          if (alpha <= pixels[i + 3]) continue;
          pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
          pixels[i + 3] = alpha;
        }
      }
    };

    const render = () => {
      pixels.fill(0);
      for (let i = 0; i < COUNT; i += 1) {
        glow(x[i], y[i], BODY_RADIUS * scale, RESTING_ALPHA * awake);
        glow(
          x[i],
          y[i],
          GLOW_RADIUS * scale,
          (255 * awake * flash[i]) / FLASH_STEPS,
        );
      }
      glow(
        beaconAt.x,
        beaconAt.y,
        BEACON_RADIUS * scale,
        (255 * beacon) / BEACON_STEPS,
      );
      context.putImageData(image, 0, 0);
    };

    const moving = () => pressed || awake > 0 || beacon > 0;

    const tick = (now: number) => {
      pace.advance(now, step);
      render();
      return moving();
    };

    const loop = frameLoop(tick);

    const wake = () => {
      idle = 0;
      if (loop.wake()) pace.restart();
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "touch") {
        const point = pointOn(canvas, event);
        pointer.x = point.x;
        pointer.y = point.y;
        hovering = true;
      }
      wake();
    };

    const onDown = (event: PointerEvent) => {
      const point = pointOn(canvas, event);
      press.x = point.x;
      press.y = point.y;
      pressed = true;
      wake();
    };

    const onLeave = () => {
      hovering = false;
      wake();
    };

    const onResize = () => {
      layout();
      wake();
    };

    const listening = new AbortController();
    const { signal } = listening;
    canvas.addEventListener("pointermove", onMove, { signal });
    canvas.addEventListener("pointerdown", onDown, { signal });
    canvas.addEventListener("pointerup", wake, { signal });
    canvas.addEventListener("pointercancel", onLeave, { signal });
    canvas.addEventListener("pointerleave", onLeave, { signal });
    window.addEventListener("resize", onResize, { signal });
    wake();

    return () => {
      listening.abort();
      loop.stop();
    };
  },
};
