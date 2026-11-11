import { clamp } from "../emulated-canvas-limits";
import type { Mode, Point } from "./mode";

const DAMPING = 0.985;
/** Below this the render rounds to nothing, so the surface counts as flat. */
const FLAT = 0.04;
const RAIN_AFTER_MS = 2500;
/** Early enough that the last drop's ripples die before the host's settle limit. */
const RAIN_UNTIL_MS = 20_000;
const RAIN_GAP_MS = 3000;
const RAIN_SPREAD_MS = 3000;
const RAIN_MARGIN = 4;
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

    return {
      step({ pointer, press, lastInputAt, visible }, now) {
        if (press !== undefined && press !== seenPress) {
          seenPress = press;
          poke(press.x, press.y, 3.2, -6);
        }
        if (
          pointer !== undefined &&
          hasSeen &&
          (pointer.x !== seen.x || pointer.y !== seen.y)
        ) {
          const held = press?.held === true;
          stroke(seen, pointer, held ? 2 : 1.25, held ? -0.7 : -0.25);
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
          poke(
            visible.left +
              RAIN_MARGIN +
              random() * (visible.right - visible.left - 2 * RAIN_MARGIN),
            visible.top +
              RAIN_MARGIN +
              random() * (visible.bottom - visible.top - 2 * RAIN_MARGIN),
            1.6,
            -3,
          );
          nextRain = now + RAIN_GAP_MS + random() * RAIN_SPREAD_MS;
        }

        let peak = 0;
        for (let y = 1; y < size - 1; y += 1) {
          for (let x = 1, i = y * size + 1; x < size - 1; x += 1, i += 1) {
            const value =
              ((height[i - 1] +
                height[i + 1] +
                height[i - size] +
                height[i + size]) *
                0.5 -
                previous[i]) *
              DAMPING;
            previous[i] = value;
            peak = Math.max(peak, Math.abs(value));
          }
        }
        const swap = height;
        height = previous;
        previous = swap;

        flat = peak < FLAT;
        if (flat) {
          height.fill(0);
          previous.fill(0);
        }
      },

      render(field) {
        if (flat) return;
        for (let y = 1; y < size - 1; y += 1) {
          for (let x = 1, i = y * size + 1; x < size - 1; x += 1, i += 1) {
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
