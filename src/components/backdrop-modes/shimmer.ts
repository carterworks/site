import { clamp } from "../emulated-canvas-limits";
import { line } from "./line";
import { GRID_SIZE, type Mode, type Point } from "./mode";

const MAX_RIPPLES = 24;

// rippleSize is authored in cells of the 80-cell grid the look was tuned on.
const RIPPLE_SIZE_SCALE = GRID_SIZE / 80;

/**
 * The original backdrop: moving the pointer smears a segment from the cell it
 * left to the one it entered, and each press drops an expanding ring. The
 * segment is drawn only on the frame after a move, so the canvas's ghost pass
 * alone fades it into a trail.
 */
export const shimmer: Mode = {
  id: "shimmer",
  label: "Shimmer",
  create({ columns, rows, options }) {
    const ripples: { x: number; y: number; born: number }[] = [];
    let seenPointer: Point | undefined;
    let seenPress: object | undefined;
    let hovered: Point | undefined;
    let from: Point = { x: 0, y: 0 };
    let moved = false;
    let now = 0;

    const cellOf = ({ x, y }: Point) => ({
      x: clamp(Math.floor(x), 0, columns - 1),
      y: clamp(Math.floor(y), 0, rows - 1),
    });

    // Two cells thick keeps the segment as heavy on screen as one cell was at 80.
    let target: Float32Array = new Float32Array(0);
    const stamp = (x: number, y: number) => {
      const right = Math.min(x + 1, columns - 1);
      const bottom = Math.min(y + 1, rows - 1);
      for (let row = y; row <= bottom; row += 1)
        for (let column = x; column <= right; column += 1)
          target[row * columns + column] = 1;
    };

    return {
      step({ pointer, press }, time) {
        now = time;
        if (pointer === undefined) {
          hovered = undefined;
          moved = false;
        } else if (
          pointer.x !== seenPointer?.x ||
          pointer.y !== seenPointer?.y
        ) {
          const cell = cellOf(pointer);
          if (hovered === undefined) from = cell;
          else if (cell.x !== hovered.x || cell.y !== hovered.y) from = hovered;
          hovered = cell;
          moved = true;
        }
        seenPointer = pointer;

        if (press !== undefined && press !== seenPress) {
          seenPress = press;
          ripples.push({ x: press.x, y: press.y, born: press.at });
          if (ripples.length > MAX_RIPPLES) ripples.shift();
        }
        for (let i = ripples.length - 1; i >= 0; i -= 1) {
          if (now - ripples[i].born >= options.rippleSpeed)
            ripples.splice(i, 1);
        }
      },

      render(field) {
        target = field;
        if (moved && hovered !== undefined) {
          line(from, hovered, stamp);
          moved = false;
        }

        for (const ripple of ripples) {
          const progress = (now - ripple.born) / options.rippleSpeed;
          const radius = progress * options.rippleSize * RIPPLE_SIZE_SCALE;
          const strength = 1 - progress;
          const reach = Math.ceil(radius + 1);
          const top = Math.max(0, Math.floor(ripple.y) - reach);
          const bottom = Math.min(rows - 1, Math.floor(ripple.y) + reach);
          const left = Math.max(0, Math.floor(ripple.x) - reach);
          const right = Math.min(columns - 1, Math.floor(ripple.x) + reach);
          for (let y = top; y <= bottom; y += 1) {
            for (let x = left; x <= right; x += 1) {
              const distance = Math.hypot(
                x + 0.5 - ripple.x,
                y + 0.5 - ripple.y,
              );
              // A one-cell stroke covers a cell by how near its centre is to the ring.
              const cover = 1 - Math.abs(distance - radius);
              const i = y * columns + x;
              if (cover > 0) field[i] = Math.max(field[i], cover * strength);
            }
          }
        }
      },

      pace: () => (moved || ripples.length > 0 ? "active" : "still"),
    };
  },
};
