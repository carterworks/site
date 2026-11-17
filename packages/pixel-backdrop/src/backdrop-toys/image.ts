import { clamp } from "../lib/clamp";
import { visibleCells, type Toy } from "./toy";

/** The share of pixels at each end of the luma that the stretch clips. */
const CLIP = 0.01;

/**
 * A picture the visitor chose, for the playground. The caller owns the
 * bitmap, so stopping never closes it: the same toy can start again.
 */
export function imageToy(source: ImageBitmap): Toy {
  return {
    id: "image",
    label: "Image",
    picture: true,
    look: { ghost: 0, noise: 0 },
    start(canvas) {
      const context = canvas.getContext("2d");
      const draw = () => {
        if (context === null) return;
        const { left, top, right, bottom } = visibleCells(canvas);
        const scale = Math.min(
          (right - left) / source.width,
          (bottom - top) / source.height,
        );
        const width = Math.round(source.width * scale);
        const height = Math.round(source.height * scale);
        const x = Math.round(left + (right - left - width) / 2);
        const y = Math.round(top + (bottom - top - height) / 2);
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.imageSmoothingQuality = "high";
        context.drawImage(source, x, y, width, height);
        if (width === 0 || height === 0) return;
        const image = context.getImageData(x, y, width, height);
        clarify(image);
        context.putImageData(image, x, y);
      };
      draw();
      const listening = new AbortController();
      window.addEventListener("resize", draw, { signal: listening.signal });
      return () => listening.abort();
    },
  };
}

/**
 * Readies a photo for a grid of a hundred or so pixels: sharpens each against
 * its 3 x 3 neighbourhood, so features a pixel or two wide still read, then
 * stretches the luma over every shade. A photo's tones crowd the middle, which
 * a palette of few levels would round to one or two.
 */
function clarify({ data, width, height }: ImageData) {
  const source = data.slice();
  const at = (x: number, y: number) =>
    (clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1)) * 4;
  const counts = new Uint32Array(256);
  let opaque = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            sum += source[at(x + dx, y + dy) + channel];
          }
        }
        data[i + channel] = 2 * source[i + channel] - sum / 9;
      }
      if (data[i + 3] === 0) continue;
      opaque += 1;
      counts[
        Math.round(
          data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722,
        )
      ] += 1;
    }
  }
  const lumaAt = (share: number) => {
    let seen = 0;
    for (let level = 0; level < 255; level += 1) {
      seen += counts[level];
      if (seen > share * opaque) return level;
    }
    return 255;
  };
  const low = lumaAt(CLIP);
  const gain = 255 / Math.max(1, lumaAt(1 - CLIP) - low);
  for (let i = 0; i < data.length; i += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      data[i + channel] = (data[i + channel] - low) * gain;
    }
  }
}
