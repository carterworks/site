import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  installSoftCanvas,
  place,
  pointerAt,
  type SoftBitmap,
  useFakeFrames,
} from "../../test/toy-canvas";
import { mote } from "./mote";

const STEP = 1000 / 60;
/** Lit cells of the standing sprite once its two eyes are cut out. */
const STAND_PIXELS = 38;
const GRID = 160;
/** On-screen pixels per canvas cell in these tests. */
const CELL_PX = 8;

const VISIBLE = { top: 35, bottom: 125 };
/** `floor(visible.bottom)` minus the seven-cell inset. */
const GROUND = 118;
const SLEEPING_TOP = GROUND - 4;
const STANDING_TOP = GROUND - 7;

const FULL = 255;
const CRUMB = Math.round(0.85 * 255);
const GRASS = Math.round(0.35 * 255);
const HEART_MAX = Math.round(0.65 * 255);

let stop: (() => void) | undefined;
let probe: DOMRect;

beforeEach(() => {
  useFakeFrames();
  const measure = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this instanceof HTMLDivElement ? probe : measure.call(this);
    },
  );
});

afterEach(() => {
  stop?.();
  stop = undefined;
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function view(top: number, bottom: number, size: number) {
  probe = new DOMRect(
    0,
    top * CELL_PX,
    size * CELL_PX,
    (bottom - top) * CELL_PX,
  );
}

function setup({ top, bottom } = VISIBLE, size = GRID) {
  const { plain } = installSoftCanvas();
  const canvas = document.createElement("canvas");
  Object.assign(canvas, { width: size, height: size });
  canvas.dataset.fit = "viewport";
  place(canvas, new DOMRect(0, 0, size * CELL_PX, size * CELL_PX));
  view(top, bottom, size);
  document.body.append(canvas);
  stop = mote.start(canvas);
  const bitmap = (): SoftBitmap => plain[0];

  const run = async (steps: number) => {
    await vi.advanceTimersByTimeAsync(steps * STEP);
    return vi.getTimerCount() === 0 ? "still" : "active";
  };
  const tap = (x: number, y: number) => pointerAt(canvas, "pointerdown", x, y);
  const hover = (x: number, y: number) =>
    pointerAt(canvas, "pointermove", x, y);
  const cells = (keep: (alpha: number, y: number) => boolean) => {
    const { pixels, width } = bitmap();
    const found: { x: number; y: number }[] = [];
    for (let i = 3; i < pixels.length; i += 4) {
      const cell = (i - 3) / 4;
      const y = Math.floor(cell / width);
      if (pixels[i] > 0 && keep(pixels[i], y)) {
        found.push({ x: cell % width, y });
      }
    }
    return found;
  };
  /** The body is the only thing drawn at full intensity. */
  const body = () => cells((alpha) => alpha === FULL);
  const bodyTop = () => Math.min(...body().map(({ y }) => y));
  const bodyX = () => {
    const xs = body().map(({ x }) => x + 0.5);
    return xs.reduce((sum, x) => sum + x) / xs.length;
  };
  const crumbs = () => cells((alpha) => alpha === CRUMB).length;
  const hearts = () =>
    cells((alpha, y) => alpha <= HEART_MAX && y < bodyTop() - 1).length;
  const wake = async () => {
    tap(bodyX(), GROUND - 2);
    await run(150);
  };
  return {
    run,
    tap,
    hover,
    wake,
    canvas,
    resize(top: number, bottom: number) {
      view(top, bottom, size);
      window.dispatchEvent(new Event("resize"));
    },
    bodyTop,
    bodyX,
    bodyCells: () => body().length,
    bodyWidth: () => {
      const xs = body().map(({ x }) => x);
      return Math.max(...xs) - Math.min(...xs) + 1;
    },
    cells,
    crumbs,
    hearts,
  };
}

test("it starts curled up asleep on the visible bottom edge", async () => {
  const toy = setup();
  await toy.run(1);
  expect(toy.bodyTop()).toBe(SLEEPING_TOP);
});

test("the standing sprite is eight cells wide, one cell per sprite pixel", async () => {
  const toy = setup();
  await toy.run(1);
  await toy.wake();
  expect(toy.bodyCells()).toBe(STAND_PIXELS);
  expect(toy.bodyWidth()).toBe(8);
});

test("a tap on the sleeping critter wakes it", async () => {
  const toy = setup();
  await toy.run(1);
  toy.tap(toy.bodyX(), GROUND - 2);
  await toy.run(150);
  expect(toy.bodyTop()).toBe(STANDING_TOP);
});

test("a tap in empty space wakes it as well as tossing a crumb", async () => {
  const toy = setup();
  await toy.run(1);
  toy.tap(10, 30);
  await toy.run(10);
  expect(toy.crumbs()).toBe(1);
  await toy.run(200);
  expect(toy.bodyTop()).toBeLessThanOrEqual(STANDING_TOP);
});

test("it walks toward a hovering pointer", async () => {
  const toy = setup();
  await toy.run(1);
  await toy.wake();
  toy.hover(60, 80);
  await toy.run(400);
  expect(Math.abs(toy.bodyX() - 60)).toBeLessThan(2);
});

test("a finger resting on the canvas is not a hover to follow", async () => {
  const toy = setup();
  await toy.run(1);
  await toy.wake();
  const x = toy.bodyX();
  pointerAt(toy.canvas, "pointermove", 60, 80, { pointerType: "touch" });
  await toy.run(100);
  expect(toy.bodyX()).toBe(x);
});

test("rubbing back and forth over it makes it happy", async () => {
  const toy = setup();
  await toy.run(1);
  await toy.wake();
  expect(toy.hearts()).toBe(0);

  const x = toy.bodyX();
  for (let i = 0; i < 6; i += 1) {
    toy.hover(x + (i % 2 ? 2 : -2), GROUND - 3);
    await toy.run(8);
  }
  await toy.run(40);
  expect(toy.hearts()).toBeGreaterThan(0);
});

test("a crumb in reach is walked to and eaten", async () => {
  const toy = setup();
  await toy.run(1);
  toy.tap(20, 30);
  await toy.run(30);
  expect(toy.crumbs()).toBe(1);
  await toy.run(60 * 8);
  expect(toy.crumbs()).toBe(0);
});

test.each([
  ["left", 0.5],
  ["right", GRID - 0.5],
])(
  "a crumb dropped at the %s edge is eaten and the critter naps again",
  async (_edge, x) => {
    const toy = setup();
    await toy.run(1);
    toy.tap(x, 30);
    await toy.run(60 * 12);
    expect(toy.crumbs()).toBe(0);

    await toy.run(60 * 30);
    expect(toy.bodyTop()).toBe(SLEEPING_TOP);
    expect(await toy.run(60 * 30)).toBe("still");
  },
);

test("it naps again after being alone a while", async () => {
  const toy = setup();
  await toy.run(1);
  await toy.wake();
  expect(toy.bodyTop()).toBe(STANDING_TOP);
  await toy.run(60 * 12);
  expect(toy.bodyTop()).toBe(SLEEPING_TOP);
});

test("untouched on start it settles within 5 s", async () => {
  const toy = setup();
  expect(await toy.run(60 * 5)).toBe("still");
});

test("asleep it breathes for a while, then stops asking for frames", async () => {
  const toy = setup();
  expect(await toy.run(60)).toBe("active");
  expect(await toy.run(60 * 20)).toBe("still");
});

test("it follows the visible bottom edge when the viewport changes", async () => {
  const toy = setup();
  await toy.run(1);
  await toy.wake();
  toy.resize(0, 50);
  await toy.run(5);
  expect(toy.bodyTop()).toBe(50 - 7 - 7);
  expect(toy.bodyX()).toBeGreaterThanOrEqual(0);
  expect(toy.bodyX()).toBeLessThanOrEqual(GRID);
});

test("it stays inside a narrower visible span after a resize", async () => {
  const toy = setup();
  await toy.run(1);
  await toy.wake();
  probe = new DOMRect(20 * CELL_PX, 0, 40 * CELL_PX, 50 * CELL_PX);
  window.dispatchEvent(new Event("resize"));
  await toy.run(5);
  expect(toy.bodyX()).toBeGreaterThanOrEqual(20);
  expect(toy.bodyX()).toBeLessThanOrEqual(60);
});

async function highestWhile(toy: ReturnType<typeof setup>, steps: number) {
  let highest = Infinity;
  for (let i = 0; i < steps; i += 1) {
    await toy.run(1);
    highest = Math.min(highest, toy.bodyTop());
  }
  return highest;
}

test("rapid treats and taps never stack hops into flight", async () => {
  const solo = setup();
  await solo.run(1);
  solo.tap(solo.bodyX(), GROUND - 2);
  const singleHop = await highestWhile(solo, 150);
  expect(singleHop).toBeLessThan(STANDING_TOP);
  stop?.();
  document.body.replaceChildren();

  const toy = setup();
  await toy.run(1);
  await toy.wake();
  let highest = Infinity;
  for (let i = 0; i < 40; i += 1) {
    const x = toy.bodyX();
    toy.tap(i % 2 ? x : x + 3, i % 3 ? GROUND - 3 : 30);
    highest = Math.min(highest, await highestWhile(toy, 4));
  }
  expect(highest).toBeGreaterThanOrEqual(singleHop);

  await toy.run(60 * 4);
  expect(toy.bodyTop()).toBeGreaterThanOrEqual(STANDING_TOP);
});

test("on a grid twice as fine each sprite pixel is a 2x2 block of cells", async () => {
  const size = GRID * 2;
  const toy = setup({ top: 70, bottom: 250 }, size);
  await toy.run(1);
  toy.tap(toy.bodyX(), 2 * GROUND - 4);
  await toy.run(150);
  expect(toy.bodyCells()).toBe(STAND_PIXELS * 4);
  expect(toy.bodyWidth()).toBe(16);
});

test("the grass repeats across the whole ground, but for where the critter covers it", async () => {
  const toy = setup();
  await toy.run(1);
  const clear = (x: number) => Math.abs(x - toy.bodyX()) > 8;
  const tufts = toy
    .cells((alpha, y) => alpha === GRASS && y === GROUND - 1)
    .map(({ x }) => x);
  const first = tufts.filter((x) => x < 80 && clear(x) && clear(x + 80));
  expect(first.length).toBeGreaterThan(0);
  for (const x of first) expect(tufts).toContain(x + 80);
});
