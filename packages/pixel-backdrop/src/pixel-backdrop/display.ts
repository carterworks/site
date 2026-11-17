/**
 * A physical panel's effects: quantised levels, a grid, a ghost that rises and
 * falls at its own speeds. Without one, a display is a plain palette with the
 * drifting noise. Colours are hex only: any other form makes the palette pass
 * parse it through a helper canvas.
 */
export type DisplayLook = {
  /**
   * Paints the gaps instead of the screen. A translucent one lets each
   * pixel show through, so dark neighbours merge and the grid stays faint.
   */
  grid?: string;
  /**
   * A backlight fading toward the corners: the screen multiplied by white out
   * to `clear` percent of the way to the farthest corner, then by a colour
   * falling to `edge` there.
   */
  vignette?: { clear: number; edge: string };
  /** Colours spaced evenly between the base and the ink, which the scale runs through. */
  stops?: string[];
  levels: number;
  /** Mixes neighbouring levels in an ordered pattern, so shades between them still show. */
  dither?: boolean;
  gap: number;
  ghostRise: number;
  ghostFall: number;
  shadow?: { opacity: number; x: number; y: number };
};

/** The screen `<pixel-backdrop>` shows its toys on. */
export type BackdropDisplay = {
  /** The canvas's unlit pixels, and the screen behind it on a panel. */
  base: string;
  /** The canvas's fully lit pixels, across every toy and the noise. */
  ink: string;
  look?: DisplayLook;
};
