import { line } from "./line";
import type { Mode, Point } from "./mode";

const SHADES = [0, 0.55, 0.78, 1];
const POUR_GRAINS = 4;
const POUR_SPREAD = 4;
const DOUBLE_TAP_MS = 380;
const DOUBLE_TAP_CELLS = 10;

/** Quiet time before the stream starts, and how long after input it may run. */
const TRICKLE_AFTER_MS = 3000;
const TRICKLE_UNTIL_MS = 10_000;
const TRICKLE_EVERY_STEPS = 3;

/**
 * Grains the sieve lets through per step: a steady trickle plus a share of the
 * heap, so a full tray empties in about 20 s yet a small pile lingers.
 */
const DRAIN_BASE = 0.5;
const DRAIN_PER_GRAIN = 1 / 450;
const TIPPED_DRAIN = 12;

/**
 * Falling sand in a tray the size of the visible screen. Grains pile on its
 * bottom edge and slip down dunes; the sieve floor always drains, so an
 * untouched tab empties and the loop can stop. A double-tap tips the tray out:
 * gravity reverses and the new floor is wide open until the sand is gone.
 */
export const silt: Mode = {
  id: "silt",
  label: "Silt",
  holds: true,
  create({ columns, rows, random }) {
    const grains = new Uint8Array(columns * rows);
    let count = 0;
    let gravity = 1;
    let tipped = false;
    let owed = 0;
    let sweep = 0;
    let seenPress: object | undefined;
    let lastTap = { at: -Infinity, x: 0, y: 0 };
    let pourAt: Point | undefined;
    let pouring = false;
    let quietSince = Infinity;
    let left = 0;
    let right = columns - 1;
    let top = 0;
    let bottom = rows - 1;

    const put = (x: number, y: number) => {
      const cx = Math.floor(x);
      const cy = Math.floor(y);
      if (cx < left || cx > right || cy < top || cy > bottom) return;
      const i = cy * columns + cx;
      if (grains[i] === 0) {
        grains[i] = 1 + Math.floor(random() * 3);
        count += 1;
      }
    };

    const pour = (x: number, y: number) => {
      for (let k = 0; k < POUR_GRAINS; k += 1) {
        put(
          x + (random() - 0.5) * POUR_SPREAD,
          y + (random() - 0.5) * POUR_SPREAD,
        );
      }
    };

    const slide = (from: number, to: number) => {
      grains[to] = grains[from];
      grains[from] = 0;
    };

    const fall = (x: number, row: number, next: number) => {
      if (grains[next + x] === 0) {
        slide(row + x, next + x);
        return true;
      }
      const side = random() < 0.5 ? -1 : 1;
      for (const nx of [x + side, x - side]) {
        if (
          nx >= left &&
          nx <= right &&
          grains[next + nx] === 0 &&
          grains[row + nx] === 0
        ) {
          slide(row + x, next + nx);
          return true;
        }
      }
      return false;
    };

    const sieve = (floor: number, allowed: number) => {
      const start = Math.floor(random() * (right - left + 1));
      const width = right - left + 1;
      for (let k = 0; k < width && allowed > 0; k += 1) {
        const i = floor + left + ((start + k) % width);
        if (grains[i] !== 0) {
          grains[i] = 0;
          count -= 1;
          allowed -= 1;
        }
      }
    };

    // Grains outside the visible rect never move or drain, so they would hold
    // the loop in "active" forever; they are off-screen anyway.
    const dropOutside = () => {
      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < columns; x += 1) {
          const i = y * columns + x;
          if (
            grains[i] !== 0 &&
            (x < left || x > right || y < top || y > bottom)
          ) {
            grains[i] = 0;
            count -= 1;
          }
        }
      }
    };

    const tap = (press: { at: number; x: number; y: number }) => {
      if (
        press.at - lastTap.at < DOUBLE_TAP_MS &&
        Math.hypot(press.x - lastTap.x, press.y - lastTap.y) < DOUBLE_TAP_CELLS
      ) {
        gravity = -gravity;
        tipped = gravity < 0;
        lastTap = { at: -Infinity, x: 0, y: 0 };
      } else {
        lastTap = { at: press.at, x: press.x, y: press.y };
      }
    };
    return {
      step({ press, pointer, lastInputAt, visible }, now) {
        const bounds = [
          Math.max(0, Math.ceil(visible.left)),
          Math.min(columns - 1, Math.floor(visible.right) - 1),
          Math.max(0, Math.ceil(visible.top)),
          Math.min(rows - 1, Math.floor(visible.bottom) - 1),
        ];
        const moved = [left, right, top, bottom].some(
          (v, k) => v !== bounds[k],
        );
        [left, right, top, bottom] = bounds;
        if (right <= left || bottom <= top) return;
        if (moved) dropOutside();

        if (press !== undefined && press !== seenPress) {
          seenPress = press;
          pourAt = undefined;
          tap(press);
        }
        pouring = press?.held === true;
        if (pouring && press !== undefined) {
          const here = pointer ?? press;
          line(
            {
              x: Math.floor(pourAt?.x ?? press.x),
              y: Math.floor(pourAt?.y ?? press.y),
            },
            { x: Math.floor(here.x), y: Math.floor(here.y) },
            (x, y) => put(x, y),
          );
          pourAt = { x: here.x, y: here.y };
          pour(here.x, here.y);
        } else {
          pourAt = undefined;
        }

        quietSince = now - lastInputAt;
        sweep += 1;
        if (
          !tipped &&
          quietSince > TRICKLE_AFTER_MS &&
          quietSince < TRICKLE_UNTIL_MS &&
          sweep % TRICKLE_EVERY_STEPS === 0
        ) {
          const wander = Math.sin(now / 5200) * (right - left) * 0.34;
          put(
            (left + right) / 2 + wander + (random() - 0.5) * 1.5,
            gravity > 0 ? top : bottom,
          );
        }

        const floorRow = gravity > 0 ? bottom : top;
        const farRow = gravity > 0 ? top : bottom;
        for (let y = floorRow - gravity; y !== farRow - gravity; y -= gravity) {
          const row = y * columns;
          const next = (y + gravity) * columns;
          const forward = (y + sweep) & 1;
          for (let k = 0; k < right - left + 1; k += 1) {
            const x = forward ? left + k : right - k;
            if (grains[row + x] !== 0) fall(x, row, next);
          }
        }

        if (tipped) {
          sieve(floorRow * columns, TIPPED_DRAIN);
          if (count === 0) {
            gravity = 1;
            tipped = false;
          }
        } else if (!pouring) {
          owed += DRAIN_BASE + count * DRAIN_PER_GRAIN;
          const whole = Math.floor(owed);
          owed -= whole;
          sieve(floorRow * columns, whole);
        }
      },

      render(field) {
        for (let i = 0; i < field.length; i += 1) field[i] = SHADES[grains[i]];
      },

      pace() {
        if (count > 0 || pouring) return "active";
        return quietSince < TRICKLE_UNTIL_MS ? "idle" : "still";
      },
    };
  },
};
