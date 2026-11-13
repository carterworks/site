import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createBackdropDisplay } from "../settings/backdrop-display-setting";
import { DISPLAYS } from "../pixel-backdrop/backdrop-displays";
import { createBackdropToy } from "../settings/backdrop-toy-setting";
import { TOYS } from "../backdrop-toys";
import "./command-bar";
import { settings } from "../settings/site-settings";
import { createThemeSetting } from "../settings/theme-setting";

vi.mock("../backdrop-toys", () => ({
  TOYS: ["one", "two"].map((id) => ({ id, label: id.toUpperCase() })),
}));

const markup = `
  <a href="/blog/post/">Article on this page</a>
  <a href="https://example.com/reference">External reference</a>
  <command-bar>
    <label for="command-navigate">Navigate</label>
    <input id="command-navigate" class="command-trigger" type="search" accesskey="k" placeholder="Navigate" />
    <dialog popover>
      <button data-back type="button" hidden>Back</button>
      <div id="command-root" data-panel="root">
        <section data-group>
          <button type="button" data-command data-settings data-search="settings appearance theme light dark">Settings</button>
        </section>
        <section data-group><div data-page-links></div></section>
        <section data-group>
          <h2>Sitemap</h2>
          <a href="/" data-command data-sitemap data-search="home /">Home</a>
          <a href="/blog/post/" data-command data-sitemap data-search="article /blog/post/">Article</a>
        </section>
        <output class="empty" hidden>No matching commands</output>
      </div>
      <div id="command-settings-menu" data-panel="settings" hidden>
        <section data-group>
          <button type="button" data-command data-cycle-setting="theme" data-title="Theme" data-search="theme dark light system"><span>Theme</span><span class="command-detail"></span></button>
          <button type="button" data-command data-cycle-setting="backdrop" data-title="Backdrop" data-search="backdrop shimmer"><span>Backdrop</span><span class="command-detail"></span></button>
          <button type="button" data-command data-cycle-setting="display" data-title="Display" data-search="display screen lcd"><span>Display</span><span class="command-detail"></span></button>
        </section>
        <output class="empty" hidden>No matching commands</output>
      </div>
    </dialog>
  </command-bar>
`;

let osScheme: "light" | "dark" = "light";
let reducedMotion = false;
let osListeners: (() => void)[] = [];
const setToy = vi.fn();
const setDisplay = vi.fn();

function setupCommandBar() {
  document.documentElement.style.colorScheme = "";
  localStorage.clear();
  setToy.mockClear();
  setDisplay.mockClear();
  Object.assign(settings, {
    theme: createThemeSetting(),
    backdrop: createBackdropToy(() => 0, new EventTarget()),
    display: createBackdropDisplay(),
  });
  const template = document.createElement("template");
  template.innerHTML = markup;
  document.body.replaceChildren(template.content.cloneNode(true));
  const backdrop = document.createElement("pixel-backdrop");
  Object.assign(backdrop, { setToy, setDisplay });
  document.body.append(backdrop);

  const dialog = document.querySelector<HTMLDialogElement>("dialog");
  if (!dialog || typeof dialog.showPopover === "function") return;
  const matches = dialog.matches.bind(dialog);
  dialog.matches = ((selector: string) =>
    selector === ":popover-open"
      ? dialog.hasAttribute("data-popover-open")
      : matches(selector)) as typeof dialog.matches;
  dialog.showPopover = () => dialog.setAttribute("data-popover-open", "");
  dialog.hidePopover = () => {
    dialog.removeAttribute("data-popover-open");
    const event = new Event("toggle");
    Object.defineProperty(event, "newState", { value: "closed" });
    dialog.dispatchEvent(event);
  };
}

function row(name: "theme" | "backdrop" | "display") {
  return getElement<HTMLButtonElement>(`[data-cycle-setting="${name}"]`);
}

const value = (name: "theme" | "backdrop" | "display") =>
  row(name).querySelector(".command-detail")?.textContent;

function osPrefers(scheme: "light" | "dark") {
  osScheme = scheme;
  osListeners.forEach((listener) => listener());
}

function openSettings() {
  getElement<HTMLInputElement>(".command-trigger").click();
  getElement<HTMLButtonElement>("[data-settings]").click();
}

