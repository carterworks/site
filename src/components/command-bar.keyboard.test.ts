import { beforeEach, describe, expect, test } from "vitest";
import { getElement, setupCommandBar } from "./command-bar.fixture";

describe("command bar keyboard navigation", () => {
  beforeEach(setupCommandBar);

  test("ArrowUp and ArrowDown wrap through visible commands", () => {
    getElement<HTMLButtonElement>(".command-trigger").dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    const input = getElement<HTMLInputElement>("input");
    input.value = "t";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));

    const settings = getElement<HTMLElement>("[data-settings]");
    const external = getElement<HTMLElement>(
      "[data-page-links] [data-command]",
    );
    const home = getElement<HTMLElement>('a[data-sitemap][href="/"]');
    const article = getElement<HTMLElement>(
      'a[data-sitemap][href="/blog/post/"]',
    );
    expect(home.hidden).toBe(true);
    expect(settings.hasAttribute("data-active")).toBe(true);

    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowUp",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(article.hasAttribute("data-active")).toBe(true);

    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(settings.hasAttribute("data-active")).toBe(true);

    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(external.hasAttribute("data-active")).toBe(true);
  });

  test("Enter activates the selected command", () => {
    getElement<HTMLButtonElement>(".command-trigger").dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );

    getElement<HTMLInputElement>("input").dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(getElement<HTMLElement>('[data-panel="root"]').hidden).toBe(true);
    expect(getElement<HTMLElement>('[data-panel="settings"]').hidden).toBe(
      false,
    );
    expect(
      getElement<HTMLInputElement>("input").getAttribute("aria-label"),
    ).toBe("Search settings");
  });
});
