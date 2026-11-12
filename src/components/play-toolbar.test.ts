import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createBackdropDisplay } from "./backdrop-display-setting";
import { DISPLAYS } from "./backdrop-displays";
import { createBackdropMode } from "./backdrop-mode-setting";
import { MODES } from "./backdrop-modes";
import "./play-toolbar";
import { settings } from "./site-settings";
import { createThemeSetting } from "./theme-setting";

vi.mock("./backdrop-modes", () => ({
  MODES: ["one", "two"].map((id) => ({ id, label: id.toUpperCase() })),
}));

const markup = `
  <play-toolbar role="group" aria-label="Playground">
    <button type="button" data-toy></button>
    <button type="button" data-theme></button>
    <button type="button" data-display></button>
    <button type="button" data-image>Image…</button>
    <input type="file" accept="image/*" hidden />
    <a href="/">Home</a>
    <p role="status" data-status></p>
  </play-toolbar>
`;

let osScheme: "light" | "dark" = "light";
let osListeners: (() => void)[] = [];
let mode = "";
const setMode = vi.fn((id: string) => {
  mode = id;
});
const setDisplay = vi.fn();
const play = vi.fn((toy: { id: string }) => {
  mode = toy.id;
});

const get = <T extends Element>(selector: string) => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing test element: ${selector}`);
  return element;
};

const toy = () => get<HTMLButtonElement>("[data-toy]");
const theme = () => get<HTMLButtonElement>("[data-theme]");
const display = () => get<HTMLButtonElement>("[data-display]");
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
    backdrop: createBackdropMode(() => 0, new EventTarget()),
    display: createBackdropDisplay(),
  });
  const template = document.createElement("template");
  template.innerHTML = markup;
  document.body.replaceChildren(template.content.cloneNode(true));
  const backdrop = document.createElement("pixel-backdrop");
  Object.defineProperty(backdrop, "mode", { get: () => mode });
  Object.assign(backdrop, { setMode, setDisplay, play });
  document.body.append(backdrop);
}

beforeEach(() => {
  osScheme = "light";
  osListeners = [];
  mode = MODES[0].id;
  setMode.mockClear();
  play.mockClear();
  setDisplay.mockClear();
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

test("the buttons show the current values and nothing is stored on load", () => {
  expect(toy().textContent).toBe(`Toy: ${MODES[0].label}`);
  expect(theme().textContent).toBe("Theme: Light");
  expect(display().textContent).toBe(`Display: ${DISPLAYS[0].label}`);
  expect(localStorage.length).toBe(0);
  expect(document.documentElement.style.colorScheme).toBe("");
});

test("each button's accessible name starts with its visible text", () => {
  for (const button of [toy(), theme(), display()]) {
    expect(button.getAttribute("aria-label")).toBe(
      `${button.textContent}. Activate to change.`,
    );
  }
});

test("the toy button cycles the toy and shows the new one", () => {
  toy().click();

  expect(setMode).toHaveBeenCalledWith(MODES[1].id);
  expect(toy().textContent).toBe(`Toy: ${MODES[1].label}`);
});

test("the theme button cycles the theme, then offers System once one is stored", () => {
  theme().click();
  expect(theme().textContent).toBe("Theme: Dark");

  theme().click();
  expect(theme().textContent).toBe("Theme: System");
});

test("a chosen picture is played as the image toy and named in the label", async () => {
  decodes(bitmap());

  choosePicture();
  await settle();

  expect(play.mock.calls[0][0]).toMatchObject({ id: "image", label: "Image" });
  expect(toy().textContent).toBe("Toy: Image");
});

test("cycling the toy after a picture restores the registry label and closes the bitmap", async () => {
  const picture = bitmap();
  decodes(picture);
  choosePicture();
  await settle();

  toy().click();

  expect(toy().textContent).toBe(`Toy: ${MODES[1].label}`);
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

test("a picture still decoding when the toy is cycled is dropped", async () => {
  const picture = bitmap();
  decodes(picture);
  choosePicture();

  toy().click();
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

test("cycling the toy clears a failed-decode message", async () => {
  decodes(new Error("not an image"));
  choosePicture();
  await settle();

  toy().click();

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
  toy().textContent = "";

  document.dispatchEvent(new Event("astro:page-load"));

  expect(toy().textContent).toBe(`Toy: ${MODES[1].label}`);
});

test("the display button cycles the display and shows the new one", () => {
  display().click();

  expect(setDisplay).toHaveBeenCalledWith(DISPLAYS[1].id);
  expect(display().textContent).toBe(`Display: ${DISPLAYS[1].label}`);
});
