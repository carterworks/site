import { line } from "./line";
import {
  fixedStep,
  pointOn,
  TUNED_GRID,
  visibleCells,
  type Point,
  type Toy,
} from "./toy";

/** White on transparent, so a faint grain lets any page show through. */
const ALPHAS = [0, 140, 199, 255];
/**
 * Tunables below were set on the tuned grid; they scale by `width / TUNED_GRID`
 * so pours, taps and the trickle keep their on-screen size on a denser canvas.
 */
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
/** Steps in the trickle window run at ~8 fps: nothing moves between grains. */
const IDLE_FRAME_MS = 125;
const STEP_MS = 1000 / 60;
/** A frame after a long pause, like a hidden tab, replays this much, not the whole gap. */
const MAX_CATCH_UP_MS = 100;

/**
 * Once the heap rests, the sieve opens for a short drip and then the loop
 * sleeps until the next one. A full tray (~3.5k grains at the tuned grid) takes
 * about two minutes to empty at this pace, and frames only run during a drip.
 */
const DRIP_EVERY_MS = 1000;
const DRIP_STEPS = 6;
const DRIP_GRAINS = 30;
/** Sweeps a drip may fast-forward to rest the heap, instead of animating them. */
const MAX_SETTLE_SWEEPS = 200;
const TIPPED_DRAIN = 12;

/**
 * Falling sand in a tray the size of the visible screen. Grains pile on its
 * bottom edge and slip down dunes; the sieve floor drips grains through, so an
 * untouched tab slowly empties and the loop can stop. A double-tap tips the
 * tray out: gravity reverses and the new floor is wide open until the sand is
 * gone.
 *
 * Until the first input a small settled dune rests on the floor as a hint that
 * the tray is live. It is frozen and costs nothing; the first input hands it
 * to the normal sim, so it drains like any poured sand.
 */
