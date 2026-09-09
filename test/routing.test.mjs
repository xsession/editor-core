import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ROUTING_OPTIONS,
  computeSafeCornerRadii,
  createWaypointConstraint,
  findWireCrossings,
  polylineIntersectsRect,
  routePinBankFanout,
  routeWire,
} from '../editor-core/index.js';

function freeWire(id, source, target, overrides = {}) {
  return {
    id,
    kind: 'discrete',
    source: { kind: 'free', point: source, direction: 'east' },
    target: { kind: 'free', point: target, direction: 'west' },
    routing: { ...DEFAULT_ROUTING_OPTIONS, grid: 10, clearance: 10, constraints: [], ...overrides },
    style: { pattern: { kind: 'solid', color: '#000000' }, width: 3, outlineWidth: 1, opacity: 1, lineCap: 'round', lineJoin: 'round', zIndex: 0 },
    locked: false,
    hidden: false,
  };
}

test('orthogonal router avoids inflated component obstacles', () => {
  const obstacle = { id: 'block', rect: { x: 90, y: -30, width: 80, height: 60 }, kind: 'component' };
  const route = routeWire(freeWire('W1', { x: 0, y: 0 }, { x: 260, y: 0 }), {
    componentGeometries: {},
    obstacles: [obstacle],
  });
  assert.equal(route.status, 'valid');
  assert.ok(route.points.length >= 4);
  assert.equal(polylineIntersectsRect(route.points, { x: 80, y: -40, width: 100, height: 80 }), false);
  assert.ok(route.segments.every((segment) => segment.axis !== 'diagonal'));
});

test('manual waypoints remain in the routed polyline', () => {
  const wire = freeWire('W2', { x: 0, y: 0 }, { x: 200, y: 100 }, {
    pattern: 'manual',
    constraints: [createWaypointConstraint('wp', { x: 100, y: -50 }, true)],
  });
  const route = routeWire(wire, { componentGeometries: {}, obstacles: [] });
  assert.ok(route.points.some((point) => point.x === 100 && point.y === -50));
  assert.equal(route.status, 'valid');
});

test('safe corner radii are clamped by adjacent segment lengths', () => {
  const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 100 }];
  const radii = computeSafeCornerRadii(points, 50);
  assert.ok(radii[1] <= 5 + 1e-6);
  assert.ok(radii[1] > 4.9);
});

test('pin-bank fanout produces ordered, distinct lanes', () => {
  const pairs = [0, 1, 2, 3].map((index) => ({
    id: `W${index}`,
    source: { x: 0, y: index * 20 },
    target: { x: 300, y: (3 - index) * 20 },
  }));
  const routes = routePinBankFanout(pairs, { orientation: 'horizontal', laneSpacing: 12 });
  const laneCoordinates = [...routes.values()].map((points) => points[1].x);
  assert.equal(new Set(laneCoordinates).size, 4);
});

test('crossing resolver uses wire z-order to pick the bridge wire', () => {
  const a = freeWire('A', { x: 0, y: 50 }, { x: 100, y: 50 });
  const b = freeWire('B', { x: 50, y: 0 }, { x: 50, y: 100 });
  a.route = { points: [{ x: 0, y: 50 }, { x: 100, y: 50 }], segments: [{ start: { x: 0, y: 50 }, end: { x: 100, y: 50 }, axis: 'horizontal', length: 100 }], cornerRadii: [0, 0], length: 100, bends: 0, crossings: 1, obstacleViolations: [], status: 'valid', diagnostics: [] };
  b.route = { points: [{ x: 50, y: 0 }, { x: 50, y: 100 }], segments: [{ start: { x: 50, y: 0 }, end: { x: 50, y: 100 }, axis: 'vertical', length: 100 }], cornerRadii: [0, 0], length: 100, bends: 0, crossings: 1, obstacleViolations: [], status: 'valid', diagnostics: [] };
  b.style.zIndex = 10;
  const [crossing] = findWireCrossings([a, b]);
  assert.equal(crossing.overWire, 'B');
  assert.deepEqual(crossing.point, { x: 50, y: 50 });
});

test('safe corner radii preserve the exact requested value when no obstacle requires clamping', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 20 },
  ];
  const radii = computeSafeCornerRadii(points, 6);
  assert.equal(radii[1], 6);
});
