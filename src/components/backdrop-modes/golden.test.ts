import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { installBackdropDefaults } from "../../test/backdrop-defaults";
import { mount, play } from "../../test/backdrop-play";
import {
  installSoftCanvas,
  type SoftBitmap,
  useFakeFrames,
  SLOW_TEST_MS,
} from "../../test/toy-canvas";
import { mulberry32 } from "../backdrop-noise";
import "../pixel-backdrop";
import { MODES } from ".";

/**
 * Golden digests of every pixel each toy puts on screen under each look, to
 * catch a refactor that changes what is shown. They sample the screen at fixed
 * simulated times, never the canvas calls that drew it, so a new way of
 * drawing the same pixels keeps them. After an intended change to what is
 * shown, update them with `vitest run -u` and review the entries that moved.
 */

vi.setConfig({ testTimeout: SLOW_TEST_MS });

const LOOKS = [
  { name: "Site in light", display: "site", scheme: "light" },
  { name: "Site in dark", display: "site", scheme: "dark" },
  { name: "Pocket LCD", display: "pocket-lcd", scheme: "light" },
  { name: "Amber LCD", display: "amber-lcd", scheme: "light" },
];

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

for (const { id } of MODES) {
  for (const { name, display, scheme } of LOOKS) {
    test(`${id} on ${name}`, async () => {
      // As the theme toggle sets it; the stubbed OS scheme is light.
      document.documentElement.style.colorScheme = scheme;
      mount(id, {}, display);
      const recording = recorder();
      await play(recording.advance);
      await recording.advance(SETTLE_MS);

      expect(recording.result()).toMatchSnapshot();
    });
  }
}
