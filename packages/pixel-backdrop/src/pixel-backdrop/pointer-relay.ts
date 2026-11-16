import { isToyPress } from "./press";

/**
 * Set on `<html>` for the length of a hold; the stylesheet turns off text
 * selection, the touch callout and overscroll for it.
 */
const HOLDING = "data-backdrop-holding";

/**
 * A copy of a window pointer event for the canvas, carrying what a toy
 * written for a plain canvas reads. It does not bubble, so it never reaches
 * the window listeners that forward it.
 */
const forwarded = (type: string, event: PointerEvent) =>
  new PointerEvent(type, {
    clientX: event.clientX,
    clientY: event.clientY,
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    button: event.button,
    buttons: event.buttons,
    isPrimary: event.isPrimary,
  });

/**
 * Passes the window's pointer to `canvas`, which a fixed, non-interactive
 * layer can't receive itself, until the returned stop. A press in the open
 * starts a hold; stopping lets go of one as a `pointercancel`.
 */
export function relayPointer(canvas: EventTarget): () => void {
  /** The press a hold began with, until the hold ends. */
  let hold: PointerEvent | undefined;
  /**
   * Whether the hold is a touch that has grabbed the toy: its moves go to the
   * toy and never scroll. Any touch in the open grabs at once, for every toy,
   * so none can fall back to scrolling under the finger. One that waited to
   * tell a hold from a swipe lost every quick drag to the scroll; the page
   * still scrolls from its content, where a press is never the toy's.
   */
  let grabbed = false;

  const forward = (type: string, event: PointerEvent) =>
    canvas.dispatchEvent(forwarded(type, event));

  const endHold = () => {
    hold = undefined;
    grabbed = false;
    document.documentElement.removeAttribute(HOLDING);
  };

  /**
   * Ends a hold the pointer never released: on blur, a navigation, a touch
   * backstop, a new press or a stop. The toy is told by a `pointercancel`,
   * as a plain canvas tells it when a touch turns into a scroll.
   */
  const release = () => {
    const held = hold;
    endHold();
    if (held !== undefined) forward("pointercancel", held);
  };

  /** Touch has no hover: only a grabbed finger's moves reach the toy. */
  const onPointerMove = (event: PointerEvent) => {
    if (
      event.pointerType === "touch" &&
      !(grabbed && event.pointerId === hold?.pointerId)
    ) {
      return;
    }
    forward("pointermove", event);
  };

  const onPointerDown = (event: PointerEvent) => {
    if (!isToyPress(event)) return;
    release();
    hold = event;
    grabbed = event.pointerType === "touch";
    // Without `preventDefault`, which would break touch scrolling: the layer
    // ignores pointer events, so a drag from the margin starts a native text
    // selection across the page instead of dragging the toy.
    document.documentElement.setAttribute(HOLDING, "");
    getSelection()?.removeAllRanges();
    forward("pointerdown", event);
  };

  /** Only the pointer that began the hold may end it; another finger lifting must not. */
  const onPointerEnd = (event: PointerEvent) => {
    if (event.pointerId !== hold?.pointerId) return;
    endHold();
    forward(event.type, event);
  };

  /**
   * A touch hold's backstop for `pointerup` and `pointercancel`. Touches carry
   * no pointer id, so it waits for the last finger to lift.
   */
  const onTouchEnd = (event: TouchEvent) => {
    if (grabbed && event.touches.length === 0) release();
  };

  /**
   * In iOS Safari only this stops a touch scroll and its overscroll bounce;
   * pointer events and `touch-action` on the page can't. iOS waits on a
   * non-passive listener before it starts scrolling, so cancelling the first
   * move is enough. `touchstart` is left alone: cancelling it would also
   * swallow the click and focus a tap synthesizes.
   */
  const onTouchMove = (event: TouchEvent) => {
    if (grabbed && event.cancelable) event.preventDefault();
  };

  const onPointerLeave = () =>
    canvas.dispatchEvent(
      new PointerEvent("pointerleave", { pointerType: "mouse" }),
    );

  const listening = new AbortController();
  const { signal } = listening;
  const passive = { passive: true, signal };
  window.addEventListener("pointermove", onPointerMove, passive);
  window.addEventListener("pointerdown", onPointerDown, passive);
  window.addEventListener("pointerup", onPointerEnd, passive);
  window.addEventListener("pointercancel", onPointerEnd, passive);
  window.addEventListener("blur", release, passive);
  // The swap replaces <html>'s attributes, so a hold must not outlive its
  // `HOLDING` styles into the next page.
  document.addEventListener("astro:before-swap", release, { signal });
  // Not passive, as blocking a scroll is its job. Registered up front:
  // browsers decide whether a touch may block scrolling as it begins.
  window.addEventListener("touchmove", onTouchMove, { passive: false, signal });
  window.addEventListener("touchend", onTouchEnd, passive);
  window.addEventListener("touchcancel", onTouchEnd, passive);
  document.addEventListener("mouseleave", onPointerLeave, { signal });

  return () => {
    release();
    listening.abort();
  };
}
