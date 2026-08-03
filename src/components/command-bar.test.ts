import { beforeEach, describe, expect, test } from "vitest";
import "./command-bar";

const markup = `
  <a href="/blog/post/">Article on this page</a>
  <a href="https://example.com/reference">External reference</a>
  <command-bar>
    <button class="command-trigger" type="button"><span>Navigate</span><kbd class="shortcut">⌘ K</kbd></button>
    <dialog>
      <search>
        <svg data-search-icon></svg>
        <button data-back type="button" hidden>Back</button>
        <input type="search" aria-label="Search commands" aria-controls="command-root" />
        <button data-close type="button">Close</button>
      </search>
      <div id="command-root" data-panel="root">
        <section data-group>
          <button type="button" data-command data-settings data-search="settings appearance theme light dark">Settings</button>
        </section>
        <section data-group><div data-page-links></div></section>
        <section data-group>
          <a href="/" data-command data-sitemap data-search="home /">Home</a>
          <a href="/blog/post/" data-command data-sitemap data-search="article /blog/post/">Article</a>
        </section>
        <output class="empty" hidden>No matching commands</output>
      </div>
      <div id="command-settings-menu" data-panel="settings" hidden>
        <section data-group>
          <button type="button" aria-pressed="false" data-command data-appearance data-search="toggle appearance theme light dark">
            Dark mode <span data-scheme></span>
          </button>
        </section>
        <output class="empty" hidden>No matching commands</output>
      </div>
      <span data-root-help></span>
      <span data-settings-help hidden></span>
    </dialog>
  </command-bar>
`;

function getElement<T extends Element>(
  selector: string,
  parent: ParentNode = document,
) {
  const element = parent.querySelector<T>(selector);
  if (!element) throw new Error(`Missing test element: ${selector}`);
  return element;
}

describe("command bar", () => {
  beforeEach(() => {
    document.documentElement.style.colorScheme = "";
    const template = document.createElement("template");
    template.innerHTML = markup;
    document.body.replaceChildren(template.content.cloneNode(true));
  });

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