function getElement<T extends Element>(selector: string) {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing test element: ${selector}`);
  return element;
}

function pressKey(target: Element, key: string, init?: KeyboardEventInit) {
  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...init,
    }),
  );
}

beforeEach(() => {
  osScheme = "light";
  reducedMotion = false;
  osListeners = [];
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return query.includes("reduced-motion")
        ? reducedMotion
        : query.includes("dark") === (osScheme === "dark");
    },
    addEventListener: (_: string, listener: () => void) =>
      osListeners.push(listener),
    removeEventListener: () => {},
  }));
  setupCommandBar();
});
afterEach(() => vi.unstubAllGlobals());

describe("command bar", () => {
  test("opens with links from the current page and omits sitemap duplicates", () => {
    getElement<HTMLInputElement>(".command-trigger").click();

    expect(
      getElement<HTMLDialogElement>("dialog").matches(":popover-open"),
    ).toBe(true);
    const links = [...getElement("[data-page-links]").querySelectorAll("a")];
    expect(links.map((link) => link.textContent)).toEqual([
      "External reference — example.com",
    ]);
    expect(links[0]?.href).toBe("https://example.com/reference");
  });

  test("filters commands by every search word and reports an empty result", () => {
    getElement<HTMLInputElement>(".command-trigger").click();
    const input = getElement<HTMLInputElement>("input");

    input.value = "APPEARANCE dark";
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

  test("opens settings showing the current theme and backdrop", () => {
    openSettings();

    expect(getElement<HTMLElement>('[data-panel="root"]').hidden).toBe(true);
    expect(value("theme")).toBe("Light");
    expect(value("backdrop")).toBe(TOYS[0].label);
    expect(row("theme").getAttribute("aria-label")).toBe(
      "Theme: Light. Activate to change.",
    );
  });

  test("activating the theme row applies the opposite and keeps the dialog open", () => {
    osPrefers("dark");
    openSettings();

    row("theme").click();

    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(localStorage.getItem("color-scheme")).toBe("light");
    expect(value("theme")).toBe("Light");
    expect(
      getElement<HTMLDialogElement>("dialog").matches(":popover-open"),
    ).toBe(true);
  });

  test("the theme row flips back to the OS scheme and clears storage", () => {
    osPrefers("dark");
    openSettings();

    row("theme").click();
    row("theme").click();

    expect(value("theme")).toBe("Dark");
    expect(localStorage.getItem("color-scheme")).toBeNull();
    expect(document.documentElement.style.colorScheme).toBe("");
  });

  test("an OS change updates the label but not storage", () => {
    osPrefers("dark");
    openSettings();
    expect(value("theme")).toBe("Dark");

    osPrefers("light");

    expect(value("theme")).toBe("Light");
    expect(localStorage.getItem("color-scheme")).toBeNull();
  });

  test("activating the backdrop row stores and applies the next toy", () => {
    openSettings();

    row("backdrop").click();

    expect(localStorage.getItem("backdrop-mode")).toBe(TOYS[1].id);
    expect(setToy).toHaveBeenLastCalledWith(TOYS[1].id);
    expect(value("backdrop")).toBe(TOYS[1].label);
  });

  test("activating the display row stores and applies the next display", () => {
    openSettings();
    expect(value("display")).toBe(DISPLAYS[0].label);

    row("display").click();

    expect(localStorage.getItem("backdrop-display")).toBe(DISPLAYS[1].id);
    expect(setDisplay).toHaveBeenLastCalledWith(DISPLAYS[1].id);
    expect(value("display")).toBe(DISPLAYS[1].label);
  });

  test("the backdrop and display rows note that reduced motion pauses it", () => {
    reducedMotion = true;
    openSettings();

    const labels = {
      backdrop: TOYS[0].label,
      display: DISPLAYS[0].label,
    };
    for (const name of ["backdrop", "display"] as const) {
      expect(value(name)).toBe(`${labels[name]} (paused)`);
      expect(row(name).getAttribute("aria-label")).toContain(
        "paused for reduced motion",
      );
    }
  });
});

describe("command bar keyboard navigation", () => {
  test("ArrowUp and ArrowDown wrap through visible commands", () => {
    getElement<HTMLInputElement>(".command-trigger").dispatchEvent(
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

    pressKey(input, "ArrowUp");
    expect(article.hasAttribute("data-active")).toBe(true);

    pressKey(input, "ArrowDown");
    expect(settings.hasAttribute("data-active")).toBe(true);

    pressKey(input, "ArrowDown");
    expect(external.hasAttribute("data-active")).toBe(true);
  });

  test("Enter activates the selected command", () => {
    getElement<HTMLInputElement>(".command-trigger").dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );

    pressKey(getElement<HTMLInputElement>("input"), "Enter");

    expect(getElement<HTMLElement>('[data-panel="root"]').hidden).toBe(true);
    expect(getElement<HTMLElement>('[data-panel="settings"]').hidden).toBe(
      false,
    );
  });
});

describe("command bar dialog", () => {
  test("Escape returns from settings before closing the dialog", () => {
    getElement<HTMLInputElement>(".command-trigger").click();
    getElement<HTMLButtonElement>("[data-settings]").click();
    const dialog = getElement<HTMLDialogElement>("dialog");

    pressKey(getElement<HTMLInputElement>(".command-trigger"), "Escape");

    expect(dialog.matches(":popover-open")).toBe(true);
    expect(getElement<HTMLElement>('[data-panel="root"]').hidden).toBe(false);
    expect(getElement<HTMLElement>('[data-panel="settings"]').hidden).toBe(
      true,
    );

    pressKey(getElement<HTMLInputElement>(".command-trigger"), "Escape");

    expect(dialog.matches(":popover-open")).toBe(false);
  });

  test("focus restored to the trigger while the dialog closes does not reopen it", () => {
    openSettings();
    const dialog = getElement<HTMLDialogElement>("dialog");
    const show = vi.spyOn(dialog, "showPopover");

    dialog.removeAttribute("data-popover-open");
    getElement<HTMLInputElement>(".command-trigger").dispatchEvent(
      new FocusEvent("focus", { relatedTarget: row("theme") }),
    );

    expect(show).not.toHaveBeenCalled();
  });

  test("a click whose pointerup light-dismisses the popover its mousedown focus opened reopens it", () => {
    const trigger = getElement<HTMLInputElement>(".command-trigger");
    const dialog = getElement<HTMLDialogElement>("dialog");
    const closing = new Event("beforetoggle");
    Object.defineProperty(closing, "newState", { value: "closed" });

    trigger.dispatchEvent(new FocusEvent("focus"));
    dialog.dispatchEvent(closing);
    dialog.removeAttribute("data-popover-open");
    trigger.click();

    expect(dialog.matches(":popover-open")).toBe(true);
  });

  test("clicking the field of an open bar keeps the query and panel although pointerup light-dismissed it", () => {
    openSettings();
    const trigger = getElement<HTMLInputElement>(".command-trigger");
    const dialog = getElement<HTMLDialogElement>("dialog");
    trigger.value = "the";
    trigger.dispatchEvent(new Event("input", { bubbles: true }));

    trigger.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    dialog.hidePopover();
    trigger.click();

    expect(dialog.matches(":popover-open")).toBe(true);
    expect(trigger.value).toBe("the");
    expect(getElement<HTMLElement>('[data-panel="settings"]').hidden).toBe(
      false,
    );
  });

  test("Escape closes the dialog but leaves focus on the field without reopening", () => {
    const trigger = getElement<HTMLInputElement>(".command-trigger");
    const dialog = getElement<HTMLDialogElement>("dialog");
    trigger.click();
    const show = vi.spyOn(dialog, "showPopover");

    pressKey(trigger, "Escape");

    expect(dialog.matches(":popover-open")).toBe(false);
    expect(document.activeElement).toBe(trigger);
    expect(show).not.toHaveBeenCalled();
  });

  test("Escape from a command in the dialog closes it with focus back on the field", () => {
    const trigger = getElement<HTMLInputElement>(".command-trigger");
    const dialog = getElement<HTMLDialogElement>("dialog");
    trigger.click();
    const command = getElement<HTMLButtonElement>("[data-settings]");
    command.focus();

    pressKey(command, "Escape");
    trigger.focus();
    dialog.hidePopover();

    expect(document.activeElement).toBe(trigger);
  });

  test("Alt+K on the field that kept focus after Escape reopens the dialog", () => {
    const trigger = getElement<HTMLInputElement>(".command-trigger");
    const dialog = getElement<HTMLDialogElement>("dialog");
    trigger.click();
    pressKey(trigger, "Escape");

    pressKey(trigger, "k", { altKey: true });

    expect(dialog.matches(":popover-open")).toBe(true);
  });

  test("Shift+Enter advances the theme without closing the dialog", () => {
    osPrefers("dark");
    openSettings();
    const dialog = getElement<HTMLDialogElement>("dialog");
    const input = getElement<HTMLInputElement>("input");

    pressKey(input, "Enter", { shiftKey: true });
    expect(localStorage.getItem("color-scheme")).toBe("light");
    expect(value("theme")).toBe("Light");
    expect(dialog.matches(":popover-open")).toBe(true);

    pressKey(input, "Enter", { shiftKey: true });
    expect(localStorage.getItem("color-scheme")).toBeNull();
    expect(value("theme")).toBe("Dark");
  });
});

describe("command bar dynamic behavior", () => {
  test("rebuilds page links when reopened after page content changes", () => {
    const trigger = getElement<HTMLInputElement>(".command-trigger");
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(
      [...getElement("[data-page-links]").querySelectorAll("a")].map(
        (link) => link.textContent,
      ),
    ).toEqual(["External reference — example.com"]);

    getElement<HTMLDialogElement>("dialog").hidePopover();
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
      "Updated reference — example.org",
    ]);
    expect(pageLinks[0]?.href).toBe("https://example.org/updated");
  });

  test("selects a visible result when filtering hides the prior selection", () => {
    getElement<HTMLInputElement>(".command-trigger").dispatchEvent(
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

  test("persists the manual scheme and applies it to the incoming document on swap", () => {
    openSettings();
    row("theme").click();
    const newDocument = document.implementation.createHTMLDocument();

    document.dispatchEvent(
      Object.assign(new Event("astro:before-swap"), { newDocument }),
    );

    expect(newDocument.documentElement.style.colorScheme).toBe("dark");
  });
});
