# nodered-demo — research notes & implementation log

This file records the findings and changes made while building `nodered-demo/`,
a Node-RED-style flow editor built on top of `editor-core`'s `HarnessEditorEngine`,
used to exercise the library's component/port/wire/routing/rendering surface.

## 1. What was built

- `index.html` / `style.css` / `app.js` — an interactive flow canvas: palette
  (drag-and-drop + search filter + double-click quick-add), draggable/wireable
  nodes, undo/redo, zoom/pan, JSON import/export, a "Deploy" simulation that
  animates message pulses along routed wires, a properties panel, a debug log,
  and a validation panel.
- `node-types.js` — Node-RED-style palette definitions (`inject`, `debug`,
  `function`, `switch`, `change`, `delay`, `http request`, `mqtt out`) built
  with `editor-core`'s `ComponentBuilder`.

## 2. Bugs found and fixed

### 2.1 Wires appeared to stop following a dragged component
Root cause: `Canvas2DRenderer` caches each wire's `Path2D` keyed by
`wire.route.generatedAtRevision`. During a preview drag
(`engine.updatePreview`), `document.revision` does not advance until the
gesture commits, so every intermediate reroute during a single drag shares the
same revision — the renderer kept reusing the very first cached path for that
wire. The underlying route data was always correct; only the drawing was
stale.

**Fix:** pass `cachePaths: false` to `renderer.render(...)`. At this demo's
scale there's no measurable cost, and it removes an entire class of
"visual desync" bugs.

### 2.2 Stuck preview gesture
If a `pointerup`/`pointercancel` is ever missed (lost focus mid-drag, a
`confirm()` dialog, devtools, etc.), `engine.isPreviewActive` stays `true`
forever and every subsequent drag throws `"A preview gesture is already
active."`, breaking the app until reload.

**Fix:** defensively call `engine.cancelPreview()` at the top of `pointerdown`
if a preview is already active, and cancel the interaction controller's
gesture on `window.blur`.

### 2.3 Stale Properties panel during drag
The X/Y fields only refreshed on `selectionChanged`, not on every
`documentChanged`, so they went stale while dragging.

**Fix:** `syncPropertiesPosition()` patches just the X/Y inputs in place on
every `documentChanged` (skipping whichever input currently has focus).

### 2.4 Clone-arrow "dead zone" (found during testing, see §4)
See §4.3.

## 3. Research: connection-point location & labeling systems

### draw.io
Sourced from draw.io's own docs (`shape-connection-points-customise`,
`connector-fixed-vs-floating`, `connect-shapes`):

- Connection points are pure geometry, defined per-shape as a style array:
  `points=[[x0,y0,perimeter0,dx0,dy0], ...]`. `x,y` are **normalized 0–1
  fractions** of the bounding box (`[0,0]`=top-left, `[1,1]`=bottom-right),
  independent of any "side" concept. Optional 3rd value toggles perimeter
  snap vs. inside-shape; optional 4th/5th are absolute **pixel offsets**.
- On top of fixed points, draw.io supports **floating connections**: not
  pinned to any point, recomputed dynamically as the shape moves.
- Connection points carry **no text** — labels belong to edges, never to a
  point. The only point-adjacent affordance is four blue **directional
  arrows** on hover, used for "clone and connect" (click one → clones the
  shape and auto-draws a connector to it) and drag-to-connect.

### Node-RED
Sourced from `nodered.org/docs/creating-nodes/{properties,appearance}`:

- Ports are **not objects** in the flow JSON — a node just declares
  `inputs: 0|1` and `outputs: <n>` (reserved property names). The editor
  auto-distributes that many nubs evenly along the left (inputs) / right
  (outputs) edge based on node height. No per-port coordinate, no side other
  than left/right.
- Labeling is via `inputLabels` / `outputLabels` (string, array, or
  `function(index)`), shown **only as a hover tooltip**, user-overridable per
  instance in the edit dialog, and explicitly **static** — "Labels are not
  generated dynamically, and cannot be set by `msg` properties."
- `align: 'right'` is the documented convention for flow-terminating
  ("sink") nodes.

### Mapping onto `editor-core`'s `PortSpec`
`editor-core`'s model is effectively a superset of both:

| Concept | draw.io | Node-RED | editor-core |
|---|---|---|---|
| Location | `points=[[x,y,...]]`, any side | count-derived, left/right only | `side` (N/E/S/W) + `order` + optional `sideFraction` (0–1 fraction — same idea as draw.io's x/y) |
| Pixel nudge | `dx,dy` in points array | n/a | `tangentOffset` / `normalOffset` |
| Grouping | ad hoc (compound-shape rows) | fixed 2-column only | `pinBanks` (header, flow order, row gap, collapse) |
| Label, always visible | never | never | `label`/`function`/`detail` fields exist and can render as permanent pin-row text |
| Label on hover | n/a | `inputLabels`/`outputLabels` | implemented in this demo (§4.2) |
| Max connections/port | unlimited | unlimited | `connectionPolicy.maximumConnections` defaults to **1** — stricter than both by default; the demo's node types explicitly raise this to 64 |

## 4. UX elevations implemented (grounded in the research above)

1. **Alignment/snap guides rendered live during drag** — `EditorInteractionController`
   already emits `snapGuidesChanged` (grid/edge/center/port guides from
   `snapComponentDrag`); the demo previously discarded them. Now drawn as
   dashed pink/teal lines, draw.io-style.
2. **Wire-crossing "jump" gaps** — `engine.scene.crossings` (`RouteCrossing[]`)
   plus `document.settings.wireBridgeRadius` (a setting that already existed
   for exactly this purpose) are used to punch a small gap at unrelated wire
   intersections.
3. **Port hover glow + wire hover halo** — draw.io-style pre-drag affordance
   showing exactly what a click/drag will target.
4. **Palette search filter** — Node-RED-style type-to-filter box.
5. **Double-click empty canvas → quick-add popup** — type-to-filter, Enter/click
   to place (Node-RED's quick-add pattern).
6. **Arrow-key nudge** — selected node(s) move 1 unit (Shift = grid spacing).
7. **Node-RED-style port hover tooltip** (§4.2) — surfaces `PortSpec.label`/`.function`
   exactly like Node-RED's `inputLabels`/`outputLabels`, since the demo's ports
   already carried this data but nothing displayed it.
8. **draw.io-style clone-and-connect arrow** (§4.3) — hovering a node shows a
   small arrow past its east edge; clicking it clones the node and auto-wires
   `output → input` if both exist, mirroring draw.io's four-directional
   clone-connect arrows (simplified to one direction, since this flow layout
   is strictly left-to-right).

### 4.2 Port tooltip implementation notes
`updatePortTooltip()` reads the hovered port's `PortSpec` (`label`, optional
`function`) and geometry, positions a small fixed-style DOM tooltip at its
screen coordinate, and hides on `pointerleave`/gesture start — matching
Node-RED's "tooltip only, never baked into the body" behavior exactly.

### 4.3 Clone-arrow "dead zone" bug (found while testing this feature)
The clone arrow renders `CLONE_ARROW_OFFSET` (22 world units) past a node's
east edge. The first implementation kept the arrow's hover state "live" with
a small circular tolerance (`CLONE_ARROW_RADIUS + 4`) around the arrow's
center point. This left a **dead zone** between the node body's hit region
and the arrow's circular tolerance: a cursor passing through that gap (which
any reasonably fast or diagonal mouse movement will do) permanently cleared
`hoverState.componentId`, and — because the sticky check only reads the
*previous* hover state — it could never recover even after landing exactly on
the arrow.

**Fix:** replaced the circular tolerance with a contiguous rectangular strip
spanning from the node's right edge to just past the arrow (full height ±
tolerance), so there is no gap in coverage between "hovering the body" and
"hovering the arrow."

Verified directly against the engine (bypassing synthetic-mouse pixel
imprecision in headless testing): hovering a `function` node and invoking the
clone action increased the node count by 1 and the wire count by 1 (new node
correctly auto-wired); cloning an `inject` node (no input port) correctly
added the node without a wire, since there is nothing to wire it to.

## 5. Known limitations / not implemented

- Per-instance label overrides (Node-RED lets a user rename a port's tooltip
  label in the edit dialog) — out of scope for this demo.
- `sideFraction` / `pinBanks` (draw.io-style arbitrary fractional placement,
  CAD-style pinout banks) are supported by `editor-core` but unused by the
  demo's node types, which rely on side + auto layout only.
- The clone-and-connect arrow only covers the east direction (this flow's
  layout is strictly left-to-right); draw.io's four-directional version was
  not replicated.
