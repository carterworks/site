import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  installSoftCanvas,
  place,
  pointerAt,
  type SoftBitmap,
  useFakeFrames,
  SLOW_TEST_MS,
} from "../../test/toy-canvas";
import { cradle, cradleLayout } from "./cradle";

vi.setConfig({ testTimeout: SLOW_TEST_MS });

const SIZE = 160;
/** A 16:9 viewport across the canvas's middle, which the cradle fits to. */
const view = new DOMRect(0, 35, 160, 90);
const visible = { left: 0, top: 35, right: 160, bottom: 125 };
const layout = cradleLayout(visible);
const STEP = 1000 / 60;
const SWUNG = 0.6;

let canvas: HTMLCanvasElement;
let bitmap: () => SoftBitmap;
let stop: () => void;

beforeEach(async () => {
  useFakeFrames();
  vi.spyOn(HTMLDivElement.prototype, "getBoundingClientRect").mockReturnValue(
    view,
  );
  const { plain } = installSoftCanvas();
  canvas = document.createElement("canvas");
  Object.assign(canvas, { width: SIZE, height: SIZE });
  canvas.dataset.fit = "viewport";
  place(canvas, new DOMRect(0, 0, SIZE, SIZE));
  document.body.append(canvas);
  stop = cradle.start(canvas);
  bitmap = () => plain[0];
  await hangStraight();
});

/** Catches the end ball the cradle arrives swinging and hangs it straight, so a test starts from rest with the pointer away. */
async function hangStraight() {
  pointerAt(canvas, "pointerdown", ...at(0, -SWUNG), { buttons: 1 });
  pointerAt(canvas, "pointermove", ...at(0, 0), { buttons: 1 });
  pointerAt(canvas, "pointerup", ...at(0, 0));
  canvas.dispatchEvent(new PointerEvent("pointerleave"));
  await frames(1);
}

