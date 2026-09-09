# Editor Behavior Matrix

This matrix defines the expected response to direct edits. A host may change key bindings but should preserve the model and history semantics.

| User action | Live response | Commit | Cancel/failure |
|---|---|---|---|
| Hover component | cursor and optional halo | none | halo clears |
| Click component | select and show inspector | selection event | unchanged document |
| Drag component | body, ports, attached routes, labels, guides update | one move command | exact pre-drag snapshot restored |
| Shift-drag component | dominant-axis lock | one move command | restore |
| Alt-drag component | no smart/grid snap | one move command | restore |
| Rotate component | all component geometry transforms; routes reattach | one rotate command | rejected when locked |
| Edit title/function | component remeasures and rows reflow | one merged edit command | invalid value remains staged by host |
| Add pin | component expands; new port becomes targetable | one edit command | no partial insertion |
| Remove unused pin | row disappears; component may shrink | one edit command | no effect when absent |
| Remove connected pin: prevent | show blocking reason | no command | document unchanged |
| Remove connected pin: detach | wire endpoint remains at last world point | one edit command | rollback on error |
| Remove connected pin: remap | wire reconnects by stable visible label | one edit command | fallback detach when no match |
| Drag source port | valid/invalid connection preview follows pointer | create wire at valid target | no wire on invalid release |
| Reconnect endpoint | old endpoint stays until valid target chosen | one reconnect command | old endpoint restored |
| Select wire | selection halo preserves engineering color | selection event | none |
| Drag route segment | segment translates orthogonally; adjacent elbows update | manual constraints written | original route restored |
| Add waypoint | route bends through point | one constraint command | remove preview point |
| Auto-route | preview optional; final route replaces unlocked manual points | one routing command | retain old route on failure policy |
| Change bend radius | corners update and clamp locally | one merged wire edit | invalid numeric value rejected |
| Change wire pattern | engineering layers update immediately | one merged wire edit | revert staged form |
| Drag automatic label | label becomes world-pinned | one label command | auto position restored |
| Reset label | candidate solver chooses best current location | one label command | none |
| Window marquee | fully enclosed objects preview-selected | selection event | clears rectangle |
| Crossing marquee | intersected objects preview-selected | selection event | clears rectangle |
| Group drag | relative spacing preserved | one command | complete group restored |
| Undo during idle | previous snapshot and derived scene restored | history pointer moves | none when stack empty |
| Escape during gesture | preview disappears | no command | pre-gesture state restored |
| Validation error | object receives independent diagnostic channel | persists until model fixed | never replaces wire color |

## Feedback timing classes

| Class | Target response | Examples |
|---|---:|---|
| Pointer feedback | same animation frame | cursor, target halo, drag transform, marquee |
| Fast derived preview | under 16–33 ms for typical scene | route preview, label reflow, snap guides |
| Deferred exact solve | worker/debounced | global reroute, large label solve, full DRC |
| Persistence | after commit; not in pointer loop | SQLite transaction, journal, autosave |

## Visual precedence

From outermost to innermost wire stroke:

1. hover/selection halo;
2. error/warning diagnostic dash;
3. contrast outline;
4. engineering color layers.

This ordering guarantees that selected red/white-striped wire remains identifiable as red/white-striped rather than becoming a generic blue line.
