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

export function setupCommandBar() {
  document.documentElement.style.colorScheme = "";
  const template = document.createElement("template");
  template.innerHTML = markup;
  document.body.replaceChildren(template.content.cloneNode(true));
}

export function getElement<T extends Element>(
  selector: string,
  parent: ParentNode = document,
) {
  const element = parent.querySelector<T>(selector);
  if (!element) throw new Error(`Missing test element: ${selector}`);
  return element;
}