export const silt: Toy = {
  id: "silt",
  label: "Silt",
  look: { ghost: 55, noise: 12 },
  start(canvas) {
    const context = canvas.getContext("2d");
    if (context === null) return () => {};
    const { width: columns, height: rows } = canvas;
    const scale = columns / TUNED_GRID;
    const pourGrains = Math.round(POUR_GRAINS * scale);
    const pourSpread = POUR_SPREAD * scale;
    const tapCells = DOUBLE_TAP_CELLS * scale;
    // A grain falls one cell per sweep, so sweeping once per cell-size ratio
    // keeps its speed in px/s.
    const sweepsPerStep = Math.max(1, Math.round(scale));
    // The tray holds scale² as many grains, so a tip-out needs scale² the rate.
    const tippedDrain = Math.round(TIPPED_DRAIN * scale * scale);
    const dripPerStep = Math.round((DRIP_GRAINS * scale * scale) / DRIP_STEPS);
    const grains = new Uint8Array(columns * rows);
    const image = context.createImageData(columns, rows);
    const pixels = image.data;
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
    }
    let count = 0;
    let gravity = 1;
    let tipped = false;
    let dripLeft = 0;
    let nextDripAt = Infinity;
    let sweep = 0;
    let lastTapAt = -Infinity;
    const lastTap: Point = { x: 0, y: 0 };
    const pressAt: Point = { x: 0, y: 0 };
    const pointer: Point = { x: 0, y: 0 };
    let hasPointer = false;
    let held = false;
    const pourAt: Point = { x: 0, y: 0 };
    let pourTrail = false;
    const lineFrom: Point = { x: 0, y: 0 };
    const lineTo: Point = { x: 0, y: 0 };
    let pouring = false;
    let lastInputAt = -Infinity;
    let pristine = true;
    let seeded = false;
    let left = 0;
    let right = columns - 1;
    let top = 0;
    let bottom = rows - 1;
    let refit = true;
    // Rows that may hold grains, so a sweep and a render skip the empty rest.
    // Both only ever hold a superset of the grains, never fewer.
    let minRow = rows;
    let maxRow = -1;
    // Rows the image last showed grains in, which the next render must clear.
    let shownMin = rows;
    let shownMax = -1;
    // Set once a sweep moves nothing; anything that can move a grain clears it.
    let settled = false;
    let frame: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const put = (x: number, y: number) => {
      const cx = Math.floor(x);
      const cy = Math.floor(y);
      if (cx < left || cx > right || cy < top || cy > bottom) return;
      const i = cy * columns + cx;
      if (grains[i] === 0) {
        grains[i] = 1 + Math.floor(Math.random() * 3);
        count += 1;
        settled = false;
        minRow = Math.min(minRow, cy);
        maxRow = Math.max(maxRow, cy);
      }
    };

    const pour = (x: number, y: number) => {
      for (let k = 0; k < pourGrains; k += 1) {
        put(
          x + (Math.random() - 0.5) * pourSpread,
          y + (Math.random() - 0.5) * pourSpread,
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
      const side = Math.random() < 0.5 ? -1 : 1;
      return (
        slip(x, row, next, x + side) ||
        slip(x, row, next, x - side) ||
        creep(x, row, next, side) ||
        creep(x, row, next, -side)
      );
    };

    const sieve = (floor: number, allowed: number) => {
      const start = Math.floor(Math.random() * (right - left + 1));
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

    const tap = (at: number, x: number, y: number) => {
      if (
        at - lastTapAt < DOUBLE_TAP_MS &&
        Math.hypot(x - lastTap.x, y - lastTap.y) < tapCells
      ) {
        gravity = -gravity;
        settled = false;
        minRow = top;
        maxRow = bottom;
        tipped = gravity < 0;
        lastTapAt = -Infinity;
      } else {
        lastTapAt = at;
        lastTap.x = x;
        lastTap.y = y;
      }
    };

    // Whether the visible rect moved since the last fit. A viewport that
    // measures empty (not laid out, or hidden) falls back to the whole canvas,
    // so the scene still has room to run.
    const fit = () => {
      const visible = visibleCells(canvas);
      let nextLeft = Math.max(0, Math.ceil(visible.left));
      let nextRight = Math.min(columns - 1, Math.floor(visible.right) - 1);
      let nextTop = Math.max(0, Math.ceil(visible.top));
      let nextBottom = Math.min(rows - 1, Math.floor(visible.bottom) - 1);
      if (nextRight <= nextLeft || nextBottom <= nextTop) {
        nextLeft = nextTop = 0;
        nextRight = columns - 1;
        nextBottom = rows - 1;
      }
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
      return moved;
    };

    const render = () => {
      const first = Math.max(0, Math.min(minRow, shownMin));
      const last = Math.min(rows - 1, Math.max(maxRow, shownMax));
      for (let i = first * columns; i < (last + 1) * columns; i += 1) {
        pixels[i * 4 + 3] = ALPHAS[grains[i]];
      }
      shownMin = minRow;
      shownMax = maxRow;
      context.putImageData(image, 0, 0);
    };

    const sweepOnce = (phase: number) => {
      const floorRow = gravity > 0 ? bottom : top;
      const farRow =
        gravity > 0
          ? Math.min(bottom, Math.max(top, minRow))
          : Math.max(top, Math.min(bottom, maxRow));
      let farthest = floorRow;
      let shifted = false;
      for (let y = floorRow - gravity; y !== farRow - gravity; y -= gravity) {
        const row = y * columns;
        const next = (y + gravity) * columns;
        const forward = (y + phase) & 1;
        for (let k = 0; k < right - left + 1; k += 1) {
          const x = forward ? left + k : right - k;
          if (grains[row + x] === 0) continue;
          farthest = y;
          if (fall(x, row, next)) shifted = true;
        }
      }
      settled = !shifted;
      minRow = Math.min(farthest, floorRow);
      maxRow = Math.max(farthest, floorRow);
    };

    const pace = fixedStep(STEP_MS, MAX_CATCH_UP_MS);
    let now = 0;

    const step = () => {
      const moved = refit && fit();
      refit = false;
      if (pristine) {
        if (moved || !seeded) seedDune();
        seeded = true;
        return;
      }
      if (moved) dropOutside();

      pouring = held;
      if (pouring) {
        const here = hasPointer ? pointer : pressAt;
        const origin = pourTrail ? pourAt : pressAt;
        lineFrom.x = Math.floor(origin.x);
        lineFrom.y = Math.floor(origin.y);
        lineTo.x = Math.floor(here.x);
        lineTo.y = Math.floor(here.y);
        line(lineFrom, lineTo, put);
        pourAt.x = here.x;
        pourAt.y = here.y;
        pourTrail = true;
        pour(here.x, here.y);
      } else {
        pourTrail = false;
      }

      const quietSince = now - lastInputAt;
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
            (Math.random() - 0.5) * TRICKLE_JITTER * scale,
          gravity > 0 ? top : bottom,
        );
      }

      const floorRow = gravity > 0 ? bottom : top;
      for (let s = 0; !settled && s < sweepsPerStep; s += 1) {
        sweepOnce(sweep + s);
      }

      if (tipped) {
        sieve(floorRow * columns, tippedDrain);
        if (count === 0) {
          gravity = 1;
          tipped = false;
        }
      } else if (pouring) {
        dripLeft = 0;
      } else if (dripLeft > 0 || (settled && count > 0 && now >= nextDripAt)) {
        if (dripLeft === 0) dripLeft = DRIP_STEPS;
        sieve(floorRow * columns, dripPerStep);
        dripLeft -= 1;
        if (dripLeft === 0) {
          for (let n = 0; !settled && n < MAX_SETTLE_SWEEPS; n += 1) {
            sweepOnce(sweep + n);
          }
          nextDripAt = now + DRIP_EVERY_MS;
        }
      }
    };

    const tick = (time: number) => {
      frame = undefined;
      now = time;
      pace.advance(now, step);
      render();
      if (!pristine && (!settled || pouring || tipped || dripLeft > 0)) {
        wake();
        return;
      }
      pace.restart();
      if (pristine) return;
      if (now - lastInputAt < TRICKLE_UNTIL_MS) {
        timer = setTimeout(wake, IDLE_FRAME_MS);
      } else if (count > 0) {
        timer = setTimeout(wake, Math.max(0, nextDripAt - now));
      }
    };

    const wake = () => {
      clearTimeout(timer);
      timer = undefined;
      frame ??= requestAnimationFrame(tick);
    };

    const touched = () => {
      pristine = false;
      lastInputAt = performance.now();
      nextDripAt = lastInputAt + DRIP_EVERY_MS;
      wake();
    };

    const onDown = (event: PointerEvent) => {
      const point = pointOn(canvas, event);
      pressAt.x = point.x;
      pressAt.y = point.y;
      held = true;
      hasPointer = false;
      pourTrail = false;
      touched();
      tap(lastInputAt, point.x, point.y);
    };

    const onMove = (event: PointerEvent) => {
      const point = pointOn(canvas, event);
      pointer.x = point.x;
      pointer.y = point.y;
      hasPointer = true;
      touched();
    };

    const onLift = (event: PointerEvent) => {
      held = false;
      nextDripAt = performance.now() + DRIP_EVERY_MS;
      if (event.pointerType === "touch") hasPointer = false;
      wake();
    };

    const onLeave = () => {
      hasPointer = false;
      wake();
    };

    const onResize = () => {
      refit = true;
      wake();
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onLift);
    canvas.addEventListener("pointercancel", onLift);
    canvas.addEventListener("pointerleave", onLeave);
    window.addEventListener("resize", onResize);
    wake();

    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onLift);
      canvas.removeEventListener("pointercancel", onLift);
      canvas.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(frame ?? 0);
      clearTimeout(timer);
    };
  },
};
