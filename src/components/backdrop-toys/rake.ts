import { clamp } from "../../lib/clamp";
import { line } from "./line";
import {
  fixedStep,
  frameLoop,
  pointOn,
  TUNED_GRID,
  type Point,
  type Toy,
} from "./toy";

const GRAVEL = 150;
const GRAVEL_SPREAD = 14;
const DARK_SPECK = 40;
const DARK_SPECK_ODDS = 0.05;
const GROOVE = -42;
const RIDGE = 22;
const TIP = 235;

const TINES = 4;
const RINGS = 3;
/** Sizes below were set on the tuned grid and scale with `width / TUNED_GRID`. */
const STONE_RADIUS = 3.5;
const TAP_TRAVEL = 2;
const DOUBLE_TAP_REACH = 10;
const TAP_MS = 250;
const DOUBLE_TAP_MS = 380;
const MAX_RIPPLES = 6;
/** How much of its distance to the pointer the heavy rake closes each step. */
const CHASE = 0.25;
const RIPPLE_STEPS = 48;
const STEP_MS = 1000 / 60;
/** A frame after a long pause, like a hidden tab, replays this much, not the whole gap. */
const MAX_CATCH_UP_MS = 100;

/**
 * A zen garden of speckled gravel. Hovering shows the tips of a four-tine
 * rake. Dragging pulls the rake after the pointer, a little behind it, so its
 * grooves run perpendicular to the drag and settle into smooth curves. A quick
 * tap sets a stone whose ring grooves spread out from it, and later rakings go
 * around stones. A double tap smooths the garden back to fresh gravel; its
 * second tap lands on the stone the first one set, which goes with the rest.
 *
 * Only the pixels a stroke touches are recomputed, and frames run only while
 * the rake is catching up or a ring is spreading, so a left-alone garden costs
 * nothing.
 */
