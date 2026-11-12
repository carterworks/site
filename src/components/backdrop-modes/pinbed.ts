import {
  cellScale,
  clamp,
  fixedStep,
  pointOn,
  sameRect,
  visibleCells,
  type CellRect,
  type Toy,
} from "./toy";

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
const STEP_MS = 1000 / 60;
/** A frame after a long pause, like a hidden tab, replays this much, not the whole gap. */
const MAX_CATCH_UP_MS = 100;
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
 * visible area as a hint that the bed is live. It is frozen, so the toy stays
 * still; the first input lets it spring back like any other dent.
 *
 * The loop sleeps once every pin is up, so the ambient pebble is tied to
 * input: one rolls across the visible area a few seconds after the last
 * input, woken by a timer, then the toy goes still until the pointer is next
 * touched.
 *
 * It draws white on transparent, a pin's depth as its opacity in fifths, into
 * its own image data put whole each frame.
 */
export const pinbed: Toy = {
  id: "pinbed",
  label: "Pinbed",
  look: { ghost: 40, noise: 8 },
  start(canvas) {
    const context = canvas.getContext("2d");
    if (context === null) return () => {};
    const { width: columns, height: rows } = canvas;
    const scale = cellScale(PROTOTYPE_CELL_PX, columns);
    const hoverRadius = 3.4 * scale;
    const pressRadius = 5.5 * scale;
    const pebbleRadius = 3 * scale;
    const palmRadius = 7 * scale;
    const fingerRadius = 2.2 * scale;
    // The dent's far wall is lit above this rise over its up-left neighbour.
    const litRise = 0.04 / scale;
    const image = context.createImageData(columns, rows);
    const pixels = image.data;
    const depth = new Float32Array(columns * rows);
    const pushedAt = new Float32Array(columns * rows).fill(-Infinity);
    // Only pins that are down are relaxed and drawn; scanning all of them each
    // frame reads every cell of the grid, which is far more than the handful of
    // dents ever need.
    const down = new Int32Array(columns * rows);
    const isDown = new Uint8Array(columns * rows);
    let downCount = 0;
    const spring = Float32Array.from(
      { length: columns * rows },
      () => 0.003 + Math.random() * 0.011,
    );
    let pebble: { x: number; y: number; vx: number; vy: number } | undefined;
    let pebbleAt: number | undefined;
    let visible = visibleCells(canvas);
    let printedIn: CellRect | undefined;
    let pristine = true;
    let inputPending = false;
    let tapPending = false;
    let held = false;
    let pressAt: number | undefined;
    let hovering = false;
    let pointerX = 0;
    let pointerY = 0;
    let seenX = Number.NaN;
    let seenY = Number.NaN;
    let lit = false;
    let now = 0;
    let frame: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

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

    const launchPebble = () => {
      const fromLeft = Math.random() < 0.5;
      const margin = 4 * scale;
      const height = visible.bottom - visible.top;
      const speed = PEBBLE_SPEED + Math.random() * PEBBLE_SPEED_JITTER;
      pebble = {
        x: fromLeft ? visible.left - margin : visible.right + margin,
        y: visible.top + height * (0.15 + Math.random() * 0.7),
        vx: fromLeft ? speed : -speed,
        vy: (Math.random() - 0.5) * 0.05 * scale,
      };
    };

    const paint = () => {
      pixels.fill(0);
      for (let k = 0; k < downCount; k += 1) {
        const i = down[k];
        const rise =
          i % columns > 0 && i >= columns
            ? depth[i] - depth[i - columns - 1]
            : 0;
        const level = depth[i] * 0.7 + (rise > litRise ? 0.3 : 0);
        const o = i * 4;
        pixels[o] = pixels[o + 1] = pixels[o + 2] = 255;
        pixels[o + 3] = Math.round(clamp(level, 0, 1) * 5) * 51;
      }
      context.putImageData(image, 0, 0);
      lit = downCount > 0;
    };

    const imprintHand = () => {
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
      paint();
    };

    const relax = () => {
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
    };

    const pace = fixedStep(STEP_MS, MAX_CATCH_UP_MS);

    const simulate = () => {
      if (tapPending) {
        tapPending = false;
        pressAt = now;
        push(pointerX, pointerY, pressRadius, TAP_DEPTH, 1);
      }
      if (held && pressAt !== undefined) {
        const strength = Math.min(
          1,
          HOLD_START + (now - pressAt) / HOLD_RAMP_MS,
        );
        push(pointerX, pointerY, pressRadius, strength, GRAB);
      } else if (hovering && (pointerX !== seenX || pointerY !== seenY)) {
        push(pointerX, pointerY, hoverRadius, HOVER_DEPTH, GRAB);
      }
      seenX = hovering ? pointerX : Number.NaN;
      seenY = hovering ? pointerY : Number.NaN;

      if (inputPending) {
        inputPending = false;
        pebble = undefined;
        pebbleAt = now + PEBBLE_DELAY_MS + Math.random() * PEBBLE_JITTER_MS;
      }
      if (pebbleAt !== undefined && now >= pebbleAt) {
        pebbleAt = undefined;
        launchPebble();
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

      relax();
    };

    const step = (time: number) => {
      frame = undefined;
      clearTimeout(timer);
      timer = undefined;
      now = time;

      if (pristine) {
        pace.restart();
        if (printedIn === undefined || !sameRect(printedIn, visible)) {
          imprintHand();
        }
        return;
      }

      pace.advance(now, simulate);
      if (downCount > 0 || lit) paint();

      if (held || downCount > 0 || pebble !== undefined) wake();
      else {
        pace.restart();
        if (pebbleAt !== undefined) {
          timer = setTimeout(wake, Math.max(0, pebbleAt - now));
        }
      }
    };

    const wake = () => {
      frame ??= requestAnimationFrame(step);
    };

    const receive = (event: PointerEvent) => {
      const point = pointOn(canvas, event);
      pointerX = point.x;
      pointerY = point.y;
      hovering = true;
      pristine = false;
      inputPending = true;
      wake();
    };

    const onDown = (event: PointerEvent) => {
      held = true;
      tapPending = true;
      receive(event);
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "touch" && !held) return;
      receive(event);
    };

    const onLift = (event: PointerEvent) => {
      if (pristine) return;
      held = false;
      inputPending = true;
      if (event.pointerType === "touch") hovering = false;
      wake();
    };

    const onLeave = () => {
      hovering = false;
    };

    const onResize = () => {
      visible = visibleCells(canvas);
      if (pristine) wake();
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
