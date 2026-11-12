import { fixedStep, pointOn, TUNED_GRID, visibleCells, type Toy } from "./toy";

const MAX_DOMINOES = 2048;
/** Footprint sizes in cells of the tuned width: across the path, along it, and standing height. */
const LENGTH = 3;
const THICKNESS = 1;
const HEIGHT = 4;
/** Under the height, so each domino lands on the next. */
const SPACING = 3.2;
/** Closer than this to another domino, a new one would stand inside it. */
const MIN_GAP = SPACING * 0.6;
/** How far either side of a falling domino's line its top still strikes. */
const STRIKE_WIDTH = LENGTH * 0.75;
const TAP_REACH = LENGTH * 0.75;
const TAP_SLOP = 1;
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_SLOP = 4;
const FALL_STEPS = 15;
const RISE_STEPS = 9;
/** How far through its fall a domino is when it strikes the next. */
const STRIKE_AT = 0.6;
const FALLEN_LEVEL = 110;
const CURVE_SEGMENTS = 48;
const CURVE_MARGIN = 0.12;
const CURVE_SWAY = 0.15;
const STEP_MS = 1000 / 60;
/** A frame after a long pause, like a hidden tab, replays this much, not the whole gap. */
const MAX_CATCH_UP_MS = 100;

const STILL = 0;
const FALLING = 1;
const RISING = -1;

/**
 * Dominoes seen from above. A drag stands a line of them along its path,
 * each turned across it; a tap on one pushes it over away from the tap, and
 * every falling domino knocks over the next in its line and any other within
 * reach, so lines branch into one another. A double tap on empty space stands
 * them all back up. It starts on a gentle S-curve, fitted to the visible area
 * until first touched.
 *
 * It draws white on transparent, a standing domino solid and a fallen one as
 * a longer, dimmer slab, into its own image data put whole each frame. Frames
 * run only while something falls or rises.
 */
