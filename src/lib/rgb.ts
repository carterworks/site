export type Rgb = [number, number, number];

/**
 * Writes into `colour` the paint, and returns the alpha, that composited over
 * `base` as ordinary paint gives what multiplying it by `factor` (0–1 per
 * channel) gives, so a layer can darken without a blend mode. Paint has one
 * alpha for all three channels, so over any other colour a channel is off by
 * `(factor − min factor)·(base − colour under)`: exact in the channel darkened
 * most. `colour` is the caller's, so painting per pixel allocates nothing.
 */
export function multiplyOverlay(
  base: Readonly<Rgb>,
  factor: Readonly<Rgb>,
  colour: Rgb,
): number {
  const strongest = Math.min(factor[0], factor[1], factor[2]);
  const alpha = 1 - strongest;
  for (let c = 0; c < 3; c += 1) {
    colour[c] = alpha === 0 ? 0 : (base[c] * (factor[c] - strongest)) / alpha;
  }
  return alpha;
}

/** `#rgb` or `#rrggbb` as `[r, g, b]`, or undefined for any other form. */
export function hexRgb(value: string): Rgb | undefined {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (hex === null) return undefined;
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
