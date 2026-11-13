/**
 * The limits `pnpm budgets` holds the built site to; `scripts/budget-check.mjs`
 * measures them and fails when any is exceeded. Every value is a count, exact
 * for the pinned Chromium, so each limit is today's value with no margin
 * unless one is stated. A change that does less lowers its limit to the new
 * value in the same commit; a limit is raised only on purpose, with the
 * reason in that commit. A Playwright upgrade can move the compositor counts;
 * reset them from its first run's log, in the upgrade's own commit.
 */
export default {
  /**
   * Brotli bytes of every script a fresh load of the page fetches, imports
   * included, each compressed on its own at quality 11, window 22. A stable
   * proxy for what is sent: the CDN picks its own compression. Not covered:
   * inline scripts, which count as the document's, and anything fetched after
   * the page settles; /play loads the same but for its toolbar. Margin: 2%,
   * about 700 bytes, under the 1.2 KB a toy averages, so a new toy, which
   * every page loads, misses it on purpose: raise the limit by what the run
   * measured over it, in the toy's commit.
   */
  javascript: { "/": 34_200 },

  /** Bytes of the font the homepage preloads. Margin: 0.7%. */
  font: { "/InterVariable-latin.woff2": 102_000 },

  /**
   * Live DOM nodes and event listeners gained, after garbage collection, by a
   * second run of each tour: every toy and display on /play, and client-side
   * navigation from the homepage to the blog, a post, back, and home, which
   * swaps the page around the backdrop that persists across it.
   */
  leaks: { nodes: 0, listeners: 0 },

  /**
   * On the homepage, the worst toy on the worst display: layouts and style
   * recalculations in 30 frames of hover-only play, which writes nothing the
   * page must restyle, and in one press and release, which set and remove an
   * attribute on `<html>`, a style recalculation each.
   */
  play: {
    hoverLayouts: 0,
    hoverStyleRecalcs: 0,
    pressLayouts: 0,
    pressStyleRecalcs: 2,
  },

  /**
   * What one frame of hover-only play on the homepage asks for, the worst
   * frame of the worst toy, per display. Work a slow phone must do 60 times a
   * second, so each is a ratchet: lower it when a change does less.
   *   canvasPixelsWritten  area of every putImageData and drawImage, on any
   *                        2D canvas: the toy's frame, the display's present
   *                        and the LCDs' shadow copy
   *   canvasPixelsRead     area of every getImageData, a read-back that can
   *                        stall a GPU canvas
   *   canvasCalls          those calls
   *   renderPasses         surfaces the compositor draws, the screen included
   *   offscreenPixels      pixels of those surfaces other than the screen,
   *                        each drawn and then composited again
   *   blendedPixels        pixels composited with a blend mode other than
   *                        plain alpha, such as the multiplied shadow and
   *                        vignette, the costliest compositing in software
   */
  perFrame: {
    canvasPixelsWritten: {
      Site: 51_200,
      "Pocket LCD": 76_800,
      "Amber LCD": 51_200,
    },
    canvasPixelsRead: { Site: 0, "Pocket LCD": 0, "Amber LCD": 0 },
    canvasCalls: { Site: 2, "Pocket LCD": 3, "Amber LCD": 2 },
    renderPasses: { Site: 1, "Pocket LCD": 3, "Amber LCD": 3 },
    offscreenPixels: {
      Site: 0,
      "Pocket LCD": 2_042_400,
      "Amber LCD": 2_048_000,
    },
    blendedPixels: { Site: 0, "Pocket LCD": 1_020_000, "Amber LCD": 1_024_000 },
  },
};
