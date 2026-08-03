import { beforeEach, describe, expect, test } from "vitest";
import { getElement, setupCommandBar } from "./command-bar.fixture";

describe("command bar dynamic behavior", () => {
  beforeEach(setupCommandBar);

  test("rebuilds page links when reopened after page content changes", () => {
    const trigger = getElement<HTMLButtonElement>(".command-trigger");
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(
      [...getElement("[data-page-links]").querySelectorAll("a")].map(
        (link) => link.textContent,
      ),
    ).toEqual(["External referenceexample.com"]);

    getElement<HTMLButtonElement>("[data-close]").dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    const externalLink = getElement<HTMLAnchorElement>(
      'body > a[href="https://example.com/reference"]',
    );
    externalLink.href = "https://example.org/updated";
    externalLink.textContent = "Updated reference";

    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const pageLinks = [
      ...getElement("[data-page-links]").querySelectorAll("a"),
    ];
    expect(pageLinks.map((link) => link.textContent)).toEqual([
      "Updated referenceexample.org",
    ]);
    expect(pageLinks[0]?.href).toBe("https://example.org/updated");
  });

  test("selects a visible result when filtering hides the prior selection", () => {
    getElement<HTMLButtonElement>(".command-trigger").dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    const settings = getElement<HTMLElement>("[data-settings]");
    expect(settings.hasAttribute("data-active")).toBe(true);

    const input = getElement<HTMLInputElement>("input");
    input.value = "home";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));

    const active = getElement<HTMLElement>(
      '[data-panel="root"] [data-command][data-active]',
    );
    expect(settings.hidden).toBe(true);
    expect(active.hidden).toBe(false);
    expect(active.textContent).toBe("Home");
  });
});
