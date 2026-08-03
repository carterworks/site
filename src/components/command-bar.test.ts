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

function setupCommandBar() {
  document.documentElement.style.colorScheme = "";
  const template = document.createElement("template");
  template.innerHTML = markup;
  document.body.replaceChildren(template.content.cloneNode(true));
}

function getElement<T extends Element>(
  selector: string,
  parent: ParentNode = document,
) {
  const element = parent.querySelector<T>(selector);
  if (!element) throw new Error(`Missing test element: ${selector}`);
  return element;
}

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

describe("command bar dialog", () => {
  beforeEach(setupCommandBar);

  test("Escape returns from settings before closing the dialog", () => {
    getElement<HTMLButtonElement>(".command-trigger").click();
    getElement<HTMLButtonElement>("[data-settings]").click();
    const dialog = getElement<HTMLDialogElement>("dialog");

    const firstCancel = new Event("cancel", { cancelable: true });
    if (dialog.dispatchEvent(firstCancel)) dialog.close();

    expect(dialog.open).toBe(true);
    expect(getElement<HTMLElement>('[data-panel="root"]').hidden).toBe(false);
    expect(getElement<HTMLElement>('[data-panel="settings"]').hidden).toBe(
      true,
    );

    const secondCancel = new Event("cancel", { cancelable: true });
    if (dialog.dispatchEvent(secondCancel)) dialog.close();

    expect(dialog.open).toBe(false);
  });

  test("Shift+Enter toggles appearance without closing the dialog", () => {
    getElement<HTMLButtonElement>(".command-trigger").click();
    getElement<HTMLButtonElement>("[data-settings]").click();
    const dialog = getElement<HTMLDialogElement>("dialog");
    const input = getElement<HTMLInputElement>("input");

    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(
      getElement<HTMLButtonElement>("[data-appearance]").getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
    expect(dialog.open).toBe(true);
  });
});

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
