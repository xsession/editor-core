import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ComponentBuilder,
  HarnessEditorEngine,
  SequentialIdFactory,
  createEmptyDocument,
} from '../editor-core/index.js';

function twoComponents() {
  const left = new ComponentBuilder('X1', 'X1')
    .at(0, 0)
    .addBank({ id: 'b1', side: 'east', flow: 'forward', rowGap: 0, edgePadding: 8, collapseEmpty: false })
    .addPort({ id: 'P1', label: '1', side: 'east', bankId: 'b1' })
    .build();
  const right = new ComponentBuilder('X2', 'X2')
    .at(300, 0)
    .addBank({ id: 'b2', side: 'west', flow: 'forward', rowGap: 0, edgePadding: 8, collapseEmpty: false })
    .addPort({ id: 'P2', label: '1', side: 'west', bankId: 'b2' })
    .build();
  const document = createEmptyDocument('engine-test');
  document.components = { X1: left, X2: right };
  document.componentOrder = ['X1', 'X2'];
  return document;
}

test('engine connects, routes, previews, commits, undoes and redoes', () => {
  const engine = new HarnessEditorEngine(twoComponents(), { idFactory: new SequentialIdFactory() });
  const { wire } = engine.connectWire({
    source: { kind: 'port', componentId: 'X1', portId: 'P1' },
    target: { kind: 'port', componentId: 'X2', portId: 'P2' },
  });
  assert.ok(engine.document.wires[wire.id].route.points.length >= 2);
  const before = { ...engine.document.components.X1.position };
  engine.beginPreview('Move component', 'move:X1');
  engine.updatePreview((draft) => { draft.components.X1.position.x += 40; });
  assert.equal(engine.document.components.X1.position.x, before.x + 40);
  engine.commitPreview();
  assert.equal(engine.canUndo, true);
  engine.undo();
  assert.deepEqual(engine.document.components.X1.position, before);
  engine.redo();
  assert.equal(engine.document.components.X1.position.x, before.x + 40);
});

test('connected port removal can be prevented', () => {
  const engine = new HarnessEditorEngine(twoComponents(), { idFactory: new SequentialIdFactory() });
  engine.connectWire({ source: { kind: 'port', componentId: 'X1', portId: 'P1' }, target: { kind: 'port', componentId: 'X2', portId: 'P2' } });
  assert.throws(() => engine.replacePorts('X1', [], { connectedPortRemoval: 'prevent' }), /Cannot remove connected port/u);
});

test('connected port removal can detach the endpoint at its last visual position', () => {
  const engine = new HarnessEditorEngine(twoComponents(), { idFactory: new SequentialIdFactory() });
  const { wire } = engine.connectWire({ source: { kind: 'port', componentId: 'X1', portId: 'P1' }, target: { kind: 'port', componentId: 'X2', portId: 'P2' } });
  engine.replacePorts('X1', [], { connectedPortRemoval: 'detach' });
  assert.equal(engine.document.wires[wire.id].source.kind, 'free');
});

test('port removal can remap a connection by stable label', () => {
  const document = twoComponents();
  document.components.X1.ports[0].label = 'VBAT';
  const engine = new HarnessEditorEngine(document, { idFactory: new SequentialIdFactory() });
  const { wire } = engine.connectWire({ source: { kind: 'port', componentId: 'X1', portId: 'P1' }, target: { kind: 'port', componentId: 'X2', portId: 'P2' } });
  const replacement = { ...document.components.X1.ports[0], id: 'P1-new' };
  engine.replacePorts('X1', [replacement], { connectedPortRemoval: 'remap-by-label' });
  assert.equal(engine.document.wires[wire.id].source.portId, 'P1-new');
});

test('engine emits document and history events after a command', () => {
  const engine = new HarnessEditorEngine(twoComponents());
  let changed = 0;
  let history = 0;
  engine.on('documentChanged', () => { changed += 1; });
  engine.on('historyChanged', () => { history += 1; });
  engine.moveComponents(['X1'], { x: 10, y: 0 }, { snap: false });
  assert.equal(changed, 1);
  assert.equal(history, 1);
});

test('engine exposes preview activity for persistence and host adapters', () => {
  const engine = new HarnessEditorEngine(twoComponents());
  assert.equal(engine.isPreviewActive, false);
  engine.beginPreview('Move component');
  assert.equal(engine.isPreviewActive, true);
  engine.cancelPreview();
  assert.equal(engine.isPreviewActive, false);
});
