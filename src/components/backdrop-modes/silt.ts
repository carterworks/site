import { line } from "./line";
import type { Mode, Point } from "./mode";

const SHADES = [0, 0.55, 0.78, 1];
/**
 * Tunables below were set on an 80-cell grid; they scale by `columns / TUNED_COLUMNS`
 * so pours, taps and the trickle keep their on-screen size on a denser grid.
 */
const TUNED_COLUMNS = 80;
const POUR_GRAINS = 3;
const POUR_SPREAD = 3;
const DOUBLE_TAP_MS = 380;
const DOUBLE_TAP_CELLS = 10;
const TRICKLE_JITTER = 1.5;

/**
 * The starting dune is a half-cosine bump. Its height is a seventh of its width
 * so the slope stays under half a cell per cell: any steeper and grains would
 * slip, and the "settled" scene would animate.
 */
const DUNE_WIDTH_SHARE = 0.4;
const DUNE_HEIGHT_SHARE = 0.14;

/** Quiet time before the stream starts, and how long after input it may run. */
const TRICKLE_AFTER_MS = 3000;
const TRICKLE_UNTIL_MS = 10_000;
const TRICKLE_EVERY_STEPS = 2;

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
 *
 * Until the first input a small settled dune rests on the floor as a hint that
 * the tray is live. It is frozen and costs nothing; the first input hands it
 * to the normal sim, so it drains like any poured sand.
 */
