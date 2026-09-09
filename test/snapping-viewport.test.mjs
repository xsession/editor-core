import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSampleEngine,
  fitViewportToBounds,
  screenToWorld,
  snapComponentDrag,
  worldToScreen,
  zoomViewportAt,
} from '../editor-core/index.js';

test('smart drag snapping aligns component centers or ports within screen tolerance', () => {
  const engine = createSampleEngine();
  const moving = engine.geometries.J1;
  const target = engine.geometries.A1;
  const proposed = { x: target.worldBounds.x - moving.worldBounds.x + 3, y: 0 };
  const result = snapComponentDrag(engine.geometries, ['J1'], proposed, {
    zoom: 1,
    tolerancePx: 8,
    gridSpacing: 10,
    enableGrid: false,
    enableAlignment: true,
    enablePortAlignment: false,
  });
  assert.ok(result.snappedX);
  assert.ok(Math.abs(result.correction.x) <= 8);
  assert.ok(result.guides.some((guide) => guide.axis === 'x'));
});

test('viewport world/screen conversions are reversible', () => {
  const viewport = { pan: { x: 120, y: 80 }, zoom: 2.5, width: 1000, height: 700 };
  const world = { x: 43, y: -12 };
  const screen = worldToScreen(world, viewport);
  const roundTrip = screenToWorld(screen, viewport);
  assert.ok(Math.abs(roundTrip.x - world.x) < 1e-9);
  assert.ok(Math.abs(roundTrip.y - world.y) < 1e-9);
});

test('zoom-at keeps the focal world position stationary', () => {
  const viewport = { pan: { x: 0, y: 0 }, zoom: 1, width: 800, height: 600 };
  const focal = { x: 200, y: 150 };
  const before = screenToWorld(focal, viewport);
  const zoomed = zoomViewportAt(viewport, focal, 2);
  const after = screenToWorld(focal, zoomed);
  assert.deepEqual(after, before);
});

test('fit viewport places content center in screen center', () => {
  const bounds = { x: 100, y: 200, width: 400, height: 200 };
  const viewport = fitViewportToBounds(bounds, { width: 1000, height: 800 }, { paddingPx: 50 });
  const centerScreen = worldToScreen({ x: 300, y: 300 }, viewport);
  assert.ok(Math.abs(centerScreen.x - 500) < 1e-9);
  assert.ok(Math.abs(centerScreen.y - 400) < 1e-9);
});
