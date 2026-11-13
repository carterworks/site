import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { installBackdropDefaults } from "../../test/backdrop-defaults";
import { mountWithShadow, play } from "../../test/backdrop-play";
import {
  installSoftCanvas,
  type SoftBitmap,
  useFakeFrames,
  SLOW_TEST_MS,
} from "../../test/toy-canvas";
import { mulberry32 } from "../../lib/backdrop-noise";
import { DISPLAYS } from "../backdrop-displays";
import "../pixel-backdrop/element";
import { TOYS } from ".";

/**
 * Golden snapshots of what each toy shows under each look, to catch a refactor
 * that changes it. Two entries per toy and look:
 *
 * - A SHA-256 digest of the display and its shadow's echo canvas, sampled at
 *   every simulated frame, never the canvas calls that drew them, so a new way
 *   of drawing the same pixels keeps it. A fully transparent pixel counts as
 *   black, whatever RGB it keeps. Pixels are drawn by the software canvas in
 *   `toy-canvas`, which composites as the spec says but is not a browser.
 * - `markup`: what carries the rest of the look to CSS once play settles, the
 *   canvas's and backdrop's `data-*` attributes and inline styles and the
 *   stylesheet in the canvas's shadow root, as readable text.
 *
 * Not pinned: how a browser paints that CSS (cell scaling, `image-rendering`,
 * the gap overlay, the echo's offset, the vignette), and
 * page styles such as PixelBackdrop.astro's, which turn the backdrop's
 * properties into the screen colour, gap colour and vignette. Every look
 * recolours, so a frame presented without a pass, by `drawImage`, never runs
 * here; the element's and presenter's tests cover it.
 * After an intended change, update with `vitest run -u` and review the entries
 * that moved.
 */

vi.setConfig({ testTimeout: SLOW_TEST_MS });

/** Every display; one with a screen of its own looks the same in either scheme. */
const LOOKS = DISPLAYS.flatMap(({ id, label, look }) =>
  look
    ? [{ name: label, display: id, scheme: "light" }]
    : ["light", "dark"].map((scheme) => ({
        name: `${label} in ${scheme}`,
        display: id,
        scheme,
      })),
);

/** One frame at 60 Hz, the step the screen is sampled at. */
const FRAME_MS = 16;
/** Enough for the ghost to fade after input; shorter than the contract's 30 s, to keep the file quick. */
const SETTLE_MS = 5000;

let bitmaps: ReturnType<typeof installSoftCanvas>;

beforeEach(() => {
  useFakeFrames();
  bitmaps = installSoftCanvas();
  vi.spyOn(Math, "random").mockImplementation(mulberry32(1));
  vi.stubGlobal("innerWidth", 1024);
  vi.stubGlobal("innerHeight", 768);
  // The probe `visibleCells` measures; happy-dom has no layout to size it.
  vi.spyOn(HTMLDivElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, innerWidth, innerHeight),
  );
  installBackdropDefaults();
});

afterEach(() => {
  document.body.replaceChildren();
  document.head.replaceChildren();
  document.documentElement.removeAttribute("style");
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * The canvases on screen, display first, then the echo a pixel shadow casts
 * over it. The only place that knows how the emulated canvas lays them out.
 */
function screen(): SoftBitmap[] {
  const shown = bitmaps.plain.filter(
    (bitmap) => bitmap.getContext().canvas?.isConnected,
  );
  const isEcho = (bitmap: SoftBitmap) =>
    bitmap.getContext().canvas!.classList.contains("echo");
  return [...shown.filter((b) => !isEcho(b)), ...shown.filter(isEcho)];
}

/** A fully transparent pixel shows nothing, whatever RGB it keeps. */
function visible(pixels: Uint8ClampedArray) {
  const shown = pixels.slice();
  for (let at = 0; at < shown.length; at += 4) {
    if (shown[at + 3] === 0) shown.fill(0, at, at + 3);
  }
  return shown;
}

function hashScreen() {
  const hash = createHash("sha256");
  for (const { pixels, width, height } of screen()) {
    hash.update(`${width}x${height}`).update(visible(pixels));
  }
  return hash.digest("hex");
}

/** Hashes the screen after every frame step into one digest, counting the steps that changed it. */
function recorder() {
  const digest = createHash("sha256");
  let shown = hashScreen();
  let changes = 0;
  return {
    async advance(ms: number) {
      for (let left = ms; left > 0; left -= FRAME_MS) {
        await vi.advanceTimersByTimeAsync(Math.min(FRAME_MS, left));
        const frame = hashScreen();
        if (frame !== shown) changes += 1;
        shown = frame;
        digest.update(frame);
      }
    },
    result: () => `${digest.digest("hex")} over ${changes} changed frames`,
  };
}

/** Read from the attributes, as spreading happy-dom's `dataset` missed `data-vignette`, set by `toggleAttribute`. */
const data = (element: Element) =>
  Object.fromEntries(
    Array.from(element.attributes)
      .filter(({ name }) => name.startsWith("data-"))
      .map(({ name, value }) => [name, value]),
  );

const declarations = (style: CSSStyleDeclaration) =>
  Object.fromEntries(
    Array.from(style, (name) => [name, style.getPropertyValue(name)]),
  );

/** How the look reaches the screen through markup and CSS, which the pixels never show. */
function markup(canvas: HTMLElement, shadow: ShadowRoot) {
  const backdrop = canvas.parentElement!;
  return {
    canvasData: data(canvas),
    canvasStyle: declarations(canvas.style),
    backdropData: data(backdrop),
    backdropStyle: declarations(backdrop.style),
    stylesheet: Array.from(shadow.querySelectorAll("style"), (style) =>
      style.textContent.split("\n").map((line) => line.trim()),
    )
      .flat()
      .filter(Boolean),
  };
}

for (const { id } of TOYS) {
  for (const { name, display, scheme } of LOOKS) {
    test(`${id} on ${name}`, async () => {
      // As the theme toggle sets it; the stubbed OS scheme is light.
      document.documentElement.style.colorScheme = scheme;
      const { canvas, shadow } = mountWithShadow(id, {}, display);
      const recording = recorder();
      await play(recording.advance);
      await recording.advance(SETTLE_MS);

      // Soft, so a change that moves both entries shows both diffs at once.
      expect.soft(recording.result()).toMatchSnapshot();
      expect.soft(markup(canvas, shadow)).toMatchSnapshot("markup");
    });
  }
}
