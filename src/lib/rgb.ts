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
