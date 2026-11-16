import type { PixelBackdrop } from "@carterworks/pixel-backdrop";
import { afterEach, expect, test } from "vitest";
import { DISPLAYS, displayAttribute, showDisplay } from "./backdrop-displays";

/** The element left undefined, so this tests what the page tells it, not what it draws. */
const backdrop = document.createElement("pixel-backdrop") as PixelBackdrop;
document.body.append(backdrop);
await import("./follow-display");

const root = document.documentElement;
const displayOf = (id: string) =>
  DISPLAYS.find((display) => display.id === id)!;

/** As the display setting shows one; the page's observer sees it a microtask later. */
async function show(id: string) {
  showDisplay(root, displayOf(id));
  await Promise.resolve();
}

afterEach(async () => {
  for (const name of [
    "style",
    displayAttribute("light"),
    displayAttribute("dark"),
  ]) {
    root.removeAttribute(name);
  }
  await Promise.resolve();
});

test("a backdrop on the page as the module loads holds the theme before it is defined", () => {
  expect(customElements.get("pixel-backdrop")).toBeUndefined();
  expect(backdrop.display).toBe(displayOf("site-light"));
});

test("each scheme shows its own display, so a scheme flip swaps them", async () => {
  await show("pocket-lcd");
  await show("grid");
  expect(backdrop.display).toBe(displayOf("pocket-lcd"));

  root.style.colorScheme = "dark";
  await Promise.resolve();
  expect(backdrop.display).toBe(displayOf("grid"));

  root.style.colorScheme = "light";
  await Promise.resolve();
  expect(backdrop.display).toBe(displayOf("pocket-lcd"));
});

test("an unknown display shows the site's own look", async () => {
  await show("pocket-lcd");

  root.setAttribute(displayAttribute("light"), "missing");
  await Promise.resolve();

  expect(backdrop.display).toBe(displayOf("site-light"));
});
