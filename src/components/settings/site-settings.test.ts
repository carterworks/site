import { afterEach, expect, test, vi } from "vitest";
import "./site-settings";

vi.mock("../backdrop-toys", () => ({
  TOYS: ["one", "two"].map((id) => ({ id, label: id.toUpperCase() })),
}));

afterEach(() => {
  document.documentElement.style.colorScheme = "";
  document.documentElement.removeAttribute("data-display-light");
});

test("a navigation carries the chosen colour scheme to the incoming document", () => {
  document.documentElement.style.colorScheme = "dark";
  const newDocument = document.implementation.createHTMLDocument();

  document.dispatchEvent(
    Object.assign(new Event("astro:before-swap"), { newDocument }),
  );

  expect(newDocument.documentElement.style.colorScheme).toBe("dark");
});

test("a navigation gives the incoming document exactly the displays this one shows", () => {
  const root = document.documentElement;
  root.setAttribute("data-display-light", "pocket-lcd");
  const newDocument = document.implementation.createHTMLDocument();
  newDocument.documentElement.setAttribute("data-display-dark", "grid");

  document.dispatchEvent(
    Object.assign(new Event("astro:before-swap"), { newDocument }),
  );

  expect(newDocument.documentElement.getAttribute("data-display-light")).toBe(
    "pocket-lcd",
  );
  expect(newDocument.documentElement.hasAttribute("data-display-dark")).toBe(
    false,
  );
});
