# API Map

## Model and geometry

- `types.ts`: serializable editor model and public contracts.
- `ComponentBuilder`, `createConnector`: component construction helpers.
- `buildComponentGeometry`: text-aware dynamic component layout.
- `geometry.ts`: vectors, rectangles, polylines, intersections, safe rounded paths.

## Routing

- `routeWire`: route one wire in a context.
- `resolveEndpoint`: convert semantic endpoint to world point and normal.
- `moveOrthogonalSegment`: direct route manipulation.
- `createWaypointConstraint`: serializable waypoint helper.
- `routePinBankFanout`: ordered lane generation.
- `findWireCrossings`: crossing and bridge ownership.

## Labels

- `placeLabel`, `placeLabels`: candidate-based placement.
- `pinLabelToWorld`, `resetLabelToAutomatic`: interaction transitions.
- `labelPlacementBounds`: aggregate bounds.

## Editor state

- `HarnessEditorEngine`: commands, history, previews, mutation policy, derived state.
- `createEmptyDocument`: default document.
- `SequentialIdFactory`, `DefaultIdFactory`: IDs.
- `SnapshotHistory`: generic snapshot history.
- `TransactionalCommandHistory`: independent command/transaction manager.

## Interaction and viewport

- `EditorInteractionController`: pointer/keyboard state machine.
- `hitTestDocument`, `marqueeSelect`: selection primitives.
- `snapComponentDrag`: grid/alignment/port snapping.
- `ViewportController`, `worldToScreen`, `screenToWorld`, `zoomViewportAt`, `fitViewportToBounds`.

## Scene, validation, rendering

- `deriveEditorScene`: pure derived-state pipeline.
- `validateDocument`: diagnostics.
- `renderEditorSvg`: full deterministic SVG.
- `resolveWirePaint`: semantic stroke layer resolution.
- `DEFAULT_EDITOR_THEME`, `DEFAULT_LIGHT_THEME`, `DEFAULT_DARK_THEME`.

## Persistence

- `serializeDocument`: stable-key JSON.
- `parseDocument`: version and required-collection checks.
- `cloneDocument`: detached copy.
