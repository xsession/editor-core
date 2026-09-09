import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ComponentBuilder,
  buildComponentGeometry,
  createConnector,
  intersectionArea,
  rectContainsRect,
  rotateComponent,
} from '../editor-core/index.js';

test('dynamic component geometry grows to fit labels and pin banks', () => {
  const component = new ComponentBuilder('X1', 'X1')
    .at(100, 200)
    .withLabels({ title: 'LONG CONNECTOR DESIGNATOR', subtitle: '32-position sealed connector' })
    .addBank({ id: 'west', side: 'west', flow: 'forward', rowGap: 2, edgePadding: 12, collapseEmpty: false })
    .addBank({ id: 'east', side: 'east', flow: 'reverse', rowGap: 2, edgePadding: 12, collapseEmpty: false })
    .addPorts(8, { side: 'west', bankId: 'west', label: (i) => `A${i + 1}`, function: (i) => `INPUT_${i + 1}` })
    .addPorts(8, { side: 'east', bankId: 'east', label: (i) => `B${i + 1}`, function: (i) => `OUTPUT_${i + 1}` })
    .build();
  const geometry = buildComponentGeometry(component);
  assert.ok(geometry.worldBody.width >= component.layout.minimumSize.width);
  assert.ok(geometry.worldBody.height > component.layout.minimumSize.height);
  assert.equal(Object.keys(geometry.ports).length, 16);
  assert.ok(geometry.worldBounds.width > geometry.worldBody.width);
});

test('collapse-empty banks retain only connected ports', () => {
  const component = new ComponentBuilder('X2', 'X2')
    .addBank({ id: 'bank', side: 'east', flow: 'forward', rowGap: 0, edgePadding: 8, collapseEmpty: true })
    .addPorts(4, { side: 'east', bankId: 'bank' })
    .build();
  const connected = new Set(['X2:p2', 'X2:p4']);
  const geometry = buildComponentGeometry(component, { connectedPortIds: connected });
  assert.deepEqual(Object.keys(geometry.ports).sort(), ['X2:p2', 'X2:p4']);
});

test('component rotation moves port sides, normals and bounds together', () => {
  const original = createConnector('X3', 'X3', 3, { x: 20, y: 30 }, 'east');
  const rotated = rotateComponent(original, true);
  const before = buildComponentGeometry(original);
  const after = buildComponentGeometry(rotated);
  assert.equal(rotated.rotation, 90);
  assert.equal(after.ports['X3:p1'].side, 'south');
  assert.ok(Math.abs(after.ports['X3:p1'].normal.y - 1) < 1e-9);
  assert.equal(after.worldBody.width, before.worldBody.height);
  assert.equal(after.worldBody.height, before.worldBody.width);
});

test('explicit side fractions and offsets are honored', () => {
  const component = new ComponentBuilder('X4', 'X4')
    .withSize(200, 120)
    .addPort({ id: 'P', label: 'P', side: 'north' })
    .build();
  component.ports[0].sideFraction = 0.75;
  component.ports[0].tangentOffset = 5;
  component.ports[0].normalOffset = 7;
  const geometry = buildComponentGeometry(component);
  const port = geometry.ports.P;
  assert.ok(port.center.x > geometry.worldBody.x + geometry.worldBody.width / 2);
  assert.ok(port.center.y < geometry.worldBody.y);
});

function interiorsOverlap(a, b, epsilon = 0.01) {
  return a.x < b.x + b.width - epsilon
    && a.x + a.width > b.x + epsilon
    && a.y < b.y + b.height - epsilon
    && a.y + a.height > b.y + epsilon;
}

test('mixed-side pin labels and functions receive collision-free layout bands', () => {
  const component = new ComponentBuilder('MIXED', 'J?')
    .at(40, 40)
    .withLabels({ title: 'Custom Connector', subtitle: 'CUSTOM' })
    .addBank({ id: 'west', side: 'west', flow: 'forward', rowGap: 2, edgePadding: 12, collapseEmpty: false })
    .addBank({ id: 'east', side: 'east', flow: 'forward', rowGap: 2, edgePadding: 12, collapseEmpty: false })
    .addBank({ id: 'north', side: 'north', flow: 'forward', rowGap: 2, edgePadding: 12, collapseEmpty: false })
    .addBank({ id: 'south', side: 'south', flow: 'forward', rowGap: 2, edgePadding: 12, collapseEmpty: false })
    .addPort({ id: 'w1', label: '1', function: 'SIGNAL_OUTPUT_LONG', side: 'west', bankId: 'west' })
    .addPort({ id: 'w2', label: '7', function: 'SECOND_WEST_LONG', side: 'west', bankId: 'west' })
    .addPort({ id: 'e1', label: '3', function: 'EAST_INPUT_LONG', side: 'east', bankId: 'east' })
    .addPort({ id: 'e2', label: '4', function: 'EAST_RETURN_LONG', side: 'east', bankId: 'east' })
    .addPort({ id: 'n1', label: '2', function: 'NORTH_CONTROL_LONG', side: 'north', bankId: 'north' })
    .addPort({ id: 's1', label: '5', function: 'SOUTH_ENABLE_LONG', side: 'south', bankId: 'south' })
    .addPort({ id: 's2', label: '6', function: 'SOUTH_DIAGNOSTIC_LONG', side: 'south', bankId: 'south' })
    .build();

  const geometry = buildComponentGeometry(component);
  const textBounds = [];
  for (const port of Object.values(geometry.ports)) {
    if (port.labelBounds) textBounds.push({ id: `${port.portId}:label`, side: port.side, bounds: port.labelBounds });
    if (port.functionBounds) textBounds.push({ id: `${port.portId}:function`, side: port.side, bounds: port.functionBounds });
  }

  for (let left = 0; left < textBounds.length; left += 1) {
    for (let right = left + 1; right < textBounds.length; right += 1) {
      assert.equal(
        interiorsOverlap(textBounds[left].bounds, textBounds[right].bounds),
        false,
        `${textBounds[left].id} overlaps ${textBounds[right].id}`,
      );
    }
  }

  for (const port of Object.values(geometry.ports)) {
    if (port.side === 'north') {
      assert.equal(interiorsOverlap(port.labelBounds, geometry.headerBounds), false);
      if (port.functionBounds) assert.equal(interiorsOverlap(port.functionBounds, geometry.headerBounds), false);
    }
  }
  assert.ok(geometry.worldBody.width > component.layout.minimumSize.width, 'long opposing-side text should grow the component width');
  assert.ok(geometry.worldBody.height > component.layout.minimumSize.height, 'mixed-side pin bands should grow the component height');
});