afterEach(() => {
  stop();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const frames = (count: number) => vi.advanceTimersByTimeAsync(count * STEP);

const pivotX = (ball: number) =>
  layout.centerX + (ball - 2) * 2 * layout.radius;

/** Where ball `ball`'s centre hangs at `angle` from straight down, rightward positive. */
const at = (ball: number, angle: number) =>
  [
    pivotX(ball) + layout.length * Math.sin(angle),
    layout.pivotY + layout.length * Math.cos(angle),
  ] as const;

const alphaAt = (x: number, y: number) =>
  bitmap().pixels[(Math.floor(y) * SIZE + Math.floor(x)) * 4 + 3];

const covered = (ball: number, angle: number) =>
  alphaAt(...at(ball, angle)) > 120;

/** Each ball, "o" while its resting place is covered, "<" or ">" while it is swung well out, else ".". */
const rests = () =>
  [0, 1, 2, 3, 4]
    .map((ball) => {
      if (covered(ball, 0)) return "o";
      if (covered(ball, SWUNG)) return ">";
      if (covered(ball, -SWUNG)) return "<";
      return ".";
    })
    .join("");

/** Presses ball `ball` where it hangs, draws it out to `angle` and lets go. */
async function pull(ball: number, angle: number) {
  pointerAt(canvas, "pointerdown", ...at(ball, 0), { buttons: 1 });
  for (let step = 1; step <= 10; step += 1) {
    pointerAt(canvas, "pointermove", ...at(ball, (angle * step) / 10), {
      buttons: 1,
    });
    await frames(1);
  }
  pointerAt(canvas, "pointerup", ...at(ball, angle));
}

/** Every pattern of `rests` shown over the next `count` frames. */
async function watch(count: number) {
  const seen = new Set<string>();
  for (let frame = 0; frame < count; frame += 1) {
    await frames(1);
    seen.add(rests());
  }
  return seen;
}

test("it arrives with the end ball drawn out and let go, which knocks the far ball out", async () => {
  stop();
  stop = cradle.start(canvas);
  await frames(1);
  expect(rests()).toBe("<oooo");

  expect(await watch(60)).toContain("oooo.");
});

test("hanging straight it draws five touching balls, then stops asking for frames", async () => {
  await frames(1);

  expect(rests()).toBe("ooooo");
  expect(vi.getTimerCount()).toBe(0);
});

test("a ball let go barely off straight still comes to rest", async () => {
  pointerAt(canvas, "pointerdown", ...at(0, 0), { buttons: 1 });
  pointerAt(canvas, "pointermove", ...at(0, -0.5), { buttons: 1 });
  pointerAt(canvas, "pointermove", ...at(0, -0.0045), { buttons: 1 });
  pointerAt(canvas, "pointerup", ...at(0, -0.0045));
  await frames(60);

  expect(vi.getTimerCount()).toBe(0);
});

test("draws inside the visible part, centred across it", async () => {
  await frames(1);
  const { pixels } = bitmap();
  let left = SIZE;
  let right = -1;
  for (let i = 0; i < SIZE * SIZE; i += 1) {
    if (pixels[i * 4 + 3] === 0) continue;
    const x = i % SIZE;
    const y = Math.floor(i / SIZE);
    expect(y).toBeGreaterThanOrEqual(visible.top);
    expect(y).toBeLessThan(visible.bottom);
    left = Math.min(left, x);
    right = Math.max(right, x);
  }

  expect(Math.abs(left + right + 1 - SIZE)).toBeLessThanOrEqual(1);
});

test("a ball held out stays out until it is let go", async () => {
  pointerAt(canvas, "pointerdown", ...at(0, 0), { buttons: 1 });
  pointerAt(canvas, "pointermove", ...at(0, -SWUNG), { buttons: 1 });
  await frames(60);

  expect(rests()).toBe("<oooo");
});

test("a ball let go swings in and knocks the far ball out", async () => {
  await pull(0, -1);
  const seen = await watch(60);

  expect(seen).toContain("oooo>");
});

test("grabbing the second ball lifts the first with it, and two swing out the far side", async () => {
  pointerAt(canvas, "pointerdown", ...at(1, 0), { buttons: 1 });
  pointerAt(canvas, "pointermove", ...at(1, -SWUNG), { buttons: 1 });
  await frames(1);
  expect(rests()).toBe("<<ooo");

  pointerAt(canvas, "pointermove", ...at(1, -1), { buttons: 1 });
  pointerAt(canvas, "pointerup", ...at(1, -1));
  const seen = await watch(60);

  expect(seen).toContain("ooo>>");
});

test("pulling the middle ball right lifts the two beyond it too", async () => {
  pointerAt(canvas, "pointerdown", ...at(2, 0), { buttons: 1 });
  pointerAt(canvas, "pointermove", ...at(2, SWUNG), { buttons: 1 });
  await frames(1);

  expect(rests()).toBe("oo>>>");
});

test("a hovering pointer swept through the end ball brushes it out, and it settles", async () => {
  const [x, y] = at(4, 0);
  for (let step = -2; step <= 6; step += 1) {
    pointerAt(canvas, "pointermove", x + step * 2, y);
    await frames(1);
  }
  const seen = await watch(20);

  expect(seen).toContain("oooo.");
  expect(seen).not.toContain(".oooo");
  await vi.advanceTimersByTimeAsync(30_000);
  expect(vi.getTimerCount()).toBe(0);
});

test("a pointer resting on a ball leaves it hanging", async () => {
  await frames(1);
  const before = bitmap().pixels.slice();
  pointerAt(canvas, "pointermove", ...at(2, 0));
  pointerAt(canvas, "pointermove", ...at(2, 0));
  await frames(10);

  expect(bitmap().pixels).toEqual(before);
});

test("a tap nudges the nearer outer ball", async () => {
  pointerAt(canvas, "pointerdown", 10, 60, { buttons: 1 });
  pointerAt(canvas, "pointerup", 10, 60);
  const left = await watch(20);
  expect(left).toContain(".oooo");
  expect(left).not.toContain("oooo.");

  await frames(60 * 30);
  pointerAt(canvas, "pointerdown", 150, 60, { buttons: 1 });
  pointerAt(canvas, "pointerup", 150, 60);
  const right = await watch(20);
  expect(right).toContain("oooo.");
  expect(right).not.toContain(".oooo");
});

test("a press that misses the balls and drags moves nothing", async () => {
  await frames(1);
  const before = bitmap().pixels.slice();
  pointerAt(canvas, "pointerdown", 10, 120, { buttons: 1 });
  pointerAt(canvas, "pointermove", 40, 120, { buttons: 1 });
  pointerAt(canvas, "pointerup", 40, 120);
  await frames(10);

  expect(bitmap().pixels).toEqual(before);
});

test.each([
  ["one ball", 0, -1.2],
  ["the whole row", 0, 1.2],
])(
  "%s pulled as far as it goes comes fully to rest within 30 s, and the loop stops",
  async (_, ball, angle) => {
    await frames(1);
    const resting = bitmap().pixels.slice();
    await pull(ball, angle);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(vi.getTimerCount()).toBe(0);
    expect(bitmap().pixels).toEqual(resting);
  },
);
