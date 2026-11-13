/** The frame rate over the slowest hundredth of `gaps`, the ms between frames. */
export function onePercentLow(gaps: number[]) {
  const slowest = gaps
    .toSorted((a, b) => b - a)
    .slice(0, Math.ceil(gaps.length / 100));
  return (slowest.length * 1000) / slowest.reduce((sum, ms) => sum + ms, 0);
}
