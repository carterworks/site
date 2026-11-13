import { hexRgb, type Rgb } from "../../lib/rgb";

let rgbContext: CanvasRenderingContext2D | null | undefined;

/** Resolve any CSS colour to `[r, g, b]`. */
export function colourRgb(value: string): Rgb {
  const hex = hexRgb(value);
  if (hex !== undefined) return hex;
  if (rgbContext === undefined) {
    rgbContext = document
      .createElement("canvas")
      .getContext("2d", { willReadFrequently: true });
  }
  if (rgbContext === null) return [0, 0, 0];
  rgbContext.clearRect(0, 0, 1, 1);
  rgbContext.fillStyle = value;
  rgbContext.fillRect(0, 0, 1, 1);
  const [r, g, b] = rgbContext.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}
