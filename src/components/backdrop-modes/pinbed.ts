import { clamp } from "../emulated-canvas-limits";
import type { Mode } from "./mode";

/** The prototype was tuned on a 48-cell grid; radii and speeds scale to 80. */
const SCALE = 80 / 48;
const HOVER_RADIUS = 3.4 * SCALE;
const PRESS_RADIUS = 5.5 * SCALE;
const PEBBLE_RADIUS = 3 * SCALE;
const HOVER_DEPTH = 0.34;
const PEBBLE_DEPTH = 0.6;
const TAP_DEPTH = 0.6;
const HOLD_START = 0.45;
const HOLD_RAMP_MS = 900;
const GRAB = 0.3;
/** A pin stays down this long after it was last pushed, then springs back. */
const HOLD_MS = 700;
const PEBBLE_DELAY_MS = 4000;
const PEBBLE_JITTER_MS = 4000;
/** The dent's far wall is lit above this rise over its up-left neighbour. */
const LIT_RISE = 0.04 / SCALE;

/**
 * A bed of pins. Pointer movement and presses push pins down; each springs
 * back at its own rate once left alone. A press held longer goes deeper.
 *
 * The host cannot wake a still mode, so the ambient pebble is tied to input:
 * one rolls across the visible area a few seconds after the last input, then
 * the mode goes still until the pointer is next touched.
 */
export const pinbed: Mode = {
  id: "pinbed",
  label: "Pinbed",
  holds: true,
  create({ columns, rows, random }) {
    const depth = new Float32Array(columns * rows);
    const pushedAt = new Float32Array(columns * rows).fill(-Infinity);
    const spring = Float32Array.from(
      { length: columns * rows },
      () => 0.003 + random() * 0.011,
    );
    let pebble: { x: number; y: number; vx: number; vy: number } | undefined;
    let pebbleAt: number | undefined;
    let seenInputAt = -Infinity;
    let seenPress: object | undefined;
    let seenPointer: { x: number; y: number } | undefined;
    let holding = false;
    let dented = false;
    let now = 0;

    const push = (
      x: number,
      y: number,
      radius: number,
      strength: number,
      ease: number,
    ) => {
      const reach = Math.ceil(radius);
      const cx = Math.round(x);
      const cy = Math.round(y);
      for (let yy = Math.max(0, cy - reach); yy <= cy + reach; yy += 1) {
        if (yy >= rows) break;
        for (let xx = Math.max(0, cx - reach); xx <= cx + reach; xx += 1) {
          if (xx >= columns) break;
          const r = Math.hypot(xx + 0.5 - x, yy + 0.5 - y) / radius;
          if (r >= 1) continue;
          const i = yy * columns + xx;
          const target = strength * Math.sqrt(1 - r * r);
          if (depth[i] < target) depth[i] += (target - depth[i]) * ease;
          pushedAt[i] = now;
        }
      }
    };

    const launchPebble = (visible: {
      left: number;
      top: number;
      right: number;
      bottom: number;
    }) => {
      const fromLeft = random() < 0.5;
      const margin = 4 * SCALE;
      const height = visible.bottom - visible.top;
      const speed = (0.12 + random() * 0.06) * SCALE;
      pebble = {
        x: fromLeft ? visible.left - margin : visible.right + margin,
        y: visible.top + height * (0.15 + random() * 0.7),
        vx: fromLeft ? speed : -speed,
        vy: (random() - 0.5) * 0.05 * SCALE,
      };
    };

    return {
      step({ pointer, press, lastInputAt, visible }, time) {
        now = time;

        if (press !== undefined && press !== seenPress) {
          seenPress = press;
          push(press.x, press.y, PRESS_RADIUS, TAP_DEPTH, 1);
        }
        holding = press?.held === true;
        if (press !== undefined && holding) {
          const at = pointer ?? press;
          const strength = Math.min(
            1,
            HOLD_START + (now - press.at) / HOLD_RAMP_MS,
          );
          push(at.x, at.y, PRESS_RADIUS, strength, GRAB);
        } else if (
          pointer !== undefined &&
          (pointer.x !== seenPointer?.x || pointer.y !== seenPointer?.y)
        ) {
          push(pointer.x, pointer.y, HOVER_RADIUS, HOVER_DEPTH, GRAB);
        }
        seenPointer = pointer;

        if (lastInputAt !== seenInputAt) {
          seenInputAt = lastInputAt;
          pebble = undefined;
          pebbleAt =
            lastInputAt === -Infinity
              ? undefined
              : lastInputAt + PEBBLE_DELAY_MS + random() * PEBBLE_JITTER_MS;
        }
        if (pebbleAt !== undefined && now >= pebbleAt) {
          pebbleAt = undefined;
          launchPebble(visible);
        }
        if (pebble !== undefined) {
          pebble.x += pebble.vx;
          pebble.y += pebble.vy;
          push(pebble.x, pebble.y, PEBBLE_RADIUS, PEBBLE_DEPTH, 0.5);
          const margin = 6 * SCALE;
          if (
            pebble.x < visible.left - margin ||
            pebble.x > visible.right + margin
          ) {
            pebble = undefined;
          }
        }

        dented = false;
        for (let i = 0; i < depth.length; i += 1) {
          if (depth[i] <= 0) continue;
          if (now - pushedAt[i] > HOLD_MS) {
            depth[i] = Math.max(0, depth[i] - spring[i]);
          }
          if (depth[i] > 0) dented = true;
        }
      },

      render(field) {
        for (let y = 0, i = 0; y < rows; y += 1) {
          for (let x = 0; x < columns; x += 1, i += 1) {
            if (depth[i] <= 0) continue;
            const rise = x > 0 && y > 0 ? depth[i] - depth[i - columns - 1] : 0;
            const level = depth[i] * 0.7 + (rise > LIT_RISE ? 0.3 : 0);
            field[i] = Math.round(clamp(level, 0, 1) * 5) / 5;
          }
        }
      },

      pace() {
        if (holding || dented || pebble !== undefined) return "active";
        return pebbleAt === undefined ? "still" : "idle";
      },
    };
  },
};