export const rake: Toy = {
  id: "rake",
  label: "Rake",
  look: { ghost: 30, noise: 6 },
  start(canvas) {
    const context = canvas.getContext("2d");
    if (context === null) return () => {};
    const { width, height } = canvas;
    const scale = width / TUNED_GRID;
    const thickness = Math.max(1, Math.round(scale));
    const spacing = 3 * thickness;
    const stoneRadius = STONE_RADIUS * scale;
    const tapTravel = TAP_TRAVEL * scale;
    const doubleTapReach = DOUBLE_TAP_REACH * scale;
    // Shorter segments would point the tines by pixel jitter, not by the hand.
    const minSegment = 2 * thickness;
    const ringReach = RINGS * spacing + 1.5 * thickness;

    const image = context.createImageData(width, height);
    const pixels = image.data;
    const speckle = new Uint8Array(width * height);
    const relief = new Int8Array(width * height);
    const stone = new Uint8Array(width * height);

    const down: Point & { at: number } = { x: 0, y: 0, at: 0 };
    const anchor: Point = { x: 0, y: 0 };
    const hover: Point = { x: 0, y: 0 };
    const head: Point = { x: 0, y: 0 };
    const goal: Point = { x: 0, y: 0 };
    let trailing = false;
    const rippleX = new Float64Array(MAX_RIPPLES);
    const rippleY = new Float64Array(MAX_RIPPLES);
    const rippleReach = new Float64Array(MAX_RIPPLES);
    let rippleCount = 0;
    const pacer = fixedStep(STEP_MS, MAX_CATCH_UP_MS);
    const tips = new Int32Array(TINES * thickness * thickness);
    let tipCount = 0;
    let hovering = false;
    const from: Point = { x: 0, y: 0 };
    const to: Point = { x: 0, y: 0 };
    const lastTap: Point = { x: 0, y: 0 };
    let lastTapAt = -Infinity;
    let pressed = false;
    let raking = false;
    const across: Point = { x: 0, y: 1 };
    let dirty = true;

    for (let i = 0; i < speckle.length; i += 1) {
      speckle[i] =
        GRAVEL +
        Math.round((Math.random() * 2 - 1) * GRAVEL_SPREAD) -
        (Math.random() < DARK_SPECK_ODDS ? DARK_SPECK : 0);
    }

    const paint = (i: number) => {
      const level =
        stone[i] !== 0 ? stone[i] : clamp(speckle[i] + relief[i], 0, 255);
      pixels[i * 4] = pixels[i * 4 + 1] = pixels[i * 4 + 2] = level;
      pixels[i * 4 + 3] = 255;
    };

    const smooth = () => {
      rippleCount = 0;
      relief.fill(0);
      stone.fill(0);
      for (let i = 0; i < speckle.length; i += 1) paint(i);
    };

    const block = (x: number, y: number, apply: (i: number) => void) => {
      const left = x - (thickness >> 1);
      const top = y - (thickness >> 1);
      for (
        let row = Math.max(0, top);
        row < Math.min(height, top + thickness);
        row += 1
      ) {
        for (
          let column = Math.max(0, left);
          column < Math.min(width, left + thickness);
          column += 1
        ) {
          apply(row * width + column);
        }
      }
    };

    let depth = 0;
    const cut = (i: number) => {
      // A ridge never fills a groove, but a groove cuts through a ridge.
      if (stone[i] !== 0 || (depth > 0 && relief[i] !== 0)) return;
      relief[i] = depth;
      paint(i);
    };

    const carve = (x: number, y: number, by: number) => {
      depth = by;
      block(x, y, cut);
    };

    const lightTip = (i: number) => {
      if (stone[i] !== 0) return;
      pixels[i * 4] = pixels[i * 4 + 1] = pixels[i * 4 + 2] = TIP;
      tips[tipCount++] = i;
    };

    const clearTips = () => {
      for (let t = 0; t < tipCount; t += 1) paint(tips[t]);
      tipCount = 0;
    };

    const showTips = (x: number, y: number) => {
      clearTips();
      for (let tine = 0; tine < TINES; tine += 1) {
        const offset = (tine - (TINES - 1) / 2) * spacing;
        block(
          Math.round(x + across.x * offset),
          Math.round(y + across.y * offset),
          lightTip,
        );
      }
    };

    const rakeAt = (x: number, y: number) => {
      for (let tine = 0; tine < TINES; tine += 1) {
        const offset = (tine - (TINES - 1) / 2) * spacing;
        const cx = x + Math.round(across.x * offset);
        const cy = y + Math.round(across.y * offset);
        carve(cx, cy, GROOVE);
        const shoulderX = Math.round(across.x * thickness);
        const shoulderY = Math.round(across.y * thickness);
        carve(cx + shoulderX, cy + shoulderY, RIDGE);
        carve(cx - shoulderX, cy - shoulderY, RIDGE);
      }
    };

    const placeStone = (cx: number, cy: number) => {
      const top = Math.max(0, Math.floor(cy - stoneRadius));
      const bottom = Math.min(height - 1, Math.ceil(cy + stoneRadius));
      const left = Math.max(0, Math.floor(cx - stoneRadius));
      const right = Math.min(width - 1, Math.ceil(cx + stoneRadius));
      for (let y = top; y <= bottom; y += 1) {
        for (let x = left; x <= right; x += 1) {
          const dx = x + 0.5 - cx;
          const dy = y + 0.5 - cy;
          if (Math.hypot(dx, dy) > stoneRadius) continue;
          // Lit from the top left: brightest on that shoulder, darkest opposite.
          const lit =
            1 -
            Math.hypot(dx + 0.35 * stoneRadius, dy + 0.35 * stoneRadius) /
              (1.35 * stoneRadius);
          const i = y * width + x;
          stone[i] = Math.max(1, Math.round(55 + 90 * clamp(lit, 0, 1)));
          paint(i);
        }
      }
    };

    /** Grooves the band of ring ground the ripple has newly reached. */
    const spread = (ripple: number) => {
      const cx = rippleX[ripple];
      const cy = rippleY[ripple];
      const before = rippleReach[ripple];
      const after = Math.min(before + ringReach / RIPPLE_STEPS, ringReach);
      rippleReach[ripple] = after;
      const far = stoneRadius + after;
      const top = Math.max(0, Math.floor(cy - far));
      const bottom = Math.min(height - 1, Math.ceil(cy + far));
      const left = Math.max(0, Math.floor(cx - far));
      const right = Math.min(width - 1, Math.ceil(cx + far));
      for (let y = top; y <= bottom; y += 1) {
        for (let x = left; x <= right; x += 1) {
          const i = y * width + x;
          const out = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - stoneRadius;
          if (out <= before || out > after || stone[i] !== 0) continue;
          const ring = Math.round(out / spacing);
          if (ring < 1 || ring > RINGS) continue;
          const miss = Math.abs(out - ring * spacing);
          if (miss <= thickness / 2) relief[i] = GROOVE;
          else if (miss <= 1.5 * thickness && relief[i] === 0)
            relief[i] = RIDGE;
          else continue;
          paint(i);
        }
      }
    };

    const stepRipples = () => {
      for (let ripple = rippleCount - 1; ripple >= 0; ripple -= 1) {
        spread(ripple);
        if (rippleReach[ripple] < ringReach) continue;
        rippleCount -= 1;
        rippleX[ripple] = rippleX[rippleCount];
        rippleY[ripple] = rippleY[rippleCount];
        rippleReach[ripple] = rippleReach[rippleCount];
      }
      dirty = true;
    };

    const place = (cx: number, cy: number) => {
      placeStone(cx, cy);
      const ripple = Math.min(rippleCount, MAX_RIPPLES - 1);
      rippleX[ripple] = cx;
      rippleY[ripple] = cy;
      rippleReach[ripple] = 0;
      rippleCount = ripple + 1;
    };

    const tap = (now: number, point: Point) => {
      if (
        now - lastTapAt < DOUBLE_TAP_MS &&
        Math.hypot(point.x - lastTap.x, point.y - lastTap.y) < doubleTapReach
      ) {
        smooth();
        lastTapAt = -Infinity;
        return;
      }
      lastTapAt = now;
      lastTap.x = point.x;
      lastTap.y = point.y;
      const x = clamp(Math.floor(point.x), 0, width - 1);
      const y = clamp(Math.floor(point.y), 0, height - 1);
      if (stone[y * width + x] === 0) place(point.x, point.y);
    };

    const chase = () => {
      head.x += (goal.x - head.x) * CHASE;
      head.y += (goal.y - head.y) * CHASE;
      const arrived = Math.hypot(goal.x - head.x, goal.y - head.y) < 1;
      if (arrived) {
        head.x = goal.x;
        head.y = goal.y;
        trailing = false;
      }
      const dx = head.x - anchor.x;
      const dy = head.y - anchor.y;
      const length = Math.hypot(dx, dy);
      if (length < (arrived ? 1 : minSegment)) return;
      across.x = -dy / length;
      across.y = dx / length;
      from.x = Math.round(anchor.x);
      from.y = Math.round(anchor.y);
      to.x = Math.round(head.x);
      to.y = Math.round(head.y);
      line(from, to, visit);
      anchor.x = head.x;
      anchor.y = head.y;
      dirty = true;
    };

    const step = () => {
      if (trailing) chase();
      if (rippleCount > 0) stepRipples();
    };

    const draw = (now: number) => {
      if (trailing || rippleCount > 0) pacer.advance(now, step);
      if (dirty) {
        context.putImageData(image, 0, 0);
        dirty = false;
      }
      const going = trailing || rippleCount > 0;
      if (!going) pacer.restart();
      return going;
    };

    const loop = frameLoop(draw);

    const wake = () => {
      dirty = true;
      loop.wake();
    };

    const visit = (x: number, y: number) => rakeAt(x, y);

    const onDown = (event: PointerEvent) => {
      clearTips();
      const point = pointOn(canvas, event);
      down.x = anchor.x = head.x = point.x;
      down.y = anchor.y = head.y = point.y;
      trailing = false;
      down.at = performance.now();
      pressed = true;
      raking = false;
    };

    const onMove = (event: PointerEvent) => {
      const point = pointOn(canvas, event);
      if (!pressed) {
        if (!hovering) {
          hover.x = point.x;
          hover.y = point.y;
          hovering = true;
        }
        const length = Math.hypot(point.x - hover.x, point.y - hover.y);
        if (length >= minSegment) {
          across.x = -(point.y - hover.y) / length;
          across.y = (point.x - hover.x) / length;
          hover.x = point.x;
          hover.y = point.y;
        }
        showTips(point.x, point.y);
        wake();
        return;
      }
      if (!raking) {
        if (Math.hypot(point.x - down.x, point.y - down.y) <= tapTravel) return;
        raking = true;
      }
      goal.x = point.x;
      goal.y = point.y;
      trailing = true;
      wake();
    };

    const onUp = (event: PointerEvent) => {
      if (!pressed) return;
      pressed = false;
      const now = performance.now();
      if (!raking && now - down.at < TAP_MS) {
        tap(now, pointOn(canvas, event));
        wake();
      }
    };

    const onCancel = () => {
      pressed = false;
      hovering = false;
      if (tipCount === 0) return;
      clearTips();
      wake();
    };

    const listening = new AbortController();
    const { signal } = listening;
    canvas.addEventListener("pointerdown", onDown, { signal });
    canvas.addEventListener("pointermove", onMove, { signal });
    canvas.addEventListener("pointerup", onUp, { signal });
    canvas.addEventListener("pointercancel", onCancel, { signal });
    canvas.addEventListener("pointerleave", onCancel, { signal });
    smooth();
    wake();

    return () => {
      listening.abort();
      loop.stop();
    };
  },
};
