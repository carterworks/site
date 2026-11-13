type Rgb = [number, number, number];

let rgbContext: CanvasRenderingContext2D | null | undefined;

/** Resolve any CSS colour to `[r, g, b]`. */
export function colourRgb(value: string): Rgb {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (hex !== null) {
    const digits =
      hex[1].length === 3
        ? hex[1].replace(/./g, (digit) => digit + digit)
        : hex[1];
    return [
      Number.parseInt(digits.slice(0, 2), 16),
      Number.parseInt(digits.slice(2, 4), 16),
      Number.parseInt(digits.slice(4, 6), 16),
    ];
  }
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
