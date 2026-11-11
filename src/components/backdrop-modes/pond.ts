import { clamp } from "../emulated-canvas-limits";
import type { Mode, Point } from "./mode";

/** The gallery tile this was tuned on; every length and speed scales from it. */
const REFERENCE_CELLS = 64;
const DAMPING_PER_FRAME = 0.985;
/** Below this the render rounds to nothing, so the surface counts as flat. */
const FLAT = 0.04;
const RAIN_AFTER_MS = 2500;
/** Early enough that the last drop's ripples die before the host's settle limit. */
const RAIN_UNTIL_MS = 20_000;
const RAIN_GAP_MS = 3000;
const RAIN_SPREAD_MS = 3000;
const RAIN_MARGIN = 4;
const STONE = { radius: 2.6, amount: -6 };
const RAIN = { radius: 1.3, amount: -1.5 };
const HOVER = { radius: 1, amount: -0.25 };
const DRAG = { radius: 1.6, amount: -0.7 };
const SHADES = 6;

/**
 * A ripple tank: a wave height field that spreads, bounces off the walls and
 * crosses itself. A press drops a stone, a held drag pulls a wake, a hovering
 * pointer skims the surface, and rain falls once nobody has touched it.
 * Rain lasts a while after the last touch, then the pond is left to go still.
 * Between drops the loop idles rather than stops, so the next drop can fall.
 */
export const pond: Mode = {
  id: "pond",
  label: "Still Pond",
  look: { ghost: 50, noise: 10 },
  holds: true,
  create({ columns: size, random }) {
    // A bigger grid has more cells across the same screen: sizes grow with it,
    // and the wave takes extra sub-steps per frame so it crosses the screen in
    // the same time.
    const scale = size / REFERENCE_CELLS;
    const damping = DAMPING_PER_FRAME ** (1 / scale);
    let owedSteps = 0;
    // Everything outside this box is exactly zero in both buffers, so the wave
    // and the render skip it. It only grows (by a cell per wave step) until the
    // surface goes flat, which keeps results identical to sweeping the grid.
    let minX = size;
    let maxX = -1;
    let minY = size;
    let maxY = -1;
    let height = new Float32Array(size * size);
    let previous = new Float32Array(size * size);
    let seenPress: object | undefined;
    const seen: Point = { x: 0, y: 0 };
    let hasSeen = false;
    let nextRain = 0;
    let flat = true;
    let raining = false;
    let arrivedAt: number | undefined;

    const poke = (x: number, y: number, radius: number, amount: number) => {
      const reach = Math.ceil(radius);
      minX = Math.max(1, Math.min(minX, Math.round(x) - reach));
      maxX = Math.min(size - 2, Math.max(maxX, Math.round(x) + reach));
      minY = Math.max(1, Math.min(minY, Math.round(y) - reach));
      maxY = Math.min(size - 2, Math.max(maxY, Math.round(y) + reach));
      for (let dy = -reach; dy <= reach; dy += 1) {
        for (let dx = -reach; dx <= reach; dx += 1) {
          const cx = Math.round(x) + dx;
          const cy = Math.round(y) + dy;
          const distance = Math.hypot(dx, dy);
          if (cx < 1 || cy < 1 || cx >= size - 1 || cy >= size - 1) continue;
          if (distance > radius) continue;
          height[cy * size + cx] +=
            amount * (Math.cos((distance / radius) * Math.PI) * 0.5 + 0.5);
        }
      }
    };

    /** Pokes about once per cell along the way, not counting where it starts. */
    const stroke = (from: Point, to: Point, radius: number, amount: number) => {
      const steps = Math.max(
        1,
        Math.ceil(Math.hypot(to.x - from.x, to.y - from.y)),
      );
      for (let s = 1; s <= steps; s += 1) {
        poke(
          from.x + ((to.x - from.x) * s) / steps,
          from.y + ((to.y - from.y) * s) / steps,
          radius,
          amount,
        );
      }
    };

    const wave = () => {
      minX = Math.max(1, minX - 1);
      maxX = Math.min(size - 2, maxX + 1);
      minY = Math.max(1, minY - 1);
      maxY = Math.min(size - 2, maxY + 1);
      let peak = 0;
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX, i = y * size + minX; x <= maxX; x += 1, i += 1) {
          const value =
            ((height[i - 1] +
              height[i + 1] +
              height[i - size] +
              height[i + size]) *
              0.5 -
              previous[i]) *
            damping;
          previous[i] = value;
          peak = Math.max(peak, Math.abs(value));
        }
      }
      const swap = height;
      height = previous;
      previous = swap;
      return peak;
    };

    return {
      step({ pointer, press, lastInputAt, visible }, now) {
        if (press !== undefined && press !== seenPress) {
          seenPress = press;
          poke(press.x, press.y, STONE.radius * scale, STONE.amount);
        }
        if (
          pointer !== undefined &&
          hasSeen &&
          (pointer.x !== seen.x || pointer.y !== seen.y)
        ) {
          const held = press?.held === true;
          const { radius, amount } = held ? DRAG : HOVER;
          stroke(seen, pointer, radius * scale, amount);
        }
        hasSeen = pointer !== undefined;
        if (pointer !== undefined) {
          seen.x = pointer.x;
          seen.y = pointer.y;
        }

        // A pond nobody has touched yet rains from its first step.
        arrivedAt ??= now;
        const quiet = now - Math.max(lastInputAt, arrivedAt);
        raining = quiet > RAIN_AFTER_MS && quiet < RAIN_UNTIL_MS;
        if (raining && now > nextRain) {
          const margin = RAIN_MARGIN * scale;
          poke(
            visible.left +
              margin +
              random() * (visible.right - visible.left - 2 * margin),
            visible.top +
              margin +
              random() * (visible.bottom - visible.top - 2 * margin),
            RAIN.radius * scale,
            RAIN.amount,
          );
          nextRain = now + RAIN_GAP_MS + random() * RAIN_SPREAD_MS;
        }

        owedSteps += scale;
        const steps = Math.floor(owedSteps);
        owedSteps -= steps;
        let peak = 0;
        for (let n = 0; n < steps; n += 1) peak = wave();

        flat = peak < FLAT;
        if (flat) {
          height.fill(0);
          previous.fill(0);
          minX = minY = size;
          maxX = maxY = -1;
        }
      },

      render(field) {
        if (flat) return;
        const left = Math.max(1, minX - 1);
        const right = Math.min(size - 2, maxX + 1);
        for (
          let y = Math.max(1, minY - 1);
          y <= Math.min(size - 2, maxY + 1);
          y += 1
        ) {
          for (let x = left, i = y * size + left; x <= right; x += 1, i += 1) {
            const slope = height[i - 1 - size] - height[i + 1 + size];
            const level = clamp(slope * 0.9 + Math.abs(height[i]) * 0.25, 0, 1);
            field[i] = Math.round(level * SHADES) / SHADES;
          }
        }
      },

      pace: () => (!flat ? "active" : raining ? "idle" : "still"),
    };
  },
};
