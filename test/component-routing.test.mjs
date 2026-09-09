import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ComponentBuilder,
  buildComponentGeometry,
  DEFAULT_ROUTING_OPTIONS,
  DEFAULT_WIRE_STYLE,
  routeWire,
  routePinBankFanout,
  roundedOrthogonalPath,
  validateRouteClearance,
  moveOrthogonalSegment,
} from '../editor-core/index.js';

function connector(id, x, y, side, count, rotation = 0) {
  const bankId = `${id}:bank`;
  return new ComponentBuilder(id, id, 'connector')
    .at(x, y)
    .rotate(rotation)
    .withLabels({ title: id, subtitle: `${count} positions` })
    .addBank({ id: bankId, side, flow: 'forward', rowGap: 2, edgePadding: 10, collapseEmpty: false })
    .addPorts(count, { side, bankId, id: (index) => `${id}:${index + 1}` })
    .build();
}

test('dynamic component build-up grows with pin count and keeps ordered ports', () => {
  const small = connector('J1', 100, 100, 'east', 2);
  const large = connector('J2', 100, 100, 'east', 12);
  const smallGeometry = buildComponentGeometry(small);
  const largeGeometry = buildComponentGeometry(large);

  assert.ok(largeGeometry.worldBody.height > smallGeometry.worldBody.height);
  assert.equal(Object.keys(largeGeometry.ports).length, 12);
  const yValues = Object.values(largeGeometry.ports).map((port) => port.center.y);
  assert.deepEqual(yValues, [...yValues].sort((a, b) => a - b));
  assert.ok(Object.values(largeGeometry.ports).every((port) => port.normal.x === 1 && port.normal.y === 0));
});

test('rotation transforms component port position, side, normal, and body bounds', () => {
  const normal = connector('J1', 200, 200, 'east', 3, 0);
  const rotated = connector('J2', 200, 200, 'east', 3, 90);
  const a = buildComponentGeometry(normal);
  const b = buildComponentGeometry(rotated);

  assert.equal(a.ports['J1:1'].side, 'east');
  assert.equal(b.ports['J2:1'].side, 'south');
  assert.ok(Math.abs(b.ports['J2:1'].normal.x) < 1e-9);
  assert.equal(b.ports['J2:1'].normal.y, 1);
  assert.equal(Math.round(a.worldBody.width), Math.round(b.worldBody.height));
  assert.equal(Math.round(a.worldBody.height), Math.round(b.worldBody.width));
});

test('collapse-empty pin bank only builds connected port geometry', () => {
  const component = connector('J1', 0, 0, 'east', 6);
  component.pinBanks[0].collapseEmpty = true;
  const geometry = buildComponentGeometry(component, { connectedPortIds: new Set(['J1:2', 'J1:5']) });
  assert.deepEqual(Object.keys(geometry.ports).sort(), ['J1:2', 'J1:5']);
});

test('orthogonal obstacle routing avoids inflated keep-out rectangles', () => {
  const wire = {
    id: 'W1',
    kind: 'discrete',
    source: { kind: 'free', point: { x: 0, y: 0 } },
    target: { kind: 'free', point: { x: 200, y: 0 } },
    routing: { ...DEFAULT_ROUTING_OPTIONS, grid: 10, clearance: 10, requestedRadius: 12, constraints: [] },
    style: { ...DEFAULT_WIRE_STYLE },
    locked: false,
    hidden: false,
  };
  const obstacle = { id: 'BLOCK', rect: { x: 80, y: -30, width: 40, height: 60 }, kind: 'component' };
  const route = routeWire(wire, { componentGeometries: {}, obstacles: [obstacle] });

  assert.equal(route.status, 'valid');
  assert.deepEqual(route.obstacleViolations, []);
  assert.ok(route.points.length >= 4);
  assert.ok(route.points.some((point) => Math.abs(point.y) >= 40));
  assert.deepEqual(validateRouteClearance(route.points, [obstacle], 0), []);
});

test('wire lead-ins leave component ports in the outward normal direction', () => {
  const source = connector('J1', 100, 100, 'east', 1);
  const target = connector('J2', 500, 100, 'west', 1);
  const sourceGeometry = buildComponentGeometry(source);
  const targetGeometry = buildComponentGeometry(target);
  const wire = {
    id: 'W1',
    kind: 'discrete',
    source: { kind: 'port', componentId: 'J1', portId: 'J1:1' },
    target: { kind: 'port', componentId: 'J2', portId: 'J2:1' },
    routing: { ...DEFAULT_ROUTING_OPTIONS, leadIn: 24, clearance: 10, constraints: [] },
    style: { ...DEFAULT_WIRE_STYLE },
    locked: false,
    hidden: false,
  };
  const route = routeWire(wire, {
    componentGeometries: { J1: sourceGeometry, J2: targetGeometry },
    obstacles: [
      { id: 'J1', rect: sourceGeometry.worldBody, kind: 'component' },
      { id: 'J2', rect: targetGeometry.worldBody, kind: 'component' },
    ],
  });

  assert.equal(route.status, 'valid');
  assert.ok(route.points[1].x > route.points[0].x);
  assert.ok(route.points.at(-2).x < route.points.at(-1).x);
  assert.equal(route.points[1].y, route.points[0].y);
  assert.equal(route.points.at(-2).y, route.points.at(-1).y);
});

test('rounded path clamps corner radius to available adjacent segment length', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 4 },
    { x: 30, y: 4 },
  ];
  const rounded = roundedOrthogonalPath(points, 20);
  assert.ok(rounded.path.includes(' A '));
  assert.ok(rounded.radii[1] <= 5 + 1e-6);
  assert.ok(rounded.radii[2] <= 2 + 1e-6);
});

test('fanout routes produce deterministic separated lanes', () => {
  const pairs = [0, 1, 2, 3].map((index) => ({
    id: `W${index}`,
    source: { x: 0, y: index * 20 },
    target: { x: 200, y: index * 20 + 5 },
  }));
  const routes = routePinBankFanout(pairs, { orientation: 'horizontal', laneSpacing: 12, centerCoordinate: 100 });
  assert.equal(routes.size, 4);
  const trunkX = [...routes.values()].map((points) => points[1].x);
  assert.equal(new Set(trunkX).size, 4);
  assert.deepEqual(routePinBankFanout(pairs, { orientation: 'horizontal', laneSpacing: 12, centerCoordinate: 100 }), routes);
});

test('orthogonal segment dragging keeps anchored endpoints and creates doglegs', () => {
  const original = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 80 },
  ];
  const moved = moveOrthogonalSegment(original, 0, { x: 0, y: 20 });
  assert.deepEqual(moved[0], original[0]);
  assert.deepEqual(moved.at(-1), original.at(-1));
  assert.ok(moved.some((point) => point.y === 20));
});
