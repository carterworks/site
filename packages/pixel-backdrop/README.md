# @carterworks/pixel-backdrop

A live pixel-grid backdrop for a page, as two custom elements and a set of
canvas toys:

- `<emulated-canvas>` is a canvas stand-in. Draw on it through
  `getContext("2d")` as on any canvas, and it shows the bitmap as magnified
  cells (squares, circles, hexes…) through per-pixel passes: a two-colour
  palette, drifting noise and an LCD's ghosting.
- `<pixel-backdrop>` fixes an `<emulated-canvas>` behind the page, runs a toy on
  it, passes it the pointer and dissolves between toys.
- Toys are plain canvas toys, `{ id, label, start(canvas) → stop }`. They run
  on a `<canvas>` as well as on `<emulated-canvas>`.

Every attribute, property, method and CSS custom property is listed in
[`custom-elements.json`](./custom-elements.json), a
[Custom Elements Manifest](https://github.com/webcomponents/custom-elements-manifest)
that editors and documentation tools can read. Run `pnpm analyze` to regenerate
it after changing an element's API.

## Use

The package ships TypeScript source, so the site needs a bundler such as Vite.

```html
<pixel-backdrop aria-hidden="true">
  <emulated-canvas
    data-width="160"
    data-height="160"
    data-fit="viewport"
  ></emulated-canvas>
</pixel-backdrop>

<script type="module">
  import "@carterworks/pixel-backdrop/pixel-backdrop.css";
  import "@carterworks/pixel-backdrop";
</script>
```

Importing the package defines both elements. The backdrop draws black on white
until it is given a display, a palette and an optional panel look:

```js
document.querySelector("pixel-backdrop").display = {
  base: "#889d58",
  ink: "#263c2b",
  look: { levels: 4, gap: 2, ghostRise: 45, ghostFall: 30 },
};
```

If you set `display` before the element is defined, its first frame is already
in it. A later change restarts the canvas's passes when the palette changes.

Its knobs default to the `--backdrop-*` custom properties in
`pixel-backdrop.css`. Override them on your own `:root`, or change them at
runtime with `configure({ shape: "hex" })` and undo that with `reset()`. Give
`--backdrop-page-color` your page's background colour, which a plain display
paints its gaps in. Choose the toy with `setToy(id)`, using an id from `TOYS`
in `@carterworks/pixel-backdrop/toys`, or run your own toy with `play(toy)`.

## A toy on a plain canvas

```js
import { pond } from "@carterworks/pixel-backdrop/toys/pond";

const stop = pond.start(document.querySelector("canvas"));
```
