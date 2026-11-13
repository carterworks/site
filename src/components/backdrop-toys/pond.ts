import { clamp } from "../../lib/clamp";
import {
  fixedStep,
  frameLoop,
  pointOn,
  visibleCells,
  type Point,
  type Toy,
} from "./toy";

/** The gallery tile this was tuned on; every length and speed scales from it. */
const REFERENCE_CELLS = 64;
const DAMPING_PER_FRAME = 0.985;
/** Below this the paint rounds to nothing, so the surface counts as flat. */
const FLAT = 0.04;
const RAIN_AFTER_MS = 2500;
/** Early enough that the last drop's ripples die before an owner's settle limit. */
const RAIN_UNTIL_MS = 20_000;
const RAIN_GAP_MS = 3000;
const RAIN_SPREAD_MS = 3000;
const RAIN_MARGIN = 4;
const STONE = { radius: 2.6, amount: -6 };
const RAIN = { radius: 1.3, amount: -1.5 };
const HOVER = { radius: 1, amount: -0.25, spacing: 1 };
const DRAG = { radius: 1.6, amount: -0.45, spacing: 1.5 };
/** A press is a tap, which drops a stone, only if it lifts soon and barely moves. */
const TAP_MS = 300;
const TAP_SLOP = 1.5;
const SHADES = 6;
/** The wave steps per 60 Hz frame, so a faster display does not speed it up. */
const FRAME_MS = 1000 / 60;
/** A frame after a long pause, like a hidden tab, advances this much, not the whole gap. */
const MAX_ADVANCE_MS = 100;

/**
 * A ripple tank: a wave height field that spreads, bounces off the walls and
 * crosses itself. A tap drops a stone, a held drag pulls a wake, a hovering
 * pointer skims the surface, and rain falls once nobody has touched it.
 * Rain lasts a while after the last touch, then the pond is left to go still.
 *
 * It draws white on transparent, the wave's slope and height as alpha, into
 * its own image data put whole each frame. The loop sleeps once the surface
 * is flat, waking by timer for the next raindrop while the rain lasts.
 */
