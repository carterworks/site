import { afterEach, expect, test, vi } from "vitest";
import "./site-settings";

vi.mock("./backdrop-modes", () => ({
  MODES: ["one", "two"].map((id) => ({ id, label: id.toUpperCase() })),
}));

afterEach(() => {
  document.documentElement.style.colorScheme = "";
});

test("a navigation carries the chosen colour scheme to the incoming document", () => {
  document.documentElement.style.colorScheme = "dark";
  const newDocument = document.implementation.createHTMLDocument();

  document.dispatchEvent(
    Object.assign(new Event("astro:before-swap"), { newDocument }),
  );

  expect(newDocument.documentElement.style.colorScheme).toBe("dark");
});
