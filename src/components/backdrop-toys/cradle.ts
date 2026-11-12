import { clamp } from "../../lib/clamp";
import { line } from "./line";
import {
  fixedStep,
  pointOn,
  visibleCells,
  type CellRect,
  type Point,
  type Toy,
} from "./toy";

const BALLS = 5;
/** Lengths in ball radii; the scene fits the smaller of these spans to the visible part. */
const SPAN_RADII = 28;
const HEIGHT_RADII = 13;
const STRING_RADII = 7;
const BASE_GAP_RADII = 1;
const MAX_ANGLE = 1;
/** For a swing about 1.4 s long, in rad/s² per radian of lean. */
const GRAVITY = ((2 * Math.PI) / 1.4) ** 2;
const RESTITUTION = 0.97;
/** Air drag per second on each ball's speed, plus a constant pivot friction that ends the last small swings. */
const AIR_DRAG = 0.2;
const FRICTION = 0.1;
/** Balls this close in angle are touching, so a resting row passes a knock straight through. */
const CONTACT = 1e-4;
const COLLISION_PASSES = 4 * BALLS;
/** Friction holds a ball leaning less than FRICTION / GRAVITY, so a ball within twice that is hanging straight. */
const REST_ANGLE = (2 * FRICTION) / GRAVITY;
const REST_SPEED = 0.02;
const NUDGE_SPEED = 1.35;
/** A cradle arrives with its end ball drawn out this far and just let go, to show what it does. */
const ARRIVAL_ANGLE = 0.6;
const GRAB_REACH_RADII = 1.4;
const TAP_SLOP_RADII = 0.5;
/** A pointer moving through a ball gives it this many rad/s per radian of arc it moves. */
const BRUSH = 25;
const MAX_BRUSH_SPEED = 1.5;
const STEP_MS = 1000 / 60;
const STEP_S = STEP_MS / 1000;
const MAX_CATCH_UP_MS = 100;
const FRAME_LEVEL = 0.45;
const STRING_LEVEL = 0.3;
const AMBIENT = 0.22;
const DIFFUSE = 0.55;
const SHINE = 0.9;
const GLOSS = 40;

const unit = (x: number, y: number, z: number) => {
  const length = Math.hypot(x, y, z);
  return { x: x / length, y: y / length, z: z / length };
};
/** From the upper left, towards the viewer. */
const LIGHT = unit(-0.45, -0.6, 0.66);
const HALFWAY = unit(LIGHT.x, LIGHT.y, LIGHT.z + 1);

/** Where the cradle hangs in `visible`: its ball radius, string length, middle and pivot row, in canvas pixels. */
export function cradleLayout(visible: CellRect) {
  const width = visible.right - visible.left;
  const height = visible.bottom - visible.top;
  const radius = Math.min(width / SPAN_RADII, height / HEIGHT_RADII);
  const length = STRING_RADII * radius;
  const bar = Math.max(1, radius * 0.4);
  const tall = bar + length + (1 + BASE_GAP_RADII) * radius + bar;
  return {
    radius,
    length,
    bar,
    centerX: (visible.left + visible.right) / 2,
    pivotY: visible.top + (height - tall) / 2 + bar,
  };
}

/**
 * A row of five steel balls hung from a frame by strings. Press a ball and
 * draw it out along its arc, and the balls beyond it come too; let go and
 * the knock passes through the row, so as many swing out the far side. A tap
 * that does not drag nudges the nearer end ball, and a pointer swept through
 * a ball brushes it along. Each knock loses a little,
 * and air and pivot friction bring the row to rest, so the loop stops.
 *
 * It draws white on transparent, shaded by alpha, into its own image data
 * put whole each frame.
 */
