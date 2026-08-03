import { beforeEach, describe, expect, test } from "vitest";
import { getElement, setupCommandBar } from "./command-bar.fixture";

describe("command bar", () => {
  beforeEach(setupCommandBar);

  test("opens with links from the current page and omits sitemap duplicates", () => {
    getElement<HTMLButtonElement>(".command-trigger").click();

    expect(getElement<HTMLDialogElement>("dialog").open).toBe(true);
    const links = [...getElement("[data-page-links]").querySelectorAll("a")];
    expect(links.map((link) => link.textContent)).toEqual([
      "External referenceexample.com",
    ]);
    expect(links[0]?.href).toBe("https://example.com/reference");
  });

  test("opens with the keyboard shortcut", () => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "k",
        ctrlKey: true,
        bubbles: true,
      }),
    );

    expect(getElement<HTMLDialogElement>("dialog").open).toBe(true);
  });

  test("filters commands by every search word and reports an empty result", () => {
    getElement<HTMLButtonElement>(".command-trigger").click();
    const input = getElement<HTMLInputElement>("input");

    input.value = "appearance dark";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(getElement<HTMLElement>("[data-settings]").hidden).toBe(false);
    expect(getElement<HTMLElement>('a[data-sitemap][href="/"]').hidden).toBe(
      true,
    );

    input.value = "not present";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(
      getElement<HTMLOutputElement>('[data-panel="root"] .empty').hidden,
    ).toBe(false);
  });

  test("opens settings and toggles dark mode", () => {
    getElement<HTMLButtonElement>(".command-trigger").click();
    getElement<HTMLButtonElement>("[data-settings]").click();

    expect(getElement<HTMLElement>('[data-panel="root"]').hidden).toBe(true);
    expect(getElement<HTMLElement>('[data-panel="settings"]').hidden).toBe(
      false,
    );
    expect(
      getElement<HTMLInputElement>("input").getAttribute("aria-label"),
    ).toBe("Search settings");

    const appearance = getElement<HTMLButtonElement>("[data-appearance]");
    appearance.click();

    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(appearance.getAttribute("aria-pressed")).toBe("true");
    expect(getElement<HTMLDialogElement>("dialog").open).toBe(false);
  });
});
