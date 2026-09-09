import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ComponentBuilder,
  EditorInteractionController,
  HarnessEditorEngine,
  SequentialIdFactory,
  createEmptyDocument,
  createSampleEngine,
} from '../editor-core/index.js';

const modifiers = (extra = {}) => ({ shift: false, alt: false, ctrl: false, meta: false, space: false, ...extra });
const pointer = (point, extra = {}) => ({
  pointerId: 1,
  point,
  screenPoint: point,
  button: 0,
  buttons: 1,
  pointerType: 'mouse',
  pressure: 0.5,
  modifiers: modifiers(),
  timestamp: Date.now(),
  ...extra,
});

function twoUnconnectedComponents() {
  const document = createEmptyDocument('interaction-test');
  const left = new ComponentBuilder('J1', 'J1')
    .at(100, 100)
    .addBank({ id: 'J1:e', side: 'east', flow: 'forward', rowGap: 0, edgePadding: 10, collapseEmpty: false })
    .addPort({ id: 'J1:1', label: '1', side: 'east', bankId: 'J1:e', connectionPolicy: { maximumConnections: 2 } })
    .build();
  const right = new ComponentBuilder('J2', 'J2')
    .at(500, 100)
    .addBank({ id: 'J2:w', side: 'west', flow: 'forward', rowGap: 0, edgePadding: 10, collapseEmpty: false })
    .addPort({ id: 'J2:1', label: '1', side: 'west', bankId: 'J2:w', connectionPolicy: { maximumConnections: 2 } })
    .build();
  document.components = { J1: left, J2: right };
  document.componentOrder = ['J1', 'J2'];
  return new HarnessEditorEngine(document, { idFactory: new SequentialIdFactory() });
}

test('component mutation prevents connected port removal by default', () => {
  const engine = createSampleEngine();
  assert.throws(
    () => engine.updateComponent('J1', (component) => {
      component.ports = component.ports.filter((port) => port.id !== 'J1:1');
    }),
    /Cannot remove connected port/u,
  );
  assert.ok(engine.document.components.J1.ports.some((port) => port.id === 'J1:1'));
});

test('component mutation can detach affected wires and undo restores connectivity', () => {
  const engine = createSampleEngine();
  engine.updateComponent('J1', (component) => {
    component.ports = component.ports.filter((port) => port.id !== 'J1:1');
    component.pinBanks[0].portIds = component.pinBanks[0].portIds.filter((id) => id !== 'J1:1');
  }, { connectedPortRemoval: 'detach' });

  assert.equal(engine.document.wires.W1.source.kind, 'free');
  assert.equal(engine.canUndo, true);
  engine.undo();
  assert.deepEqual(engine.document.wires.W1.source, { kind: 'port', componentId: 'J1', portId: 'J1:1' });
  engine.redo();
  assert.equal(engine.document.wires.W1.source.kind, 'free');
});

test('remap-by-label preserves connections when a port receives a new identity', () => {
  const engine = createSampleEngine();
  engine.updateComponent('J1', (component) => {
    const old = component.ports.find((port) => port.id === 'J1:1');
    component.ports = component.ports.filter((port) => port.id !== 'J1:1');
    component.ports.push({ ...old, id: 'J1:1-new' });
    component.pinBanks[0].portIds = component.pinBanks[0].portIds.map((id) => id === 'J1:1' ? 'J1:1-new' : id);
  }, { connectedPortRemoval: 'remap-by-label' });
  assert.deepEqual(engine.document.wires.W1.source, { kind: 'port', componentId: 'J1', portId: 'J1:1-new' });
});

test('preview transaction updates derived wires, then cancel restores exact state', () => {
  const engine = createSampleEngine();
  const before = engine.toJSON(false);
  const oldRoute = engine.document.wires.W1.route.points.map((point) => ({ ...point }));
  engine.beginPreview('Move component');
  engine.updatePreview((draft) => {
    draft.components.J1.position.x += 100;
  });
  assert.notDeepEqual(engine.document.wires.W1.route.points, oldRoute);
  engine.cancelPreview();
  assert.equal(engine.toJSON(false), before);
});

test('interaction controller drags selected component as one undoable gesture', () => {
  const engine = twoUnconnectedComponents();
  const controller = new EditorInteractionController(engine, { zoom: () => 1 });
  const start = { ...engine.document.components.J1.position };
  const body = engine.geometries.J1.worldBody;
  const downPoint = { x: body.x + body.width / 2, y: body.y + 10 };
  controller.pointerDown(pointer(downPoint));
  controller.pointerMove(pointer({ x: downPoint.x + 43, y: downPoint.y + 27 }));
  controller.pointerUp(pointer({ x: downPoint.x + 43, y: downPoint.y + 27 }, { buttons: 0 }));

  assert.notDeepEqual(engine.document.components.J1.position, start);
  assert.equal(engine.document.revision, 1);
  engine.undo();
  assert.deepEqual(engine.document.components.J1.position, start);
});

test('interaction controller connects two ports and respects connection validation', () => {
  const engine = twoUnconnectedComponents();
  const controller = new EditorInteractionController(engine, { zoom: () => 1 });
  const source = engine.geometries.J1.ports['J1:1'].center;
  const target = engine.geometries.J2.ports['J2:1'].center;
  controller.pointerDown(pointer(source));
  controller.pointerMove(pointer(target));
  controller.pointerUp(pointer(target, { buttons: 0 }));

  assert.equal(engine.document.wireOrder.length, 1);
  const wire = engine.document.wires[engine.document.wireOrder[0]];
  assert.equal(wire.route.status, 'valid');
  assert.deepEqual(wire.source, { kind: 'port', componentId: 'J1', portId: 'J1:1' });
  assert.deepEqual(wire.target, { kind: 'port', componentId: 'J2', portId: 'J2:1' });
});

test('selection keyboard commands rotate and undo', () => {
  const engine = twoUnconnectedComponents();
  const controller = new EditorInteractionController(engine, { zoom: () => 1 });
  engine.select([{ kind: 'component', id: 'J1' }]);
  assert.equal(controller.keyDown('r', modifiers()), true);
  assert.equal(engine.document.components.J1.rotation, 90);
  assert.equal(controller.keyDown('z', modifiers({ ctrl: true })), true);
  assert.equal(engine.document.components.J1.rotation, 0);
});
