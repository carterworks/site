class CommandBarElement extends HTMLElement {
  connectedCallback() {
    if (this.dataset.ready) return;
    const dialog = this.querySelector<HTMLDialogElement>("dialog");
    const trigger = this.querySelector<HTMLInputElement>(".command-trigger");
    const back = this.querySelector<HTMLButtonElement>("[data-back]");
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
      !back ||
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
      trigger.setAttribute(
        "aria-controls",
        panels[name].id,
      );
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

    const currentScheme = () =>
      document.documentElement.style.colorScheme ||
      (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

    const updateSchemeLabel = () => {
      const dark = currentScheme() === "dark";
      scheme.textContent = dark ? "On" : "Off";
      appearance.setAttribute("aria-pressed", String(dark));
    };

    const toggleAppearance = () => {
      document.documentElement.style.colorScheme =
        currentScheme() === "dark" ? "light" : "dark";
      updateSchemeLabel();
    };

    const prepare = () => {
      if (dialog.matches(":popover-open")) return;
      rebuildPageLinks();
      updateSchemeLabel();
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

    trigger.addEventListener("focus", prepare);
    trigger.addEventListener("click", prepare);
    back.addEventListener("click", () => showPanel("root"));
    trigger.addEventListener("input", filter);
    trigger.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        if (activePanel === "settings") {
          event.preventDefault();
          showPanel("root");
        } else {
          dialog.hidePopover();
        }
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        move(event.key === "ArrowDown" ? 1 : -1);
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (event.shiftKey && activePanel === "settings") {
          toggleAppearance();
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
        toggleAppearance();
      }
    });
    dialog.addEventListener("toggle", (event) => {
      if (event.newState === "closed") trigger.blur();
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
      if (target.closest("[data-appearance]")) {
        toggleAppearance();
        dialog.hidePopover();
      }
    });
  }
}

if (!customElements.get("command-bar")) {
  customElements.define("command-bar", CommandBarElement);
}
