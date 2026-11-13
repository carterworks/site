/**
 * What the page owns: a toy press must never land on something the visitor can
 * read, select, follow or operate. All page text lives in `main` and `header`,
 * so no text hit-test is needed. `command-bar` and `dialog` cover the
 * navigation popover, which sits in the top layer. `play-toolbar` is listed
 * so the gaps between its buttons never start a toy press. `main` and
 * `header` are the solid panels over the backdrop, so their whitespace is
 * content, not open space.
 */
const PAGE_CONTENT =
  "a, button, input, textarea, select, label, summary, [contenteditable], [tabindex], command-bar, play-toolbar, dialog, main, header";

/**
 * Whether a `pointerdown` is a press in the open, for a toy: the primary
 * button or a primary touch or pen contact, not on page content.
 */
export function isToyPress(event: PointerEvent) {
  const contact = event.pointerType === "touch" || event.pointerType === "pen";
  if (event.button !== 0 || (contact && !event.isPrimary)) return false;
  return !(
    event.target instanceof Element && event.target.closest(PAGE_CONTENT)
  );
}
