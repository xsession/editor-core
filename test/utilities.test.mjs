import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UniformGridIndex,
  createSampleEngine,
  deriveEditorScene,
  fitViewportToBounds,
  hitTestDocument,
  marqueeSelect,
  screenToWorld,
  snapComponentDrag,
  worldToScreen,
  zoomViewportAt,
} from '../editor-core/index.js';

test('uniform grid index supports insertion, update, query, and removal', () => {
  const index = new UniformGridIndex(50);
  index.insert({ id: 'a', bounds: { x: 0, y: 0, width: 20, height: 20 }, value: 1 });
  index.insert({ id: 'b', bounds: { x: 100, y: 100, width: 20, height: 20 }, value: 2 });
  assert.deepEqual(index.queryPoint({ x: 10, y: 10 }).map((entry) => entry.id), ['a']);
  index.update({ id: 'a', bounds: { x: 90, y: 90, width: 20, height: 20 }, value: 3 });
  assert.deepEqual(index.queryRect({ x: 80, y: 80, width: 60, height: 60 }).map((entry) => entry.id).sort(), ['a', 'b']);
  assert.equal(index.remove('b'), true);
  assert.equal(index.size, 1);
});

test('hit testing gives a port precedence over its component body', () => {
  const engine = createSampleEngine();
  const port = engine.geometries.J1.ports['J1:1'];
  const hits = hitTestDocument(engine.document, port.center, {
    componentGeometries: engine.geometries,
    labelPlacements: engine.labelPlacements,
    zoom: 1,
    hitTolerancePx: 7,
    includeRouteHandles: true,
  });
  assert.equal(hits[0].kind, 'port');
  assert.equal(hits[0].entityId, 'J1');
  assert.equal(hits[0].subId, 'J1:1');
});

test('marquee window and crossing selection follow CAD semantics', () => {
  const engine = createSampleEngine();
  const geometry = engine.geometries.J1;
  const windowSelection = marqueeSelect(engine.document, {
    x: geometry.worldBounds.x - 1,
    y: geometry.worldBounds.y - 1,
    width: geometry.worldBounds.width + 2,
    height: geometry.worldBounds.height + 2,
  }, 'window', { componentGeometries: engine.geometries, labelPlacements: engine.labelPlacements });
  assert.ok(windowSelection.some((item) => item.kind === 'component' && item.id === 'J1'));

  const crossingSelection = marqueeSelect(engine.document, {
    x: geometry.worldBody.x + geometry.worldBody.width - 2,
    y: geometry.worldBody.y,
    width: 4,
    height: geometry.worldBody.height,
  }, 'crossing', { componentGeometries: engine.geometries, labelPlacements: engine.labelPlacements });
  assert.ok(crossingSelection.some((item) => item.kind === 'component' && item.id === 'J1'));
});

test('component drag snapping returns absolute corrected delta and guide metadata', () => {
  const engine = createSampleEngine();
  const snapped = snapComponentDrag(engine.geometries, ['J1'], { x: 13, y: 17 }, {
    zoom: 1,
    gridSpacing: 10,
    enableGrid: true,
    enableAlignment: false,
    enablePortAlignment: false,
    primaryComponentId: 'J1',
  });
  assert.equal(snapped.snappedX, true);
  assert.equal(snapped.snappedY, true);
  assert.equal(snapped.guides.length, 2);
  assert.deepEqual(snapped.delta, { x: 15, y: 15 });
});

test('viewport transforms round-trip and zoom preserves focal world point', () => {
  const viewport = { pan: { x: 40, y: -10 }, zoom: 2, width: 1000, height: 600 };
  const world = { x: 123, y: 77 };
  const screen = worldToScreen(world, viewport);
  assert.deepEqual(screenToWorld(screen, viewport), world);
  const focal = { x: 400, y: 300 };
  const before = screenToWorld(focal, viewport);
  const zoomed = zoomViewportAt(viewport, focal, 1.5);
  const after = screenToWorld(focal, zoomed);
  assert.ok(Math.abs(before.x - after.x) < 1e-9);
  assert.ok(Math.abs(before.y - after.y) < 1e-9);
});

test('fit viewport encloses derived scene content with padding', () => {
  const engine = createSampleEngine();
  const scene = deriveEditorScene(engine.document);
  const viewport = fitViewportToBounds(scene.contentBounds, { width: 1200, height: 700 }, { paddingPx: 50 });
  const topLeft = worldToScreen({ x: scene.contentBounds.x, y: scene.contentBounds.y }, viewport);
  const bottomRight = worldToScreen({ x: scene.contentBounds.x + scene.contentBounds.width, y: scene.contentBounds.y + scene.contentBounds.height }, viewport);
  assert.ok(topLeft.x >= 49 && topLeft.y >= 49);
  assert.ok(bottomRight.x <= 1151 && bottomRight.y <= 651);
});
