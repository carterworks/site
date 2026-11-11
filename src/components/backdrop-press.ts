/**
 * What the page owns: a toy press must never land on something the visitor can
 * read, select, follow or operate. `command-bar` and `dialog` cover the
 * navigation popover, which sits in the top layer. `main` and `header` are the
 * solid panels over the backdrop, so their whitespace is content, not open space.
 */
const PAGE_CONTENT =
  "a, button, input, textarea, select, label, summary, [contenteditable], [tabindex], command-bar, dialog, main, header";

/** `undefined` means the browser cannot say what is under the point. */
export type NodeAtPoint = (x: number, y: number) => Node | null | undefined;
export type RectsOfText = (text: Text) => Iterable<DOMRect>;

const caretNode: NodeAtPoint = (x, y) =>
  "caretPositionFromPoint" in document
    ? (document.caretPositionFromPoint(x, y)?.offsetNode ?? null)
    : undefined;

const rectsOfText: RectsOfText = (text) => {
  const range = document.createRange();
  range.selectNodeContents(text);
  return range.getClientRects();
};

/**
 * The caret lookup snaps to the nearest text however far away it is, so the
 * point only counts as on text when it falls inside that text's own boxes.
 */
function isOverText(
  x: number,
  y: number,
  nodeAt: NodeAtPoint,
  rectsOf: RectsOfText,
) {
  const node = nodeAt(x, y);
  if (node === undefined) return true;
  if (!(node instanceof Text)) return false;
  for (const rect of rectsOf(node)) {
    if (
      x >= rect.left &&
      x <= rect.right &&
      y >= rect.top &&
      y <= rect.bottom
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Whether a `pointerdown` is a press in the open, for a toy: the primary
 * button or a primary touch or pen contact, not on page content, not on text.
 */
export function isToyPress(
  event: PointerEvent,
  nodeAt: NodeAtPoint = caretNode,
  rectsOf: RectsOfText = rectsOfText,
) {
  const contact = event.pointerType === "touch" || event.pointerType === "pen";
  if (event.button !== 0 || (contact && !event.isPrimary)) return false;
  if (event.target instanceof Element && event.target.closest(PAGE_CONTENT)) {
    return false;
  }
  return !isOverText(event.clientX, event.clientY, nodeAt, rectsOf);
}