test('mixed-side pin mapping reserves independent label bands without overlaps', () => {
  const component = new ComponentBuilder('X5', 'X5')
    .withLabels({ title: 'Four-sided service connector', subtitle: 'MIXED PIN BANKS' })
    .addBank({ id: 'west', side: 'west', flow: 'forward', rowGap: 2, edgePadding: 12, collapseEmpty: false })
    .addBank({ id: 'north', side: 'north', flow: 'forward', rowGap: 2, edgePadding: 12, collapseEmpty: false })
    .addBank({ id: 'east', side: 'east', flow: 'forward', rowGap: 2, edgePadding: 12, collapseEmpty: false })
    .addBank({ id: 'south', side: 'south', flow: 'forward', rowGap: 2, edgePadding: 12, collapseEmpty: false })
    .addPort({ id: 'P1', label: '1', function: 'LONG_WEST_FUNCTION', side: 'west', bankId: 'west' })
    .addPort({ id: 'P2', label: '2', function: 'NORTH_SERVICE', side: 'north', bankId: 'north' })
    .addPort({ id: 'P3', label: '3', function: 'EAST_OUTPUT_A', side: 'east', bankId: 'east' })
    .addPort({ id: 'P4', label: '4', function: 'EAST_OUTPUT_B', side: 'east', bankId: 'east' })
    .addPort({ id: 'P5', label: '5', function: 'SOUTH_RETURN', side: 'south', bankId: 'south' })
    .addPort({ id: 'P6', label: '6', function: 'EAST_OUTPUT_C', side: 'east', bankId: 'east' })
    .addPort({ id: 'P7', label: '7', function: 'WEST_DIAGNOSTIC', side: 'west', bankId: 'west' })
    .build();
  const geometry = buildComponentGeometry(component);
  const textBounds = Object.values(geometry.ports).flatMap((port) => [port.labelBounds, port.functionBounds].filter(Boolean));

  for (const bounds of textBounds) {
    assert.ok(rectContainsRect(geometry.worldBody, bounds), 'pin text must remain inside the component body');
    assert.equal(intersectionArea(bounds, geometry.headerBounds), 0, 'pin text must not overlap the title header');
  }
  for (let first = 0; first < textBounds.length; first += 1) {
    for (let second = first + 1; second < textBounds.length; second += 1) {
      assert.equal(intersectionArea(textBounds[first], textBounds[second]), 0, 'pin label/function rectangles must not overlap');
    }
  }
});

test('stale pin-bank membership follows the edited port side exactly once', () => {
  const component = new ComponentBuilder('X6', 'X6')
    .addBank({ id: 'west', side: 'west', flow: 'forward', rowGap: 0, edgePadding: 8, collapseEmpty: false })
    .addBank({ id: 'east', side: 'east', flow: 'forward', rowGap: 0, edgePadding: 8, collapseEmpty: false })
    .addPort({ id: 'P1', label: '1', function: 'MOVED', side: 'west', bankId: 'west' })
    .addPort({ id: 'P2', label: '2', function: 'FIXED', side: 'east', bankId: 'east' })
    .build();
  component.ports.find((port) => port.id === 'P1').side = 'east';
  // Deliberately keep P1 in the old west bank to model an incremental UI edit.
  const geometry = buildComponentGeometry(component);
  assert.deepEqual(Object.keys(geometry.ports).sort(), ['P1', 'P2']);
  assert.equal(geometry.ports.P1.side, 'east');
  assert.equal(geometry.ports.P2.side, 'east');
  assert.equal(intersectionArea(geometry.ports.P1.rowBounds, geometry.ports.P2.rowBounds), 0);
});