export const cradle: Toy = {
  id: "cradle",
  label: "Cradle",
  look: { ghost: 35, noise: 6 },
  start(canvas) {
    const context = canvas.getContext("2d");
    if (context === null) return () => {};
    const { width, height } = canvas;
    const image = context.createImageData(width, height);
    const pixels = image.data;
    const pace = fixedStep(STEP_MS, MAX_CATCH_UP_MS);
    const angles = new Float64Array(BALLS);
    const speeds = new Float64Array(BALLS);
    const drawn = new Float64Array(BALLS);
    angles[0] = -ARRIVAL_ANGLE;
    let layout = cradleLayout(visibleCells(canvas));
    let stale = true;
    let grabbed = -1;
    let grabOffset = 0;
    let target = 0;
    let heldFrom = -1;
    let heldTo = -1;
    const pressedAt: Point = { x: 0, y: 0 };
    let tapping = false;
    const seen: Point = { x: 0, y: 0 };
    let hasSeen = false;
    const from: Point = { x: 0, y: 0 };
    const to: Point = { x: 0, y: 0 };
    let frame: number | undefined;

    const pivotX = (ball: number) =>
      layout.centerX + (ball - 2) * 2 * layout.radius;
    const ballX = (ball: number) =>
      pivotX(ball) + layout.length * Math.sin(angles[ball]);
    const ballY = (ball: number) =>
      layout.pivotY + layout.length * Math.cos(angles[ball]);
    const pointerAngle = (ball: number, point: Point) =>
      Math.atan2(point.x - pivotX(ball), point.y - layout.pivotY);
    const weight = (ball: number) =>
      ball >= heldFrom && ball <= heldTo ? 0 : 1;

    /** Holds the grabbed ball at the target with every ball touching it on the side it is drawn to. */
    const hold = () => {
      heldFrom = heldTo = grabbed;
      if (target < 0) {
        while (
          heldFrom > 0 &&
          angles[heldFrom - 1] >= angles[heldFrom] - CONTACT
        )
          heldFrom -= 1;
      } else {
        while (
          heldTo < BALLS - 1 &&
          angles[heldTo + 1] <= angles[heldTo] + CONTACT
        )
          heldTo += 1;
      }
      for (let ball = heldFrom; ball <= heldTo; ball += 1) {
        angles[ball] = target;
        speeds[ball] = 0;
      }
    };

    const knock = (left: number) => {
      const closing = speeds[left] - speeds[left + 1];
      if (closing <= 0 || angles[left] - angles[left + 1] < -CONTACT)
        return false;
      const a = weight(left);
      const b = weight(left + 1);
      if (a + b === 0) return false;
      const impulse = ((1 + RESTITUTION) * closing) / (a + b);
      speeds[left] -= impulse * a;
      speeds[left + 1] += impulse * b;
      return true;
    };

    const separate = (left: number) => {
      const overlap = angles[left] - angles[left + 1];
      const a = weight(left);
      const b = weight(left + 1);
      if (overlap <= 0 || a + b === 0) return;
      angles[left] -= (overlap * a) / (a + b);
      angles[left + 1] += (overlap * b) / (a + b);
    };

    const step = () => {
      if (grabbed >= 0) hold();
      const drag = 1 - AIR_DRAG * STEP_S;
      for (let ball = 0; ball < BALLS; ball += 1) {
        if (weight(ball) === 0) continue;
        let speed =
          (speeds[ball] - GRAVITY * Math.sin(angles[ball]) * STEP_S) * drag;
        speed -=
          Math.sign(speed) * Math.min(Math.abs(speed), FRICTION * STEP_S);
        speeds[ball] = speed;
        angles[ball] += speed * STEP_S;
      }
      // Sweeping both ways lets a knock cross the whole row in one step, whichever way it travels.
      for (let pass = 0; pass < COLLISION_PASSES; pass += 1) {
        let knocked = false;
        for (let left = 0; left < BALLS - 1; left += 1)
          knocked = knock(left) || knocked;
        for (let left = BALLS - 2; left >= 0; left -= 1)
          knocked = knock(left) || knocked;
        if (!knocked) break;
      }
      for (let pass = 0; pass < BALLS; pass += 1)
        for (let left = 0; left < BALLS - 1; left += 1) separate(left);
    };

    const resting = () => {
      if (grabbed >= 0) return false;
      for (let ball = 0; ball < BALLS; ball += 1) {
        if (Math.abs(angles[ball]) >= REST_ANGLE) return false;
        if (Math.abs(speeds[ball]) >= REST_SPEED) return false;
      }
      return true;
    };

    const plot = (x: number, y: number, level: number, cover: number) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const i = (y * width + x) * 4;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
      pixels[i + 3] = level * 255 * cover + pixels[i + 3] * (1 - cover);
    };

    const rect = (left: number, top: number, right: number, bottom: number) => {
      for (let y = Math.round(top); y < Math.round(bottom); y += 1)
        for (let x = Math.round(left); x < Math.round(right); x += 1)
          plot(x, y, FRAME_LEVEL, 1);
    };

    const thread = (x: number, y: number) => plot(x, y, STRING_LEVEL, 1);

    const ball = (cx: number, cy: number) => {
      const { radius } = layout;
      const top = Math.floor(cy - radius - 1);
      const bottom = Math.ceil(cy + radius + 1);
      const left = Math.floor(cx - radius - 1);
      const right = Math.ceil(cx + radius + 1);
      for (let y = top; y <= bottom; y += 1) {
        for (let x = left; x <= right; x += 1) {
          const dx = x + 0.5 - cx;
          const dy = y + 0.5 - cy;
          const cover = clamp(radius + 0.5 - Math.hypot(dx, dy), 0, 1);
          if (cover === 0) continue;
          const nx = dx / radius;
          const ny = dy / radius;
          const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
          const diffuse = nx * LIGHT.x + ny * LIGHT.y + nz * LIGHT.z;
          const gleam = nx * HALFWAY.x + ny * HALFWAY.y + nz * HALFWAY.z;
          const level =
            AMBIENT +
            DIFFUSE * Math.max(0, diffuse) +
            SHINE * Math.max(0, gleam) ** GLOSS;
          plot(x, y, Math.min(1, level), cover);
        }
      }
    };

    const render = () => {
      const { radius, length, bar, centerX, pivotY } = layout;
      pixels.fill(0);
      const reach = BALLS + Math.sin(MAX_ANGLE) * STRING_RADII + 1.5;
      const left = centerX - reach * radius;
      const right = centerX + reach * radius;
      const baseY = pivotY + length + (1 + BASE_GAP_RADII) * radius;
      rect(left - bar, pivotY - bar, right + bar, pivotY);
      rect(left - bar, pivotY, left, baseY);
      rect(right, pivotY, right + bar, baseY);
      rect(left - 2 * bar, baseY, right + 2 * bar, baseY + bar);
      for (let i = 0; i < BALLS; i += 1) {
        from.x = Math.round(pivotX(i));
        from.y = Math.round(pivotY);
        to.x = Math.round(ballX(i));
        to.y = Math.round(ballY(i));
        line(from, to, thread);
      }
      for (let i = 0; i < BALLS; i += 1) ball(ballX(i), ballY(i));
      context.putImageData(image, 0, 0);
      drawn.set(angles);
      stale = false;
    };

    const moved = () => {
      for (let i = 0; i < BALLS; i += 1)
        if (angles[i] !== drawn[i]) return true;
      return false;
    };

    const draw = (now: number) => {
      frame = undefined;
      pace.advance(now, step);
      const still = resting();
      if (still) {
        angles.fill(0);
        speeds.fill(0);
      }
      if (stale || moved()) render();
      if (still) {
        pace.restart();
        return;
      }
      frame = requestAnimationFrame(draw);
    };

    const wake = () => {
      frame ??= requestAnimationFrame(draw);
    };

    const nearestBall = (point: Point, reachRadii: number) => {
      let nearest = -1;
      let gap = reachRadii * layout.radius;
      for (let i = 0; i < BALLS; i += 1) {
        const away = Math.hypot(point.x - ballX(i), point.y - ballY(i));
        if (away < gap) {
          gap = away;
          nearest = i;
        }
      }
      return nearest;
    };

    const brush = (point: Point, shift: number) => {
      const touched = nearestBall(point, 1);
      if (touched < 0 || shift === 0) return;
      speeds[touched] = clamp(
        speeds[touched] + (BRUSH * shift) / layout.length,
        -MAX_BRUSH_SPEED,
        MAX_BRUSH_SPEED,
      );
      wake();
    };

    const release = (event: PointerEvent) => {
      grabbed = heldFrom = heldTo = -1;
      tapping = false;
      // A finger next lands somewhere new, so it must not brush from here.
      if (event.pointerType === "touch") hasSeen = false;
      wake();
    };

    const onDown = (event: PointerEvent) => {
      const point = pointOn(canvas, event);
      pressedAt.x = seen.x = point.x;
      pressedAt.y = seen.y = point.y;
      hasSeen = true;
      tapping = true;
      grabbed = nearestBall(point, GRAB_REACH_RADII);
      if (grabbed >= 0) {
        target = angles[grabbed];
        grabOffset = target - pointerAngle(grabbed, point);
      }
      wake();
    };

    const onMove = (event: PointerEvent) => {
      const point = pointOn(canvas, event);
      const shift = hasSeen ? point.x - seen.x : 0;
      seen.x = point.x;
      seen.y = point.y;
      hasSeen = true;
      const slop = TAP_SLOP_RADII * layout.radius;
      if (Math.hypot(point.x - pressedAt.x, point.y - pressedAt.y) > slop)
        tapping = false;
      if (grabbed < 0) {
        brush(point, shift);
        return;
      }
      target = clamp(
        pointerAngle(grabbed, point) + grabOffset,
        -MAX_ANGLE,
        MAX_ANGLE,
      );
      // At once, so a ball let go before the next frame leaves from where the pointer last was.
      hold();
      wake();
    };

    const onUp = (event: PointerEvent) => {
      if (tapping) {
        if (pressedAt.x < layout.centerX) speeds[0] -= NUDGE_SPEED;
        else speeds[BALLS - 1] += NUDGE_SPEED;
      }
      release(event);
    };

    const onLeave = () => {
      hasSeen = false;
    };

    const onResize = () => {
      layout = cradleLayout(visibleCells(canvas));
      stale = true;
      wake();
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", release);
    canvas.addEventListener("pointerleave", onLeave);
    window.addEventListener("resize", onResize);
    wake();

    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", release);
      canvas.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(frame ?? 0);
    };
  },
};