export const silt: Mode = {
  id: "silt",
  label: "Silt",
  look: { ghost: 55, noise: 12 },
  holds: true,
  create({ columns, rows, random }) {
    const scale = columns / TUNED_COLUMNS;
    const pourGrains = Math.round(POUR_GRAINS * scale);
    const pourSpread = POUR_SPREAD * scale;
    const tapCells = DOUBLE_TAP_CELLS * scale;
    // A grain falls one cell per sweep, so sweeping once per cell-size ratio
    // keeps its speed in px/s.
    const sweepsPerStep = Math.max(1, Math.round(scale));
    const drainBase = DRAIN_BASE * scale;
    // The tray holds scale² as many grains, so a tip-out needs scale² the rate.
    const tippedDrain = Math.round(TIPPED_DRAIN * scale * scale);
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
    let pristine = true;
    let seeded = false;
    let left = 0;
    let right = columns - 1;
    let top = 0;
    let bottom = rows - 1;
    // Rows that may hold grains, so a sweep and a render skip the empty rest.
    // Both only ever hold a superset of the grains, never fewer.
    let minRow = rows;
    let maxRow = -1;
    // Set once a sweep moves nothing; anything that can move a grain clears it.
    let settled = false;

    const put = (x: number, y: number) => {
      const cx = Math.floor(x);
      const cy = Math.floor(y);
      if (cx < left || cx > right || cy < top || cy > bottom) return;
      const i = cy * columns + cx;
      if (grains[i] === 0) {
        grains[i] = 1 + Math.floor(random() * 3);
        count += 1;
        settled = false;
        minRow = Math.min(minRow, cy);
        maxRow = Math.max(maxRow, cy);
      }
    };

    const pour = (x: number, y: number) => {
      for (let k = 0; k < pourGrains; k += 1) {
        put(
          x + (random() - 0.5) * pourSpread,
          y + (random() - 0.5) * pourSpread,
        );
      }
    };

    const slide = (from: number, to: number) => {
      grains[to] = grains[from];
      grains[from] = 0;
    };

    const slip = (x: number, row: number, next: number, nx: number) => {
      if (
        nx < left ||
        nx > right ||
        grains[next + nx] !== 0 ||
        grains[row + nx] !== 0
      ) {
        return false;
      }
      slide(row + x, next + nx);
      return true;
    };

    // Steps sideways, level, to the edge of a step whose far side is free, so
    // the grain tumbles down next sweep; a heap then rests at about half the
    // slope that diagonal slips alone leave.
    const creep = (x: number, row: number, next: number, side: number) => {
      const nx = x + side;
      const far = nx + side;
      if (
        far < left ||
        far > right ||
        grains[next + nx] === 0 ||
        grains[row + nx] !== 0 ||
        grains[row + far] !== 0 ||
        grains[next + far] !== 0
      ) {
        return false;
      }
      slide(row + x, row + nx);
      return true;
    };

    const fall = (x: number, row: number, next: number) => {
      if (grains[next + x] === 0) {
        slide(row + x, next + x);
        return true;
      }
      const side = random() < 0.5 ? -1 : 1;
      return (
        slip(x, row, next, x + side) ||
        slip(x, row, next, x - side) ||
        creep(x, row, next, side) ||
        creep(x, row, next, -side)
      );
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
          settled = false;
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

    const seedDune = () => {
      grains.fill(0);
      count = 0;
      minRow = rows;
      maxRow = -1;
      const width = Math.round((right - left + 1) * DUNE_WIDTH_SHARE);
      const height = width * DUNE_HEIGHT_SHARE;
      const start = Math.round((left + right - width) / 2);
      for (let k = 0; k < width; k += 1) {
        const rise = Math.round(
          (height * (1 - Math.cos((2 * Math.PI * (k + 0.5)) / width))) / 2,
        );
        for (let h = 0; h < rise; h += 1) put(start + k, bottom - h);
      }
    };

    const tap = (press: { at: number; x: number; y: number }) => {
      if (
        press.at - lastTap.at < DOUBLE_TAP_MS &&
        Math.hypot(press.x - lastTap.x, press.y - lastTap.y) < tapCells
      ) {
        gravity = -gravity;
        settled = false;
        minRow = top;
        maxRow = bottom;
        tipped = gravity < 0;
        lastTap = { at: -Infinity, x: 0, y: 0 };
      } else {
        lastTap = { at: press.at, x: press.x, y: press.y };
      }
    };
    return {
      step({ press, pointer, lastInputAt, visible }, now) {
        if (
          lastInputAt !== -Infinity ||
          press !== undefined ||
          pointer !== undefined
        ) {
          pristine = false;
        }
        const nextLeft = Math.max(0, Math.ceil(visible.left));
        const nextRight = Math.min(columns - 1, Math.floor(visible.right) - 1);
        const nextTop = Math.max(0, Math.ceil(visible.top));
        const nextBottom = Math.min(rows - 1, Math.floor(visible.bottom) - 1);
        const moved =
          left !== nextLeft ||
          right !== nextRight ||
          top !== nextTop ||
          bottom !== nextBottom;
        if (moved) settled = false;
        left = nextLeft;
        right = nextRight;
        top = nextTop;
        bottom = nextBottom;
        if (right <= left || bottom <= top) return;
        if (pristine) {
          if (moved || !seeded) seedDune();
          seeded = true;
          return;
        }
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
            put,
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
            (left + right) / 2 +
              wander +
              (random() - 0.5) * TRICKLE_JITTER * scale,
            gravity > 0 ? top : bottom,
          );
        }

        const floorRow = gravity > 0 ? bottom : top;
        let farthest = floorRow;
        let swept = false;
        for (let s = 0; !settled && s < sweepsPerStep; s += 1) {
          const farRow =
            gravity > 0
              ? Math.min(bottom, Math.max(top, minRow))
              : Math.max(top, Math.min(bottom, maxRow));
          farthest = floorRow;
          swept = true;
          let shifted = false;
          for (
            let y = floorRow - gravity;
            y !== farRow - gravity;
            y -= gravity
          ) {
            const row = y * columns;
            const next = (y + gravity) * columns;
            const forward = (y + sweep + s) & 1;
            for (let k = 0; k < right - left + 1; k += 1) {
              const x = forward ? left + k : right - k;
              if (grains[row + x] === 0) continue;
              farthest = y;
              if (fall(x, row, next)) shifted = true;
            }
          }
          settled = !shifted;
        }
        if (swept) {
          minRow = Math.min(farthest, floorRow);
          maxRow = Math.max(farthest, floorRow);
        }

        if (tipped) {
          sieve(floorRow * columns, tippedDrain);
          if (count === 0) {
            gravity = 1;
            tipped = false;
          }
        } else if (!pouring) {
          owed += drainBase + count * DRAIN_PER_GRAIN;
          const whole = Math.floor(owed);
          owed -= whole;
          sieve(floorRow * columns, whole);
        }
      },

      render(field) {
        const end = Math.min(field.length, (maxRow + 1) * columns);
        for (let i = Math.max(0, minRow) * columns; i < end; i += 1) {
          field[i] = SHADES[grains[i]];
        }
      },

      pace() {
        if (pristine) return "still";
        if (count > 0 || pouring) return "active";
        return quietSince < TRICKLE_UNTIL_MS ? "idle" : "still";
      },
    };
  },
};
