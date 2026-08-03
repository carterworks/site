class CommandBarElement extends HTMLElement {
  private shortcutHandler?: (event: KeyboardEvent) => void;

  connectedCallback() {
    if (this.dataset.ready) {
      if (this.shortcutHandler)
        document.addEventListener("keydown", this.shortcutHandler);
      return;
    }
    const dialog = this.querySelector<HTMLDialogElement>("dialog");
    const trigger = this.querySelector<HTMLButtonElement>(".command-trigger");
    const input = this.querySelector<HTMLInputElement>("input");
    const back = this.querySelector<HTMLButtonElement>("[data-back]");
    const close = this.querySelector<HTMLButtonElement>("[data-close]");
    const searchIcon = this.querySelector<SVGElement>("[data-search-icon]");
    const pageLinks = this.querySelector<HTMLElement>("[data-page-links]");
    const appearance =
      this.querySelector<HTMLButtonElement>("[data-appearance]");
    const scheme = this.querySelector<HTMLElement>("[data-scheme]");
    const rootPanel = this.querySelector<HTMLElement>('[data-panel="root"]');
    const settingsPanel = this.querySelector<HTMLElement>(
      '[data-panel="settings"]',
    );
    if (
      !dialog ||
      !trigger ||
      !input ||
      !back ||
      !close ||
      !searchIcon ||
      !pageLinks ||
      !appearance ||
      !scheme ||
      !rootPanel ||
      !settingsPanel
    ) {
      return;
    }

    this.dataset.ready = "true";

    const panels = { root: rootPanel, settings: settingsPanel };
    let activePanel: keyof typeof panels = "root";
    const supportsInvokerCommands = "commandForElement" in trigger;

    if (!navigator.platform.toLowerCase().includes("mac")) {
      const shortcut = this.querySelector<HTMLElement>(".shortcut");
      if (shortcut) shortcut.textContent = "Ctrl K";
    }

    const panel = () => panels[activePanel];
    const commands = () => [
      ...panel().querySelectorAll<HTMLElement>("[data-command]"),
    ];
    const visibleCommands = () =>
      commands().filter((command) => !command.hidden);
    const absoluteUrl = (href: string) => new URL(href, location.href).href;
    const commandFrom = (target: EventTarget | null) =>
      target instanceof Element
        ? target.closest<HTMLElement>("[data-command]")
        : null;

    const createLink = (href: string, label: string, detail: string) => {
      const link = document.createElement("a");
      link.href = href;
      link.dataset.command = "";
      link.dataset.search = `${label} ${href}`.toLowerCase();
      const name = document.createElement("span");
      const destination = document.createElement("span");
      destination.className = "command-detail";
      name.textContent = label;
      destination.textContent = detail;
      link.appendChild(name);
      link.appendChild(destination);
      return link;
    };

    const select = (command?: HTMLElement, focus = false) => {
      this.querySelectorAll<HTMLElement>("[data-command]").forEach((item) => {
        item.toggleAttribute("data-active", item === command);
      });
      if (focus) command?.focus();
    };

    const filter = () => {
      const words = input.value.toLowerCase().match(/\S+/g) ?? [];
      commands().forEach((command) => {
        const matches = words.every((word) =>
          (command.dataset.search ?? "").includes(word),
        );
        command.hidden = !matches;
      });
      panel()
        .querySelectorAll<HTMLElement>("[data-group]")
        .forEach((group) => {
          group.hidden = !group.querySelector("[data-command]:not([hidden])");
        });
      const visible = visibleCommands();
      const empty = panel().querySelector<HTMLElement>(".empty");
      if (empty) empty.hidden = visible.length !== 0;
      select(visible[0]);
    };

    const showPanel = (name: keyof typeof panels) => {
      activePanel = name;
      Object.entries(panels).forEach(([panelName, item]) => {
        item.hidden = panelName !== name;
      });
      back.hidden = name === "root";
      searchIcon.toggleAttribute("hidden", name !== "root");
      input.value = "";
      const searchLabel =
        name === "root" ? "Search commands" : "Search settings";
      input.placeholder = searchLabel;
      input.setAttribute("aria-label", searchLabel);
      input.setAttribute(
        "aria-controls",
        name === "root" ? "command-root" : "command-settings-menu",
      );
      this.querySelectorAll<HTMLElement>("[data-root-help]").forEach(
        (item) => (item.hidden = name !== "root"),
      );
      this.querySelectorAll<HTMLElement>("[data-settings-help]").forEach(
        (item) => (item.hidden = name === "root"),
      );
      filter();
      input.focus();
    };

    const rebuildPageLinks = () => {
      pageLinks.replaceChildren();
      const sourceLinks = [
        ...document.querySelectorAll<HTMLAnchorElement>("body a[href]"),
      ].filter((link) => !this.contains(link));
      const sitemapLinks = [
        ...this.querySelectorAll<HTMLAnchorElement>("[data-sitemap]"),
      ];
      const sitemapUrls = new Set(
        sitemapLinks.map((link) => absoluteUrl(link.href)),
      );
      const pageOnlyLinks = sourceLinks.filter(
        (source) => !sitemapUrls.has(absoluteUrl(source.href)),
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

    const currentScheme = () =>
      document.documentElement.style.colorScheme ||
      (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

    const updateSchemeLabel = () => {
      const dark = currentScheme() === "dark";
      scheme.textContent = dark ? "On" : "Off";
      appearance.setAttribute("aria-pressed", String(dark));
    };

    const toggleAppearance = (close: boolean) => {
      document.documentElement.style.colorScheme =
        currentScheme() === "dark" ? "light" : "dark";
      updateSchemeLabel();
      if (close) dialog.close();
    };

    const prepare = () => {
      rebuildPageLinks();
      updateSchemeLabel();
      showPanel("root");
      if (!supportsInvokerCommands) dialog.showModal();
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
      select(visible[next], document.activeElement !== input);
      visible[next].scrollIntoView({ block: "nearest" });
    };

    trigger.addEventListener("click", prepare);
    back.addEventListener("click", () => showPanel("root"));
    close.addEventListener("click", () => {
      if (supportsInvokerCommands) return;
      if (activePanel === "settings") showPanel("root");
      else dialog.close();
    });
    input.addEventListener("input", filter);
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        move(event.key === "ArrowDown" ? 1 : -1);
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (event.shiftKey && activePanel === "settings") {
          toggleAppearance(false);
          return;
        }
        visibleCommands()
          .find((command) => command.hasAttribute("data-active"))
          ?.click();
      }
    });
    this.addEventListener("keydown", (event) => {
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
        toggleAppearance(false);
      }
    });
    dialog.addEventListener("cancel", (event) => {
      if (activePanel === "settings") {
        event.preventDefault();
        showPanel("root");
      }
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
      if (target.closest("[data-appearance]")) toggleAppearance(true);
    });
    this.shortcutHandler = (event) => {
      if (
        !event.altKey &&
        !event.shiftKey &&
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        if (!dialog.open) trigger.click();
      }
    };
    document.addEventListener("keydown", this.shortcutHandler);
  }

  disconnectedCallback() {
    if (this.shortcutHandler)
      document.removeEventListener("keydown", this.shortcutHandler);
  }
}

if (!customElements.get("command-bar")) {
  customElements.define("command-bar", CommandBarElement);
}
