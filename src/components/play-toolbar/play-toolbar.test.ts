import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createBackdropDisplay } from "../settings/backdrop-display-setting";
import { DISPLAYS } from "../pixel-backdrop/backdrop-displays";
import { SHAPES } from "../emulated-canvas/presenter";
import { createBackdropToy, RANDOM } from "../settings/backdrop-toy-setting";
import { TOYS } from "../backdrop-toys";
import "./play-toolbar";
import { settings } from "../settings/site-settings";
import { createThemeSetting } from "../settings/theme-setting";

vi.mock("../backdrop-toys", () => ({
  TOYS: ["one", "two"].map((id) => ({ id, label: id.toUpperCase() })),
}));

const markup = `
  <play-toolbar role="group" aria-label="Playground">
    <label>Toy <select data-toy></select></label>
    <button type="button" data-theme></button>
    <label>Display <select data-display></select></label>
    <label>Shape <select data-shape></select></label>
    <label>Cells <select data-cells></select></label>
    <button type="button" data-image>Image…</button>
    <input type="file" accept="image/*" hidden />
    <a href="/">Home</a>
    <p role="status" data-status></p>
    <p data-shape-note></p>
    <div data-fps hidden>
      <p data-fps-rate></p>
      <p data-fps-low></p>
      <svg><polyline data-fps-history /></svg>
    </div>
  </play-toolbar>
`;

let osScheme: "light" | "dark" = "light";
let osListeners: (() => void)[] = [];
let toyId = "";
const setToy = vi.fn((id: string) => {
  toyId = id;
});
const setDisplay = vi.fn();
let tweaks: { shape?: string; autoFit?: boolean; scale?: number } = {};
const configure = vi.fn((partial: object) => Object.assign(tweaks, partial));
const play = vi.fn((toy: { id: string }) => {
  toyId = toy.id;
});

