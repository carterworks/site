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

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const fold = (hash: number, word: number) =>
  Math.imul(hash ^ word, FNV_PRIME) >>> 0;

function hashScreen() {
  let hash = FNV_OFFSET;
  for (const { pixels, width, height } of screen()) {
    hash = fold(fold(hash, width), height);
    const words = new Uint32Array(
      pixels.buffer,
      pixels.byteOffset,
      width * height,
    );
    for (let at = 0; at < words.length; at += 1) hash = fold(hash, words[at]);
  }
  return hash;
}

/** Folds the screen after every frame step into one digest, counting the steps that changed it. */
function recorder() {
  let digest = FNV_OFFSET;
  let shown = hashScreen();
  let changes = 0;
  return {
    async advance(ms: number) {
      for (let left = ms; left > 0; left -= FRAME_MS) {
        await vi.advanceTimersByTimeAsync(Math.min(FRAME_MS, left));
        const frame = hashScreen();
        if (frame !== shown) changes += 1;
        shown = frame;
        digest = fold(digest, frame);
      }
    },
    result: () =>
      `${fold(digest, changes).toString(16).padStart(8, "0")} over ${changes} changed frames`,
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
