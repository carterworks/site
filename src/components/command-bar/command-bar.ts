import { settings } from "../settings/site-settings";

const reducedMotion = "(prefers-reduced-motion: reduce)";
const colorScheme = "(prefers-color-scheme: dark)";

class CommandBarElement extends HTMLElement {
  cleanup?: () => void;

  disconnectedCallback() {
    this.cleanup?.();
  }

  connectedCallback() {
    if (this.dataset.ready) return;
    const dialog = this.querySelector<HTMLDialogElement>("dialog");
    const trigger = this.querySelector<HTMLInputElement>(".command-trigger");
    const back = this.querySelector<HTMLButtonElement>("[data-back]");
    const pageLinks = this.querySelector<HTMLElement>("[data-page-links]");
    const rows = [
      ...this.querySelectorAll<HTMLButtonElement>("[data-cycle-setting]"),
    ];
    const rootPanel = this.querySelector<HTMLElement>('[data-panel="root"]');
    const settingsPanel = this.querySelector<HTMLElement>(
      '[data-panel="settings"]',
    );
    if (
      !dialog ||
      !trigger ||
      !back ||
      !pageLinks ||
      !rows.length ||
      !rootPanel ||
      !settingsPanel
    ) {
      return;
    }

    this.dataset.ready = "true";

    const panels = { root: rootPanel, settings: settingsPanel };
    let activePanel: keyof typeof panels = "root";

    const panel = () => panels[activePanel];
    const commands = () => [
      ...panel().querySelectorAll<HTMLElement>("[data-command]"),
    ];
    const visibleCommands = () =>
      commands().filter((command) => !command.hidden);
    const commandFrom = (target: EventTarget | null) =>
      target instanceof Element
        ? target.closest<HTMLElement>("[data-command]")
        : null;

    const createLink = (href: string, label: string, detail: string) => {
      const link = document.createElement("a");
      link.href = href;
      link.dataset.command = "";
      link.dataset.search = `${label} ${href}`;
      const name = document.createElement("span");
      const destination = document.createElement("span");
      const separator = document.createElement("span");
      destination.className = "command-detail";
      separator.className = "command-separator";
      separator.ariaHidden = "true";
      name.textContent = label;
      separator.textContent = " — ";
      destination.textContent = detail;
      link.appendChild(name);
      link.appendChild(separator);
      link.appendChild(destination);
      const item = document.createElement("li");
      item.appendChild(link);
      return item;
    };

    const select = (command?: HTMLElement, focus = false) => {
      this.querySelectorAll<HTMLElement>("[data-command]").forEach((item) => {
        item.toggleAttribute("data-active", item === command);
      });
      if (focus) command?.focus();
    };

    const filter = () => {
      const panelCommands = commands();
      const terms = trigger.value.toLowerCase().match(/\S+/g) ?? [];
      const rankedCommands = panelCommands.filter((command) =>
        terms.every((term) =>
          (command.dataset.search ?? "").toLowerCase().includes(term),
        ),
      );
      const matches = new Set(rankedCommands);
      panelCommands.forEach((command) => {
        command.hidden = !matches.has(command);
      });
      panel()
        .querySelectorAll<HTMLElement>("[data-group]")
        .forEach((group) => {
          group.hidden = !group.querySelector("[data-command]:not([hidden])");
        });
      const empty = panel().querySelector<HTMLElement>(".empty");
      if (empty) empty.hidden = rankedCommands.length !== 0;
      select(rankedCommands[0]);
    };

    const showPanel = (name: keyof typeof panels) => {
      activePanel = name;
      Object.entries(panels).forEach(([panelName, item]) => {
        item.hidden = panelName !== name;
      });
      back.hidden = name === "root";
      trigger.value = "";
      trigger.setAttribute("aria-controls", panels[name].id);
      filter();
      trigger.focus();
    };

    const rebuildPageLinks = () => {
      pageLinks.replaceChildren();
      const sourceLinks = [
        ...document.querySelectorAll<HTMLAnchorElement>("body a[href]"),
      ].filter((link) => !this.contains(link));
      const sitemapLinks = [
        ...this.querySelectorAll<HTMLAnchorElement>("[data-sitemap]"),
      ];
      const sitemapUrls = new Set(sitemapLinks.map((link) => link.href));
      const pageOnlyLinks = sourceLinks.filter(
        (source) => !sitemapUrls.has(source.href),
      );

      pageOnlyLinks.forEach((source) => {
        const label = (
          source.getAttribute("aria-label") ||
          source.textContent ||
          source.href
        )
          .replace(/\s+/g, " ")
          .trim();
        const url = new URL(source.href);
        const detail =
          url.origin === location.origin
            ? `${url.pathname}${url.search}${url.hash}`
            : url.hostname.replace(/^www\./, "") || url.protocol.slice(0, -1);
        pageLinks.appendChild(createLink(source.href, label, detail));
      });
    };

    const renderRows = () => {
      rows.forEach((row) => {
        const name = row.dataset.cycleSetting as keyof typeof settings;
        const value = row.querySelector(".command-detail");
        if (!value) return;
        const label = settings[name].label();
        const paused =
          (name === "backdrop" || name === "display") &&
          matchMedia(reducedMotion).matches;
        value.textContent = paused ? `${label} (paused)` : label;
        row.setAttribute(
          "aria-label",
          `${row.dataset.title}: ${label}${paused ? " (paused for reduced motion)" : ""}. Activate to change.`,
        );
      });
    };

    const cycleSetting = (name: keyof typeof settings) => {
      settings[name].cycle();
      renderRows();
    };

    // The label alone follows the OS; storage is never touched by it.
    const osScheme = matchMedia(colorScheme);
    osScheme.addEventListener?.("change", renderRows);
    this.cleanup = () => osScheme.removeEventListener?.("change", renderRows);

    const prepare = () => {
      if (dialog.matches(":popover-open")) return;
      rebuildPageLinks();
      renderRows();
      dialog.showPopover();
      showPanel("root");
    };

    const move = (direction: number) => {
      const visible = visibleCommands();
      if (!visible.length) return;
      const current = visible.findIndex((command) =>
        command.hasAttribute("data-active"),
      );
      const next =
        current === -1
          ? direction > 0
            ? 0
            : visible.length - 1
          : (current + direction + visible.length) % visible.length;
      select(visible[next], document.activeElement !== trigger);
      visible[next].scrollIntoView({ block: "nearest" });
    };

    // Focus arriving from inside the dialog is dismissal restoring it to the
    // trigger mid-hide, where showPopover would throw. Click stays unguarded:
    // its pointerup light-dismisses the popover that mousedown's focus just
    // opened, and only the click reopens it.
    trigger.addEventListener("focus", (event) => {
      const from = event.relatedTarget;
      if (!(from instanceof Node && dialog.contains(from))) prepare();
    });
    // showPopover({ source }) would stop this light-dismiss, but Firefox lacks it.
    // A click on an already-open bar must restore it as it was, not rebuild it.
    let wasOpen = false;
    trigger.addEventListener("pointerdown", () => {
      wasOpen = dialog.matches(":popover-open");
    });
    trigger.addEventListener("click", () => {
      if (!wasOpen) return prepare();
      wasOpen = false;
      if (!dialog.matches(":popover-open")) dialog.showPopover();
      trigger.focus();
    });
    back.addEventListener("click", () => showPanel("root"));
    let keepFocus = false;
    trigger.addEventListener("input", filter);
    trigger.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        if (activePanel === "settings") {
          event.preventDefault();
          showPanel("root");
        } else if (dialog.matches(":popover-open")) {
          keepFocus = true;
          dialog.hidePopover();
        }
        return;
      }
      // Escape leaves focus here, so a later Alt+K raises no focus event.
      if (event.key.length === 1) prepare();
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        move(event.key === "ArrowDown" ? 1 : -1);
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (event.shiftKey && activePanel === "settings") {
          cycleSetting("theme");
          return;
        }
        visibleCommands()
          .find((command) => command.hasAttribute("data-active"))
          ?.click();
      }
    });
    this.addEventListener("keydown", (event) => {
      // The browser's own Escape dismissal restores focus to the field, but
      // only the toggle handler's blur would follow it unless told to keep it.
      if (event.key === "Escape" && dialog.contains(event.target as Node)) {
        keepFocus = true;
      }
      const command = commandFrom(event.target);
      if (!command || !panel().contains(command)) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        move(event.key === "ArrowDown" ? 1 : -1);
      }
      if (
        event.key === "Enter" &&
        event.shiftKey &&
        activePanel === "settings"
      ) {
        event.preventDefault();
        cycleSetting("theme");
      }
    });
    dialog.addEventListener("toggle", (event) => {
      if (event.newState !== "closed") return;
      if (!keepFocus) trigger.blur();
      keepFocus = false;
    });
    this.addEventListener("pointermove", (event) => {
      const command = commandFrom(event.target);
      if (command && panel().contains(command)) select(command);
    });
    this.addEventListener("focusin", (event) => {
      const command = commandFrom(event.target);
      if (command && panel().contains(command)) select(command);
    });
    this.addEventListener("click", (event) => {
      if (!(event.target instanceof Element)) return;
      const target = event.target;
      if (target.closest("[data-settings]")) showPanel("settings");
      const row = target.closest<HTMLElement>("[data-cycle-setting]");
      if (row) cycleSetting(row.dataset.cycleSetting as keyof typeof settings);
    });
  }
}

if (!customElements.get("command-bar")) {
  customElements.define("command-bar", CommandBarElement);
}
