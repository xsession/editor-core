import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EditorInteractionController,
  createSampleEngine,
  hitTestDocument,
  marqueeSelect,
  rectCenter,
} from '../editor-core/index.js';

const modifiers = { shift: false, alt: false, ctrl: false, meta: false, space: false };
function pointer(point, overrides = {}) {
  return {
    pointerId: 1,
    point,
    screenPoint: point,
    button: 0,
    buttons: 1,
    pointerType: 'mouse',
    pressure: 0.5,
    modifiers,
    timestamp: Date.now(),
    ...overrides,
  };
}

test('hit testing prioritizes ports over component bodies', () => {
  const engine = createSampleEngine();
  const port = engine.geometries.J1.ports['J1:1'];
  const hits = hitTestDocument(engine.document, port.center, {
    componentGeometries: engine.geometries,
    labelPlacements: engine.labelPlacements,
    zoom: 1,
    hitTolerancePx: 8,
    includeRouteHandles: true,
  });
  assert.equal(hits[0].kind, 'port');
  assert.equal(hits[0].subId, 'J1:1');
});

test('window marquee requires containment while crossing marquee accepts intersection', () => {
  const engine = createSampleEngine();
  const geometry = engine.geometries.J1;
  const partial = { x: geometry.worldBounds.x, y: geometry.worldBounds.y, width: geometry.worldBounds.width / 2, height: geometry.worldBounds.height };
  const window = marqueeSelect(engine.document, partial, 'window', { componentGeometries: engine.geometries, labelPlacements: engine.labelPlacements });
  const crossing = marqueeSelect(engine.document, partial, 'crossing', { componentGeometries: engine.geometries, labelPlacements: engine.labelPlacements });
  assert.equal(window.some((item) => item.kind === 'component' && item.id === 'J1'), false);
  assert.equal(crossing.some((item) => item.kind === 'component' && item.id === 'J1'), true);
});

test('interaction controller performs a previewed component drag and commit', () => {
  const engine = createSampleEngine();
  const controller = new EditorInteractionController(engine, { zoom: () => 1 });
  const center = rectCenter(engine.geometries.A1.headerBounds);
  const startX = engine.document.components.A1.position.x;
  controller.pointerDown(pointer(center));
  controller.pointerMove(pointer({ x: center.x + 43, y: center.y + 1 }));
  controller.pointerUp(pointer({ x: center.x + 43, y: center.y + 1 }, { buttons: 0 }));
  assert.ok(engine.document.components.A1.position.x > startX + 30);
  assert.equal(engine.canUndo, true);
});

test('interaction controller connects two currently unused ports', () => {
  const engine = createSampleEngine();
  const controller = new EditorInteractionController(engine, { zoom: () => 1 });
  const source = engine.geometries.J1.ports['J1:6'].center;
  const target = engine.geometries.J2.ports['J2:3'].center;
  const before = engine.document.wireOrder.length;
  controller.pointerDown(pointer(source));
  controller.pointerMove(pointer(target));
  controller.pointerUp(pointer(target, { buttons: 0 }));
  assert.equal(engine.document.wireOrder.length, before + 1);
});
