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

const COUNT = 15;
/**
 * Pendulum `i` completes `FIRST_SWINGS + i` swings per cycle, so after one
 * cycle they are all back in step, with travelling waves and braids between.
 */
const FIRST_SWINGS = 12;
const CYCLE_S = 14;
const DECAY_S = 4;
/** Below this the bob is within a pixel of plumb, so it is set to rest. */
const REST_RAD = 0.003;
const TAP_RAD = 0.35;
const MAX_DRAG_RAD = 0.6;
const STEP_MS = 1000 / 60;
const MAX_CATCH_UP_MS = 100;

const STRING = 120;
const BAR = 200;
const BOB = 255;

/**
 * A pendulum wave: a row of bobs hung from a bar, each string a little
 * shorter than the last so that their swings drift apart and back together.
 * Pressing empty space pulls every bob to that side, and letting go releases
 * them all. Pressing a bob holds that one at the pointer, and letting go swings
 * it from there. Every swing dies away within about 20 s, then the loop stops.
 *
 * It draws white on transparent into its own image data put whole each frame.
 * A pendulum's angle is `amplitude * e^(-t/τ) * cos(ωt)` of the time since it
 * was released, so nothing is integrated and a long frame cannot drift it.
 */
export const pendulums: Toy = {
  id: "pendulums",
  label: "Pendulums",
  look: { ghost: 35, noise: 6 },
  start(canvas) {
    const context = canvas.getContext("2d");
    if (context === null) return () => {};
    const { width, height } = canvas;
    const scale = width / TUNED_GRID;
    const bobRadius = 1.8 * scale;
    const grabRadius = 3 * bobRadius;
    const image = context.createImageData(width, height);
    const pixels = image.data;

    const omega = Float32Array.from(
      { length: COUNT },
      (_, i) => (2 * Math.PI * (FIRST_SWINGS + i)) / CYCLE_S,
    );
    const pivotX = new Float32Array(COUNT);
    const length = new Float32Array(COUNT);
    const amplitude = new Float32Array(COUNT);
    const releasedAt = new Float32Array(COUNT);
    const angle = new Float32Array(COUNT);
    const held = new Uint8Array(COUNT);
    const bobX = new Float32Array(COUNT);
    const bobY = new Float32Array(COUNT);
    const from: Point = { x: 0, y: 0 };
    const to: Point = { x: 0, y: 0 };
    let barY = 0;
    let barLeft = 0;
    let barRight = 0;
    let level = 0;
    let time = 0;
    let dragged = -1;
    let pointerId = -1;
    let tapped = false;
    let frame: number | undefined;

    const layout = () => {
      const visible = visibleCells(canvas);
      const w = visible.right - visible.left;
      const h = visible.bottom - visible.top;
      const margin = 0.08 * w;
      barLeft = Math.round(visible.left + margin / 2);
      barRight = Math.round(visible.right - margin / 2);
      barY = Math.round(visible.top + 0.06 * h);
      // Real pendulums' length goes as 1/ω², which is what makes the wave read.
      const longest = 0.72 * h;
      for (let i = 0; i < COUNT; i += 1) {
        pivotX[i] =
          visible.left + margin + (i * (w - 2 * margin)) / (COUNT - 1);
        length[i] = (longest * (omega[0] / omega[i]) ** 2) | 0;
      }
    };

    const release = (i: number, radians: number) => {
      held[i] = 0;
      amplitude[i] = radians;
      releasedAt[i] = time;
    };

    const plot = (x: number, y: number, opacity: number) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const o = (y * width + x) * 4;
      pixels[o] = pixels[o + 1] = pixels[o + 2] = 255;
      pixels[o + 3] = opacity;
    };

    const plotLevel = (x: number, y: number) => plot(x, y, level);

    const disc = (cx: number, cy: number) => {
      const reach = Math.ceil(bobRadius);
      for (let y = Math.round(cy) - reach; y <= Math.round(cy) + reach; y += 1)
        for (
          let x = Math.round(cx) - reach;
          x <= Math.round(cx) + reach;
          x += 1
        )
          if (Math.hypot(x - cx, y - cy) <= bobRadius) plot(x, y, BOB);
    };

    const settle = () => {
      let moving = false;
      for (let i = 0; i < COUNT; i += 1) {
        if (held[i] === 1) {
          moving = true;
          continue;
        }
        const age = time - releasedAt[i];
        const swing = amplitude[i] * Math.exp(-age / DECAY_S);
        if (Math.abs(swing) < REST_RAD) {
          angle[i] = 0;
          continue;
        }
        angle[i] = swing * Math.cos(omega[i] * age);
        moving = true;
      }
      return moving;
    };

    const draw = () => {
      pixels.fill(0);
      from.y = to.y = barY;
      from.x = barLeft;
      to.x = barRight;
      level = BAR;
      line(from, to, plotLevel);
      level = STRING;
      for (let i = 0; i < COUNT; i += 1) {
        bobX[i] = pivotX[i] + length[i] * Math.sin(angle[i]);
        bobY[i] = barY + length[i] * Math.cos(angle[i]);
        from.x = Math.round(pivotX[i]);
        from.y = barY;
        to.x = Math.round(bobX[i]);
        to.y = Math.round(bobY[i]);
        line(from, to, plotLevel);
      }
      for (let i = 0; i < COUNT; i += 1) disc(bobX[i], bobY[i]);
      context.putImageData(image, 0, 0);
    };

    const pace = fixedStep(STEP_MS, MAX_CATCH_UP_MS);
    let moving = true;

    const step = () => {
      time += STEP_MS / 1000;
      moving = settle();
    };

    const tick = (now: number) => {
      frame = undefined;
      pace.advance(now, step);
      draw();
      if (moving) wake();
      else pace.restart();
    };

    const wake = () => {
      frame ??= requestAnimationFrame(tick);
    };

    const hold = (i: number, radians: number) => {
      held[i] = 1;
      angle[i] = radians;
    };

    const aim = (i: number, point: Point) => {
      const dy = Math.max(1, point.y - barY);
      hold(
        i,
        clamp(Math.atan2(point.x - pivotX[i], dy), -MAX_DRAG_RAD, MAX_DRAG_RAD),
      );
    };

    const onDown = (event: PointerEvent) => {
      if (pointerId !== -1) return;
      pointerId = event.pointerId;
      const point = pointOn(canvas, event);
      let nearest = grabRadius;
      dragged = -1;
      for (let i = 0; i < COUNT; i += 1) {
        const distance = Math.hypot(point.x - bobX[i], point.y - bobY[i]);
        if (distance < nearest) {
          nearest = distance;
          dragged = i;
        }
      }
      if (dragged >= 0) aim(dragged, point);
      else {
        tapped = true;
        const side = point.x < width / 2 ? -TAP_RAD : TAP_RAD;
        for (let i = 0; i < COUNT; i += 1) hold(i, side);
      }
      wake();
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId || dragged < 0) return;
      aim(dragged, pointOn(canvas, event));
      wake();
    };

    const onLift = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      pointerId = -1;
      if (tapped) {
        tapped = false;
        for (let i = 0; i < COUNT; i += 1) release(i, angle[i]);
      } else if (dragged >= 0) release(dragged, angle[dragged]);
      dragged = -1;
      moving = true;
      wake();
    };

    const onResize = () => {
      layout();
      wake();
    };

    layout();
    for (let i = 0; i < COUNT; i += 1) release(i, TAP_RAD);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onLift);
    canvas.addEventListener("pointercancel", onLift);
    canvas.addEventListener("pointerleave", onLift);
    window.addEventListener("resize", onResize);
    wake();

    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onLift);
      canvas.removeEventListener("pointercancel", onLift);
      canvas.removeEventListener("pointerleave", onLift);
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(frame ?? 0);
    };
  },
};