const get = <T extends Element>(selector: string) => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing test element: ${selector}`);
  return element;
};

const toy = () => get<HTMLSelectElement>("[data-toy]");
const shownToy = () => toy().selectedOptions[0]?.textContent;
const chooseToy = (id: string) => {
  toy().value = id;
  toy().dispatchEvent(new Event("change"));
};
const theme = () => get<HTMLButtonElement>("[data-theme]");
const display = () => get<HTMLSelectElement>("[data-display]");
const shownDisplay = () => display().selectedOptions[0]?.textContent;
const chooseDisplay = (id: string) => {
  display().value = id;
  display().dispatchEvent(new Event("change"));
};
const status = () => get("[data-status]").textContent;
const settle = () => new Promise((resolve) => setTimeout(resolve));

const bitmap = () => ({ width: 2, height: 1, close: vi.fn() });

function decodes(...results: (ReturnType<typeof bitmap> | Error)[]) {
  const decode = vi.fn();
  for (const result of results) {
    if (result instanceof Error) decode.mockRejectedValueOnce(result);
    else decode.mockResolvedValueOnce(result);
  }
  vi.stubGlobal("createImageBitmap", decode);
}

function choosePicture() {
  const input = get<HTMLInputElement>("input[type=file]");
  const file = new File(["x"], "pic.png", { type: "image/png" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change"));
}

function mount() {
  document.documentElement.style.colorScheme = "";
  localStorage.clear();
  Object.assign(settings, {
    theme: createThemeSetting(),
    backdrop: createBackdropToy(() => 0, new EventTarget()),
    display: createBackdropDisplay(),
  });
  const template = document.createElement("template");
  template.innerHTML = markup;
  document.body.replaceChildren(template.content.cloneNode(true));
  const backdrop = document.createElement("pixel-backdrop");
  Object.defineProperty(backdrop, "toy", { get: () => toyId });
  Object.defineProperty(backdrop, "knobs", {
    get: () => ({
      shape: "square",
      autoFit: true,
      scale: 8,
      ...tweaks,
    }),
  });
  Object.assign(backdrop, { setToy, setDisplay, play, configure });
  document.body.append(backdrop);
}

beforeEach(() => {
  osScheme = "light";
  osListeners = [];
  toyId = TOYS[0].id;
  setToy.mockClear();
  play.mockClear();
  setDisplay.mockClear();
  configure.mockClear();
  tweaks = {};
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return query.includes("dark") === (osScheme === "dark");
    },
    addEventListener: (_: string, listener: () => void) =>
      osListeners.push(listener),
    removeEventListener: () => {},
  }));
  mount();
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

test("the controls show the current values and nothing is stored on load", () => {
  expect(shownToy()).toBe(TOYS[0].label);
  expect(theme().textContent).toBe("Theme: Light");
  expect(shownDisplay()).toBe(DISPLAYS[0].label);
  expect(localStorage.length).toBe(0);
  expect(document.documentElement.style.colorScheme).toBe("");
});

test("the theme button's accessible name starts with its visible text", () => {
  expect(theme().getAttribute("aria-label")).toBe(
    `${theme().textContent}. Activate to change.`,
  );
});

test("the toy menu offers every toy, then Random", () => {
  const offered = [...toy().options].filter((option) => !option.hidden);

  expect(offered.map((option) => option.value)).toEqual([
    ...TOYS.map((toy) => toy.id),
    RANDOM,
  ]);
  expect(offered.map((option) => option.textContent)).toEqual([
    ...TOYS.map((toy) => toy.label),
    "Random",
  ]);
});

test("choosing a toy from the menu plays it and keeps it shown", () => {
  chooseToy(TOYS[1].id);

  expect(setToy).toHaveBeenCalledWith(TOYS[1].id);
  expect(shownToy()).toBe(TOYS[1].label);
});

test("choosing Random from the menu shows Random", () => {
  chooseToy(RANDOM);

  expect(shownToy()).toBe("Random");
  expect(localStorage.length).toBe(0);
});

test("the theme button flips between light and dark", () => {
  theme().click();
  expect(theme().textContent).toBe("Theme: Dark");

  theme().click();
  expect(theme().textContent).toBe("Theme: Light");
});

test("a chosen picture is played as the image toy and named in the label", async () => {
  decodes(bitmap());

  choosePicture();
  await settle();

  expect(play.mock.calls[0][0]).toMatchObject({ id: "image", label: "Image" });
  expect(shownToy()).toBe("Image");
});

test("choosing a toy after a picture shows it and closes the bitmap", async () => {
  const picture = bitmap();
  decodes(picture);
  choosePicture();
  await settle();

  chooseToy(TOYS[1].id);

  expect(shownToy()).toBe(TOYS[1].label);
  expect(picture.close).toHaveBeenCalled();
});

test("a second picture replaces the first, which is closed", async () => {
  const [first, second] = [bitmap(), bitmap()];
  decodes(first, second);
  choosePicture();
  await settle();

  choosePicture();
  await settle();

  expect(play).toHaveBeenCalledTimes(2);
  expect(first.close).toHaveBeenCalled();
  expect(second.close).not.toHaveBeenCalled();
});

test("a picture still decoding when a toy is chosen is dropped", async () => {
  const picture = bitmap();
  decodes(picture);
  choosePicture();

  chooseToy(TOYS[1].id);
  await settle();

  expect(play).not.toHaveBeenCalled();
  expect(picture.close).toHaveBeenCalled();
});

test("only the latest of two pictures decoding at once is played", async () => {
  const [first, second] = [bitmap(), bitmap()];
  decodes(first, second);
  choosePicture();
  choosePicture();
  await settle();

  expect(play).toHaveBeenCalledTimes(1);
  expect(first.close).toHaveBeenCalled();
  expect(second.close).not.toHaveBeenCalled();
});

test("a picture that finishes decoding after the toolbar left is dropped", async () => {
  const picture = bitmap();
  decodes(picture);
  choosePicture();

  get("play-toolbar").remove();
  await settle();

  expect(play).not.toHaveBeenCalled();
  expect(picture.close).toHaveBeenCalled();
});

test("a playing picture is closed once the next page has swapped its toy in", async () => {
  const picture = bitmap();
  decodes(picture);
  choosePicture();
  await settle();

  get("play-toolbar").remove();
  expect(picture.close).not.toHaveBeenCalled();

  document.dispatchEvent(new Event("astro:page-load"));
  expect(picture.close).toHaveBeenCalled();
});

test("a file that cannot be decoded says so, and the next picture clears it", async () => {
  decodes(new Error("not an image"), bitmap());

  choosePicture();
  await settle();
  expect(status()).toBe("Couldn't open that image.");
  expect(play).not.toHaveBeenCalled();

  choosePicture();
  await settle();
  expect(status()).toBe("");
});

test("choosing a toy clears a failed-decode message", async () => {
  decodes(new Error("not an image"));
  choosePicture();
  await settle();

  chooseToy(TOYS[1].id);

  expect(status()).toBe("");
});

test("the image button opens the file picker", () => {
  const click = vi.spyOn(get<HTMLInputElement>("input[type=file]"), "click");

  get<HTMLButtonElement>("[data-image]").click();

  expect(click).toHaveBeenCalled();
});

test("an OS colour scheme change re-renders the label without storing anything", () => {
  osScheme = "dark";
  osListeners.forEach((listener) => listener());

  expect(theme().textContent).toBe("Theme: Dark");
  expect(localStorage.length).toBe(0);
});

test("a page load re-renders, as the toy is chosen after the bar connects", () => {
  settings.backdrop.cycle();
  toy().value = "";

  document.dispatchEvent(new Event("astro:page-load"));

  expect(shownToy()).toBe(TOYS[1].label);
});

test("the display menu offers every display", () => {
  const offered = [...display().options];

  expect(offered.map((option) => option.value)).toEqual(
    DISPLAYS.map((display) => display.id),
  );
  expect(offered.map((option) => option.textContent)).toEqual(
    DISPLAYS.map((display) => display.label),
  );
});

test("choosing a display from the menu shows it and keeps it shown", () => {
  chooseDisplay(DISPLAYS[2].id);

  expect(setDisplay).toHaveBeenCalledWith(DISPLAYS[2].id);
  expect(shownDisplay()).toBe(DISPLAYS[2].label);
});

const runFrames = () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    frames.push(callback),
  );
  vi.stubGlobal("cancelAnimationFrame", () => frames.splice(0));
  mount();
  let now = 0;
  frames.shift()?.(now);
  return (...gaps: number[]) => {
    for (const gap of gaps) frames.shift()?.((now += gap));
  };
};
const repeat = (times: number, gap: number) => Array<number>(times).fill(gap);
const rate = () => get("[data-fps-rate]").textContent;
const low = () => get("[data-fps-low]").textContent;
const history = () => get("[data-fps-history]").getAttribute("points");

test("the frame rate is shown each half second, from the frames between", () => {
  const frame = runFrames();
  expect(get<HTMLElement>("[data-fps]").hidden).toBe(true);

  frame(...repeat(25, 20));
  expect(get<HTMLElement>("[data-fps]").hidden).toBe(false);
  expect(rate()).toBe("FPS: \u200750");

  frame(...repeat(20, 25));
  expect(rate()).toBe("FPS: \u200740");
});

test("the 1% low averages the slowest hundredth of recent frames", () => {
  const frame = runFrames();

  frame(...repeat(25, 20));
  expect(low()).toBe("1% low: \u200750");

  frame(100, ...repeat(20, 20));
  expect(low()).toBe("1% low: \u200710");
});

test("the 1% low forgets frames older than 30s", () => {
  const frame = runFrames();

  frame(1000, ...repeat(58, 500), 500);
  expect(low()).toBe("1% low: \u2007\u20071");

  frame(500);
  expect(low()).toBe("1% low: \u2007\u20072");
});

test("the sparkline steps through each half second's rate, scaled to the peak", () => {
  const frame = runFrames();

  frame(...repeat(25, 20), ...repeat(20, 25));

  expect(history()).toBe("58,0 59,0 59,0.2 60,0.2");
});

test("the sparkline keeps only the last 30s", () => {
  const frame = runFrames();

  frame(...repeat(25 * 61, 20));

  expect(history()?.split(" ")).toHaveLength(120);
});

test("the frame counter stops when the toolbar leaves", () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    frames.push(callback),
  );
  const cancel = vi.fn();
  vi.stubGlobal("cancelAnimationFrame", cancel);
  mount();

  get("play-toolbar").remove();

  expect(cancel).toHaveBeenCalledWith(frames.length);
});

const shape = () => get<HTMLSelectElement>("[data-shape]");
const chooseShape = (id: string) => {
  shape().value = id;
  shape().dispatchEvent(new Event("change"));
};
const shapeNote = () => get("[data-shape-note]").textContent;
const fixing = DISPLAYS.find((display) => display.look?.shape)!;
const leaving = DISPLAYS.find(
  (display) => display.look && !display.look.shape,
)!;

test("the shape menu offers every shape the canvas draws", () => {
  const offered = [...shape().options];

  expect(offered.map((option) => option.value)).toEqual(SHAPES);
  expect(offered[0].textContent).toBe("Square");
});

test("choosing a shape draws the cells in it and stores nothing", () => {
  chooseShape("hex");

  expect(configure).toHaveBeenLastCalledWith({ shape: "hex" });
  expect(shape().value).toBe("hex");
  expect(localStorage.length).toBe(0);
});

test("a display that fixes the shape disables the menu and says why", () => {
  chooseDisplay(fixing.id);

  expect(shape().disabled).toBe(true);
  expect(shape().value).toBe(fixing.look!.shape);
  expect(shapeNote()).toBe(`${fixing.label} sets the shape.`);
});

test("a display that fixes nothing leaves the menu alone", () => {
  chooseDisplay(leaving.id);

  expect(shape().disabled).toBe(false);
  expect(shapeNote()).toBe("");
  expect(configure).not.toHaveBeenCalled();
});

test("a chosen shape gives way to a display's own, and returns after it", () => {
  chooseShape("hex");

  chooseDisplay(fixing.id);
  expect(configure).toHaveBeenLastCalledWith({ shape: fixing.look!.shape });

  chooseDisplay(leaving.id);
  expect(configure).toHaveBeenLastCalledWith({ shape: "hex" });
  expect(shape().value).toBe("hex");
  expect(shape().disabled).toBe(false);
});

const cells = () => get<HTMLSelectElement>("[data-cells]");
const chooseCells = (value: string) => {
  cells().value = value;
  cells().dispatchEvent(new Event("change"));
};

test("the cell menu fits the screen by default, or takes a size", () => {
  expect([...cells().options].map((option) => option.textContent)).toEqual([
    "Fit",
    "5px",
    "7px",
    "10px",
    "14px",
  ]);
  expect(cells().selectedOptions[0].textContent).toBe("Fit");
});

test("choosing a cell size stops fitting and stores nothing", () => {
  chooseCells("7");

  expect(configure).toHaveBeenLastCalledWith({ autoFit: false, scale: 7 });
  expect(cells().selectedOptions[0].textContent).toBe("7px");
  expect(localStorage.length).toBe(0);
});

test("choosing Fit fits the screen again", () => {
  chooseCells("7");

  chooseCells("fit");

  expect(configure).toHaveBeenLastCalledWith({ autoFit: true });
  expect(cells().selectedOptions[0].textContent).toBe("Fit");
});