export const dominoes: Toy = {
  id: "dominoes",
  label: "Dominoes",
  look: { ghost: 35, noise: 8 },
  start(canvas) {
    const context = canvas.getContext("2d");
    if (context === null) return () => {};
    const { width, height } = canvas;
    const scale = width / TUNED_GRID;
    const length = LENGTH * scale;
    const thickness = THICKNESS * scale;
    const tall = HEIGHT * scale;
    const spacing = SPACING * scale;
    const image = context.createImageData(width, height);
    const pixels = image.data;
    const x = new Float32Array(MAX_DOMINOES);
    const y = new Float32Array(MAX_DOMINOES);
    // The unit direction of the path where the domino stands; it falls along it, one way or the other.
    const nx = new Float32Array(MAX_DOMINOES);
    const ny = new Float32Array(MAX_DOMINOES);
    const next = new Int32Array(MAX_DOMINOES);
    const previous = new Int32Array(MAX_DOMINOES);
    const tilt = new Float32Array(MAX_DOMINOES);
    const motion = new Int8Array(MAX_DOMINOES);
    const side = new Int8Array(MAX_DOMINOES);
    const struck = new Uint8Array(MAX_DOMINOES);
    let count = 0;
    let moving = 0;
    let tail = -1;
    let carry = 0;
    let pristine = true;
    let held = false;
    let laying = false;
    let pressX = 0;
    let pressY = 0;
    let lastX = 0;
    let lastY = 0;
    let emptyTapAt = -Infinity;
    let emptyTapX = 0;
    let emptyTapY = 0;
    let frame: number | undefined;
    const pace = fixedStep(STEP_MS, MAX_CATCH_UP_MS);

    const place = (px: number, py: number, dx: number, dy: number) => {
      if (count === MAX_DOMINOES) return;
      if (px < 0 || py < 0 || px >= width || py >= height) return;
      for (let i = 0; i < count; i += 1) {
        if (Math.hypot(x[i] - px, y[i] - py) < MIN_GAP * scale) return;
      }
      const i = count++;
      x[i] = px;
      y[i] = py;
      nx[i] = dx;
      ny[i] = dy;
      tilt[i] = motion[i] = struck[i] = 0;
      next[i] = previous[i] = -1;
      if (tail >= 0 && Math.hypot(x[tail] - px, y[tail] - py) <= tall) {
        next[tail] = i;
        previous[i] = tail;
      }
      tail = i;
    };

    const beginStroke = () => {
      tail = -1;
      // A full spacing owed, so the first domino stands where the stroke starts.
      carry = spacing;
    };

    const lay = (fromX: number, fromY: number, toX: number, toY: number) => {
      const distance = Math.hypot(toX - fromX, toY - fromY);
      if (distance === 0) return;
      const dx = (toX - fromX) / distance;
      const dy = (toY - fromY) / distance;
      let at = spacing - carry;
      for (; at <= distance; at += spacing) {
        place(fromX + dx * at, fromY + dy * at, dx, dy);
      }
      carry = spacing - (at - distance);
    };

    const layCurve = () => {
      const visible = visibleCells(canvas);
      const spanX = visible.right - visible.left;
      const spanY = visible.bottom - visible.top;
      const left = visible.left + spanX * CURVE_MARGIN;
      const across = spanX * (1 - 2 * CURVE_MARGIN);
      const middle = visible.top + spanY / 2;
      const sway = spanY * CURVE_SWAY;
      count = moving = 0;
      beginStroke();
      let fromX = left;
      let fromY = middle;
      for (let k = 1; k <= CURVE_SEGMENTS; k += 1) {
        const share = k / CURVE_SEGMENTS;
        const toX = left + across * share;
        const toY = middle - sway * Math.sin(share * 2 * Math.PI);
        lay(fromX, fromY, toX, toY);
        fromX = toX;
        fromY = toY;
      }
    };

    /** Starts domino `i` falling the way `fx`, `fy` points, if it stands. */
    const topple = (i: number, fx: number, fy: number) => {
      if (i < 0 || motion[i] !== STILL || tilt[i] !== 0) return;
      side[i] = fx * nx[i] + fy * ny[i] < 0 ? -1 : 1;
      motion[i] = FALLING;
      moving += 1;
    };

    const strike = (i: number) => {
      const fx = side[i] * nx[i];
      const fy = side[i] * ny[i];
      topple(side[i] > 0 ? next[i] : previous[i], fx, fy);
      for (let j = 0; j < count; j += 1) {
        if (motion[j] !== STILL || tilt[j] !== 0) continue;
        const dx = x[j] - x[i];
        const dy = y[j] - y[i];
        const ahead = dx * fx + dy * fy;
        const aside = Math.abs(dy * fx - dx * fy);
        if (ahead > 0 && ahead <= tall && aside <= STRIKE_WIDTH * scale) {
          topple(j, fx, fy);
        }
      }
    };

    const simulate = () => {
      for (let i = 0; i < count; i += 1) {
        if (motion[i] === FALLING) {
          tilt[i] = Math.min(1, tilt[i] + 1 / FALL_STEPS);
          if (struck[i] === 0 && tilt[i] >= STRIKE_AT) {
            struck[i] = 1;
            strike(i);
          }
        } else if (motion[i] === RISING) {
          tilt[i] = Math.max(0, tilt[i] - 1 / RISE_STEPS);
          if (tilt[i] === 0) struck[i] = 0;
        } else continue;
        if (tilt[i] === 0 || tilt[i] === 1) {
          motion[i] = STILL;
          moving -= 1;
        }
      }
    };

    const paintDomino = (i: number) => {
      // Accelerating like a real topple, slow off the balance point.
      const angle = tilt[i] * tilt[i] * (Math.PI / 2);
      const reach = tall * Math.sin(angle) + thickness * Math.cos(angle);
      const opacity = Math.round(255 - (255 - FALLEN_LEVEL) * Math.sin(angle));
      const fx = (side[i] || 1) * nx[i];
      const fy = (side[i] || 1) * ny[i];
      const back = -thickness / 2;
      const front = back + reach;
      const half = length / 2;
      const spreadX = Math.abs(fy) * half;
      const spreadY = Math.abs(fx) * half;
      const left = Math.max(
        0,
        Math.floor(x[i] + Math.min(fx * back, fx * front) - spreadX),
      );
      const right = Math.min(
        width - 1,
        Math.ceil(x[i] + Math.max(fx * back, fx * front) + spreadX),
      );
      const top = Math.max(
        0,
        Math.floor(y[i] + Math.min(fy * back, fy * front) - spreadY),
      );
      const bottom = Math.min(
        height - 1,
        Math.ceil(y[i] + Math.max(fy * back, fy * front) + spreadY),
      );
      for (let py = top; py <= bottom; py += 1) {
        const dy = py + 0.5 - y[i];
        for (let px = left; px <= right; px += 1) {
          const dx = px + 0.5 - x[i];
          const along = dx * fx + dy * fy;
          if (along < back || along > front) continue;
          if (Math.abs(dy * fx - dx * fy) > half) continue;
          const p = (py * width + px) * 4;
          if (opacity <= pixels[p + 3]) continue;
          pixels[p] = pixels[p + 1] = pixels[p + 2] = 255;
          pixels[p + 3] = opacity;
        }
      }
    };

    const paint = () => {
      pixels.fill(0);
      for (let i = 0; i < count; i += 1) paintDomino(i);
      context.putImageData(image, 0, 0);
    };

    const draw = (now: number) => {
      frame = undefined;
      pace.advance(now, simulate);
      paint();
      if (moving > 0) wake();
      else pace.restart();
    };

    const wake = () => {
      frame ??= requestAnimationFrame(draw);
    };

    const standingAt = (px: number, py: number) => {
      let nearest = -1;
      let best = TAP_REACH * scale;
      for (let i = 0; i < count; i += 1) {
        if (motion[i] !== STILL || tilt[i] !== 0) continue;
        const distance = Math.hypot(x[i] - px, y[i] - py);
        if (distance <= best) {
          best = distance;
          nearest = i;
        }
      }
      return nearest;
    };

    const raiseAll = () => {
      for (let i = 0; i < count; i += 1) {
        if (tilt[i] === 0) continue;
        if (motion[i] === STILL) moving += 1;
        motion[i] = RISING;
      }
    };

    const tap = (px: number, py: number) => {
      const hit = standingAt(px, py);
      if (hit >= 0) {
        topple(hit, x[hit] - px, y[hit] - py);
        emptyTapAt = -Infinity;
        return;
      }
      const now = performance.now();
      const again =
        now - emptyTapAt <= DOUBLE_TAP_MS &&
        Math.hypot(px - emptyTapX, py - emptyTapY) <= DOUBLE_TAP_SLOP * scale;
      if (again) {
        raiseAll();
        emptyTapAt = -Infinity;
        return;
      }
      emptyTapAt = now;
      emptyTapX = px;
      emptyTapY = py;
    };

    const onDown = (event: PointerEvent) => {
      if (held) return;
      const point = pointOn(canvas, event);
      held = true;
      laying = false;
      pristine = false;
      pressX = lastX = point.x;
      pressY = lastY = point.y;
      beginStroke();
    };

    const onMove = (event: PointerEvent) => {
      if (!held) return;
      if (event.buttons === 0) {
        held = false;
        return;
      }
      const point = pointOn(canvas, event);
      if (
        !laying &&
        Math.hypot(point.x - pressX, point.y - pressY) <= TAP_SLOP * scale
      ) {
        return;
      }
      laying = true;
      lay(lastX, lastY, point.x, point.y);
      lastX = point.x;
      lastY = point.y;
      wake();
    };

    const onUp = () => {
      if (!held) return;
      held = false;
      if (!laying) tap(pressX, pressY);
      wake();
    };

    const onCancel = () => {
      held = false;
    };

    const onResize = () => {
      if (!pristine) return;
      layCurve();
      wake();
    };

    layCurve();
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onCancel);
    window.addEventListener("resize", onResize);
    wake();

    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(frame ?? 0);
    };
  },
};
