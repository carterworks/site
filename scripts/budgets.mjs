/**
 * The limits `pnpm budgets` holds the built site to; `scripts/budget-check.mjs`
 * measures them and fails when any is exceeded. Every limit is a ratchet:
 * today's value plus the margin stated beside it. A change that makes
 * something cheaper lowers its limit to the new value plus the same margin; a
 * limit is raised only on purpose, with the reason in that commit.
 */
export default {
  /**
   * Brotli bytes (quality 11) of every script a fresh load of the page
   * fetches, imports included, each compressed on its own as it is served.
   * Brotli because every browser that runs the site accepts it, so it is what
   * a visitor downloads. Exact: a build always compresses to the same bytes.
   * Not covered: inline scripts, which count as the document's, and anything
   * fetched after the page settles. /play loads the same but for its toolbar,
   * so only the homepage is held. Margin: 2%.
   */
  javascript: { "/": 34_200 },

  /** Bytes of the font the homepage preloads. Margin: 0.7%. */
  font: { "/InterVariable-latin.woff2": 102_000 },

  /**
   * Per frame of hover-only play on the homepage, the worst toy on the worst
   * display: layouts and style recalculations. Exact, and zero: drawing a
   * frame writes nothing the page must restyle. Not covered: the frames that
   * switch toy or display.
   */
  hover: { layouts: 0, styleRecalcs: 0 },

  /**
   * Per press and release on the homepage, the worst toy on the worst
   * display. Exact: the press sets an attribute on `<html>` and the release
   * removes it, a style recalculation each, and neither lays out.
   */
  press: { layouts: 0, styleRecalcs: 2 },

  /**
   * Live DOM nodes and JavaScript event listeners gained on /play, after
   * garbage collection, from before to after switching to every toy and every
   * display and back. Exact once warmed up. Not covered: memory held by other
   * means, such as an array that grows.
   */
  leaks: { nodes: 0, listeners: 0 },

  /**
   * The most render passes the compositor draws in one frame of hover-only
   * play on the homepage, in software, the worst toy per display. Each pass
   * past the first is another full-viewport surface composited every frame:
   * the LCD displays' blended layers draw two. Exact for the pinned
   * Chromium. Not covered: what each pass costs, which the compositor's
   * frame cost measures.
   */
  renderPasses: { Site: 1, "Pocket LCD": 3, "Amber LCD": 3 },

  /**
   * CPU a frame of hover-only play costs on the homepage, as a multiple of
   * what `scripts/budget-reference.html` costs in the same rounds, so a slower
   * or busier machine scales both:
   *   mainThread   the page's main thread: the toy, the display's per-pixel
   *                passes, and everything else in script, style and paint
   *   compositor   every other thread of the renderer and GPU processes:
   *                raster and compositing, all in software
   * The main thread is held on the three toys that cost it most, on Site,
   * where every toy costs it most, and on each LCD display, whose palette
   * pass runs only there. The compositor is held once per display, with a
   * toy that draws every frame. Not covered: the other toys and pairings,
   * frame rate, and cost with a GPU.
   *
   * Margin: 15% over the highest of 5 runs, 3 idle and 2 with eight cores
   * busy and a build looping, on an i7-8700K. A slower CPU, or one of another
   * design, can shift a ratio, so the first runs on a new kind of machine
   * reset these from its log.
   */
  frameCost: {
    mainThread: {
      "pond on Site": 2.6,
      "filings on Site": 2.45,
      "curtain on Site": 2.45,
      "pond on Pocket LCD": 2.17,
      "pond on Amber LCD": 2.02,
    },
    compositor: {
      "pond on Site": 1.35,
      "pond on Pocket LCD": 6.1,
      "pond on Amber LCD": 6.17,
    },
  },
};
