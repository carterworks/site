import { clamp } from "../../lib/clamp";
import { line } from "./line";
import { duration, pointOn, TUNED_GRID, type Point, type Toy } from "./toy";

const MAX_RIPPLES = 24;

/** For a page that sets no `--backdrop-ripple-*`, like a plain canvas's. */
const DEFAULT_RIPPLE_SIZE = 25;
const DEFAULT_RIPPLE_MS = 900;

type Ripple = Point & { size: number; ms: number; born?: number };

function knob(canvas: Element, name: string, parse: typeof duration) {
  const value = parse(getComputedStyle(canvas).getPropertyValue(name).trim());
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * The original backdrop: moving the pointer smears a segment from the pixel it
 * left to the one it entered, and each press drops an expanding ring. The
 * segment is drawn only on the frame after a move, so on the backdrop the
 * canvas's ghost alone fades it into a trail.
 *
 * It draws white on transparent, fading by alpha so any page shows through a
 * faint pixel, into its own image data put whole each frame, so presenting it
 * on an emulated canvas needs no read-back. A ring's size
 * and lifetime come from `--backdrop-ripple-size` (in pixels of the tuned
 * width) and `--backdrop-ripple-speed`, read at each press.
 */
export const shimmer: Toy = {
  id: "shimmer",
  label: "Shimmer",
  start(canvas) {
    const context = canvas.getContext("2d");
    if (context === null) return () => {};
    const { width, height } = canvas;
    const scale = width / TUNED_GRID;
    // Scaled with the canvas, the segment stays as heavy as one pixel was at the tuned width.
    const thickness = Math.max(1, Math.round(scale));
    const image = context.createImageData(width, height);
    const pixels = image.data;
    const ripples: Ripple[] = [];
    const hovered: Point = { x: 0, y: 0 };
    const from: Point = { x: 0, y: 0 };
    let hovering = false;
    let moved = false;
    // Set to start, so the first frame clears whatever the canvas showed.
    let lit = true;
    let frame: number | undefined;

    const plot = (x: number, y: number, opacity: number) => {
      const i = (y * width + x) * 4;
      if (opacity <= pixels[i + 3]) return;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
      pixels[i + 3] = opacity;
    };

    const stamp = (x: number, y: number) => {
      const right = Math.min(x + thickness, width);
      const bottom = Math.min(y + thickness, height);
      for (let row = y; row < bottom; row += 1)
        for (let column = x; column < right; column += 1)
          plot(column, row, 255);
    };

    const ring = (ripple: Ripple, progress: number) => {
      const radius = progress * ripple.size * scale;
      const strength = 1 - progress;
      const reach = Math.ceil(radius + 1);
      const top = Math.max(0, Math.floor(ripple.y) - reach);
      const bottom = Math.min(height - 1, Math.floor(ripple.y) + reach);
      const left = Math.max(0, Math.floor(ripple.x) - reach);
      const right = Math.min(width - 1, Math.floor(ripple.x) + reach);
      for (let y = top; y <= bottom; y += 1) {
        for (let x = left; x <= right; x += 1) {
          const distance = Math.hypot(x + 0.5 - ripple.x, y + 0.5 - ripple.y);
          // A one-pixel stroke covers a pixel by how near its centre is to the ring.
          const cover = 1 - Math.abs(distance - radius);
          if (cover > 0) plot(x, y, cover * strength * 255);
        }
      }
    };

    const draw = (now: number) => {
      frame = undefined;
      pixels.fill(0);
      let drew = false;
      if (moved && hovering) {
        line(from, hovered, stamp);
        moved = false;
        drew = true;
      }
      for (let i = ripples.length - 1; i >= 0; i -= 1) {
        const ripple = ripples[i];
        ripple.born ??= now;
        const progress = (now - ripple.born) / ripple.ms;
        if (progress >= 1) {
          ripples.splice(i, 1);
          continue;
        }
        ring(ripple, progress);
        drew = true;
      }
      if (drew || lit) context.putImageData(image, 0, 0);
      // A frame that drew needs one more after it, to clear what it drew.
      lit = drew;
      if (drew) wake();
    };

    const wake = () => {
      frame ??= requestAnimationFrame(draw);
    };

    const onMove = (event: PointerEvent) => {
      const point = pointOn(canvas, event);
      const x = clamp(Math.floor(point.x), 0, width - 1);
      const y = clamp(Math.floor(point.y), 0, height - 1);
      if (!hovering) {
        from.x = x;
        from.y = y;
      } else if (x !== hovered.x || y !== hovered.y) {
        from.x = hovered.x;
        from.y = hovered.y;
      }
      hovered.x = x;
      hovered.y = y;
      hovering = true;
      moved = true;
      wake();
    };

    const onDown = (event: PointerEvent) => {
      // A finger lands somewhere new, so its first move must not join on to the last.
      if (event.pointerType === "touch") hovering = false;
      ripples.push({
        ...pointOn(canvas, event),
        size:
          knob(canvas, "--backdrop-ripple-size", Number.parseFloat) ??
          DEFAULT_RIPPLE_SIZE,
        ms:
          knob(canvas, "--backdrop-ripple-speed", duration) ??
          DEFAULT_RIPPLE_MS,
      });
      if (ripples.length > MAX_RIPPLES) ripples.shift();
      wake();
    };

    const onLift = (event: PointerEvent) => {
      if (event.pointerType === "touch") hovering = false;
    };

    const onLeave = () => {
      hovering = false;
    };

    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onLift);
    canvas.addEventListener("pointercancel", onLift);
    canvas.addEventListener("pointerleave", onLeave);
    wake();

    return () => {
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onLift);
      canvas.removeEventListener("pointercancel", onLift);
      canvas.removeEventListener("pointerleave", onLeave);
      cancelAnimationFrame(frame ?? 0);
    };
  },
};
