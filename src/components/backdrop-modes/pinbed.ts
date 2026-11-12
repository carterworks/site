import { clamp } from "../emulated-canvas-limits";
import { cellScale, sameRect, type CellRect, type Mode } from "./mode";

/**
 * The prototype tile was tuned at 48 cells across about 360 px. Radii and
 * speeds in its cells scale by the ratio of cell pitches so they cover the
 * same pixels.
 */
const PROTOTYPE_CELL_PX = 360 / 48;
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
/**
 * Cells per step. Matching the tile in pixels would take over 20 s to cross a
 * 1440 px viewport, past the 30 s the contract allows the mode to settle in.
 */
const PEBBLE_SPEED = 0.2;
const PEBBLE_SPEED_JITTER = 0.08;

const FINGERS = [
  [-6, -8],
  [-2, -10],
  [2, -10],
  [6, -8],
];
const PRINT_DEPTH = 0.35;

/**
 * A bed of pins. Pointer movement and presses push pins down; each springs
 * back at its own rate once left alone. A press held longer goes deeper.
 *
 * Until the first input, a faint handprint rests in the lower-left of the
 * visible area as a hint that the bed is live. It is frozen, so the mode stays
 * still; the first input lets it spring back like any other dent.
 *
 * The host cannot wake a still mode, so the ambient pebble is tied to input:
 * one rolls across the visible area a few seconds after the last input, then
 * the mode goes still until the pointer is next touched.
 */
export const pinbed: Mode = {
  id: "pinbed",
  label: "Pinbed",
  look: { ghost: 40, noise: 8 },
  holds: true,
  create({ columns, rows, random }) {
    const scale = cellScale(PROTOTYPE_CELL_PX, columns);
    const hoverRadius = 3.4 * scale;
    const pressRadius = 5.5 * scale;
    const pebbleRadius = 3 * scale;
    const palmRadius = 7 * scale;
    const fingerRadius = 2.2 * scale;
    // The dent's far wall is lit above this rise over its up-left neighbour.
    const litRise = 0.04 / scale;
    const depth = new Float32Array(columns * rows);
    const pushedAt = new Float32Array(columns * rows).fill(-Infinity);
    // Only pins that are down are relaxed and drawn; scanning all of them each
    // step costs 25,600 reads at 160 cells for a handful of dents.
    const down = new Int32Array(columns * rows);
    const isDown = new Uint8Array(columns * rows);
    let downCount = 0;
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
    let pristine = true;
    let printedIn: CellRect | undefined;
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
          if (isDown[i] === 0 && depth[i] > 0) {
            isDown[i] = 1;
            down[downCount++] = i;
          }
          pushedAt[i] = now;
        }
      }
    };

    const launchPebble = (visible: CellRect) => {
      const fromLeft = random() < 0.5;
      const margin = 4 * scale;
      const height = visible.bottom - visible.top;
      const speed = PEBBLE_SPEED + random() * PEBBLE_SPEED_JITTER;
      pebble = {
        x: fromLeft ? visible.left - margin : visible.right + margin,
        y: visible.top + height * (0.15 + random() * 0.7),
        vx: fromLeft ? speed : -speed,
        vy: (random() - 0.5) * 0.05 * scale,
      };
    };

    const imprintHand = (visible: CellRect) => {
      depth.fill(0);
      isDown.fill(0);
      downCount = 0;
      const x = visible.left + 1.3 * palmRadius;
      const y = visible.bottom - 1.3 * palmRadius;
      push(x, y, palmRadius, PRINT_DEPTH, 1);
      for (const [dx, dy] of FINGERS) {
        push(x + dx * scale, y + dy * scale, fingerRadius, PRINT_DEPTH, 1);
      }
      printedIn = { ...visible };
    };

    return {
      step({ pointer, press, lastInputAt, visible }, time) {
        now = time;

        if (
          lastInputAt !== -Infinity ||
          press !== undefined ||
          pointer !== undefined
        ) {
          pristine = false;
        }
        if (pristine) {
          if (printedIn === undefined || !sameRect(printedIn, visible)) {
            imprintHand(visible);
          }
          return;
        }

        if (press !== undefined && press !== seenPress) {
          seenPress = press;
          push(press.x, press.y, pressRadius, TAP_DEPTH, 1);
        }
        holding = press?.held === true;
        if (press !== undefined && holding) {
          const at = pointer ?? press;
          const strength = Math.min(
            1,
            HOLD_START + (now - press.at) / HOLD_RAMP_MS,
          );
          push(at.x, at.y, pressRadius, strength, GRAB);
        } else if (
          pointer !== undefined &&
          (pointer.x !== seenPointer?.x || pointer.y !== seenPointer?.y)
        ) {
          push(pointer.x, pointer.y, hoverRadius, HOVER_DEPTH, GRAB);
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
          push(pebble.x, pebble.y, pebbleRadius, PEBBLE_DEPTH, 0.5);
          const margin = 6 * scale;
          if (
            pebble.x < visible.left - margin ||
            pebble.x > visible.right + margin
          ) {
            pebble = undefined;
          }
        }

        let kept = 0;
        for (let k = 0; k < downCount; k += 1) {
          const i = down[k];
          if (now - pushedAt[i] > HOLD_MS) {
            depth[i] = Math.max(0, depth[i] - spring[i]);
          }
          if (depth[i] > 0) down[kept++] = i;
          else isDown[i] = 0;
        }
        downCount = kept;
        dented = downCount > 0;
      },

      render(field) {
        for (let k = 0; k < downCount; k += 1) {
          const i = down[k];
          const rise =
            i % columns > 0 && i >= columns
              ? depth[i] - depth[i - columns - 1]
              : 0;
          const level = depth[i] * 0.7 + (rise > litRise ? 0.3 : 0);
          field[i] = Math.round(clamp(level, 0, 1) * 5) / 5;
        }
      },

      pace() {
        if (pristine) return "still";
        if (holding || dented || pebble !== undefined) return "active";
        return pebbleAt === undefined ? "still" : "idle";
      },
    };
  },
};