export const pond: Toy = {
  id: "pond",
  label: "Still Pond",
  look: { ghost: 50, noise: 10 },
  start(canvas) {
    const context = canvas.getContext("2d");
    if (context === null) return () => {};
    const { width, height: rows } = canvas;
    // A bigger grid has more cells across the same screen: sizes grow with it,
    // and the wave takes extra sub-steps per frame so it crosses the screen in
    // the same time.
    const scale = width / REFERENCE_CELLS;
    const damping = DAMPING_PER_FRAME ** (1 / scale);
    const image = context.createImageData(width, rows);
    const pixels = image.data;
    const pace = fixedStep(FRAME_MS / scale, MAX_ADVANCE_MS);
    let peak = 0;
    let steps = 0;
    // Everything outside this box is exactly zero in both buffers, so the wave
    // and the paint skip it. It only grows (by a cell per wave step) until the
    // surface goes flat, which keeps results identical to sweeping the grid.
    let minX = width;
    let maxX = -1;
    let minY = rows;
    let maxY = -1;
    let heights = new Float32Array(width * rows);
    let previous = new Float32Array(width * rows);
    let tap: (Point & { at: number }) | undefined;
    const seen: Point = { x: 0, y: 0 };
    let hasSeen = false;
    let held = false;
    let nextRain = 0;
    // A pond nobody has touched yet rains from its start.
    const arrivedAt = performance.now();
    let lastInputAt = arrivedAt;
    let flat = true;
    let lit = true;
    let visible = visibleCells(canvas);
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poke = (x: number, y: number, radius: number, amount: number) => {
      const reach = Math.ceil(radius);
      minX = Math.max(1, Math.min(minX, Math.round(x) - reach));
      maxX = Math.min(width - 2, Math.max(maxX, Math.round(x) + reach));
      minY = Math.max(1, Math.min(minY, Math.round(y) - reach));
      maxY = Math.min(rows - 2, Math.max(maxY, Math.round(y) + reach));
      flat = false;
      for (let dy = -reach; dy <= reach; dy += 1) {
        for (let dx = -reach; dx <= reach; dx += 1) {
          const cx = Math.round(x) + dx;
          const cy = Math.round(y) + dy;
          const distance = Math.hypot(dx, dy);
          if (cx < 1 || cy < 1 || cx >= width - 1 || cy >= rows - 1) continue;
          if (distance > radius) continue;
          heights[cy * width + cx] +=
            amount * (Math.cos((distance / radius) * Math.PI) * 0.5 + 0.5);
        }
      }
    };

    /** Distance walked since the last poke, so the spacing survives tiny steps. */
    let carry = 0;

    /** Pokes at a fixed arc length, so the energy follows the path, not the event rate. */
    const stroke = (
      from: Point,
      to: Point,
      radius: number,
      amount: number,
      spacing: number,
    ) => {
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      let at = spacing - carry;
      for (; at <= length; at += spacing) {
        poke(
          from.x + ((to.x - from.x) * at) / length,
          from.y + ((to.y - from.y) * at) / length,
          radius,
          amount,
        );
      }
      carry = spacing - (at - length);
    };

    const wave = () => {
      minX = Math.max(1, minX - 1);
      maxX = Math.min(width - 2, maxX + 1);
      minY = Math.max(1, minY - 1);
      maxY = Math.min(rows - 2, maxY + 1);
      let peak = 0;
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX, i = y * width + minX; x <= maxX; x += 1, i += 1) {
          const value =
            ((heights[i - 1] +
              heights[i + 1] +
              heights[i - width] +
              heights[i + width]) *
              0.5 -
              previous[i]) *
            damping;
          previous[i] = value;
          peak = Math.max(peak, Math.abs(value));
        }
      }
      const swap = heights;
      heights = previous;
      previous = swap;
      return peak;
    };

    const paint = () => {
      const left = Math.max(1, minX - 1);
      const right = Math.min(width - 2, maxX + 1);
      for (
        let y = Math.max(1, minY - 1);
        y <= Math.min(rows - 2, maxY + 1);
        y += 1
      ) {
        for (let x = left, i = y * width + left; x <= right; x += 1, i += 1) {
          const slope = heights[i - 1 - width] - heights[i + 1 + width];
          const level = clamp(slope * 0.9 + Math.abs(heights[i]) * 0.25, 0, 1);
          const shade = Math.round(level * SHADES);
          const p = i * 4;
          pixels[p] = pixels[p + 1] = pixels[p + 2] = shade > 0 ? 255 : 0;
          pixels[p + 3] = (shade * 255) / SHADES;
        }
      }
      context.putImageData(image, 0, 0);
      lit = true;
    };

    const rainFrom = () => Math.max(lastInputAt, arrivedAt) + RAIN_AFTER_MS;
    const rainUntil = () => Math.max(lastInputAt, arrivedAt) + RAIN_UNTIL_MS;

    const stepWave = () => {
      peak = wave();
      steps += 1;
    };

    const draw = (now: number) => {
      if (now > rainFrom() && now < rainUntil() && now > nextRain) {
        const margin = RAIN_MARGIN * scale;
        poke(
          visible.left +
            margin +
            Math.random() * (visible.right - visible.left - 2 * margin),
          visible.top +
            margin +
            Math.random() * (visible.bottom - visible.top - 2 * margin),
          RAIN.radius * scale,
          RAIN.amount,
        );
        nextRain = now + RAIN_GAP_MS + Math.random() * RAIN_SPREAD_MS;
      }

      const dirty = maxX >= 0;
      steps = 0;
      pace.advance(now, stepWave);
      if (steps > 0) flat = peak < FLAT;

      if (!flat) {
        if (steps > 0) paint();
        return true;
      }
      if (dirty) {
        heights.fill(0);
        previous.fill(0);
      }
      minX = width;
      minY = rows;
      maxX = maxY = -1;
      if (lit) {
        pixels.fill(0);
        context.putImageData(image, 0, 0);
        lit = false;
      }
      pace.restart();
      sleep(now);
      return false;
    };

    const loop = frameLoop(draw);

    /** Rests until the next raindrop is due, or for good once the rain is over. */
    const sleep = (now: number) => {
      const due = Math.max(rainFrom(), nextRain, now);
      if (due >= rainUntil()) return;
      timer = setTimeout(wake, Math.max(1, due - now));
    };

    const wake = () => {
      clearTimeout(timer);
      timer = undefined;
      loop.wake();
    };

    const touched = () => {
      lastInputAt = performance.now();
      wake();
    };

    const onDown = (event: PointerEvent) => {
      const point = pointOn(canvas, event);
      held = true;
      tap = { ...point, at: performance.now() };
      carry = 0;
      seen.x = point.x;
      seen.y = point.y;
      hasSeen = true;
      touched();
    };

    const onMove = (event: PointerEvent) => {
      const point = pointOn(canvas, event);
      if (hasSeen && (point.x !== seen.x || point.y !== seen.y)) {
        const { radius, amount, spacing } = held ? DRAG : HOVER;
        stroke(seen, point, radius * scale, amount, spacing * scale);
      }
      seen.x = point.x;
      seen.y = point.y;
      hasSeen = true;
      if (
        tap !== undefined &&
        Math.hypot(point.x - tap.x, point.y - tap.y) > TAP_SLOP * scale
      ) {
        tap = undefined;
      }
      touched();
    };

    const onLift = (event: PointerEvent) => {
      held = false;
      if (event.pointerType === "touch") hasSeen = false;
      if (tap !== undefined && performance.now() - tap.at <= TAP_MS) {
        poke(tap.x, tap.y, STONE.radius * scale, STONE.amount);
      }
      tap = undefined;
      touched();
    };

    const onLeave = () => {
      hasSeen = held;
    };

    const onResize = () => {
      visible = visibleCells(canvas);
    };

    const listening = new AbortController();
    const { signal } = listening;
    canvas.addEventListener("pointerdown", onDown, { signal });
    canvas.addEventListener("pointermove", onMove, { signal });
    canvas.addEventListener("pointerup", onLift, { signal });
    canvas.addEventListener("pointercancel", onLift, { signal });
    canvas.addEventListener("pointerleave", onLeave, { signal });
    window.addEventListener("resize", onResize, { signal });
    wake();

    return () => {
      listening.abort();
      loop.stop();
      clearTimeout(timer);
    };
  },
};
