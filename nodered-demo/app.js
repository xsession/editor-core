import {
  HarnessEditorEngine,
  createEmptyDocument,
  EditorInteractionController,
  ViewportController,
  viewportWorldRect,
  buildVisualRenderPlan,
  Canvas2DRenderer,
  hitTestDocument,
} from '../editor-core/index.js';
import { NODE_TYPES, CATEGORIES, createNodeComponent, findNodeType } from './node-types.js';

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const canvas = document.querySelector('#canvas');
const ctx = canvas.getContext('2d');
const canvasWrap = document.querySelector('#canvas-wrap');
const contextMenuEl = document.querySelector('#context-menu');
const paletteList = document.querySelector('#palette-list');
const statusSelection = document.querySelector('#status-selection');
const statusCounts = document.querySelector('#status-counts');
const statusMessage = document.querySelector('#status-message');
const zoomReadout = document.querySelector('#zoom-readout');
const propsPanel = document.querySelector('#panel-properties');
const debugLogEl = document.querySelector('#debug-log');
const validationListEl = document.querySelector('#validation-list');
const issueCountEl = document.querySelector('#issue-count');
const portTooltipEl = document.querySelector('#port-tooltip');

// ---------------------------------------------------------------------------
// Engine / viewport / interaction setup
// ---------------------------------------------------------------------------
const engine = new HarnessEditorEngine(createEmptyDocument('flow-demo'), {
  autoRoute: true,
  validateOnChange: true,
  findCrossings: true,
});

const viewport = new ViewportController({ pan: { x: 40, y: 40 }, zoom: 1, width: 800, height: 600 });

const interaction = new EditorInteractionController(engine, {
  zoom: () => viewport.state.zoom,
});

let renderScheduled = false;
function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    renderFrame();
  });
}

// ---------------------------------------------------------------------------
// Palette (drag source)
// ---------------------------------------------------------------------------
for (const category of CATEGORIES) {
  const heading = document.createElement('div');
  heading.className = 'palette-category';
  heading.textContent = category;
  paletteList.appendChild(heading);
  for (const definition of NODE_TYPES.filter((n) => n.category === category)) {
    const item = document.createElement('div');
    item.className = 'palette-item';
    item.style.setProperty('--node-color', definition.color);
    item.draggable = true;
    item.title = definition.hint;
    item.innerHTML = `<span class="dot"></span><span>${definition.type}</span>`;
    item.addEventListener('dragstart', (event) => {
      event.dataTransfer.setData('text/plain', definition.type);
      event.dataTransfer.effectAllowed = 'copy';
    });
    paletteList.appendChild(item);
  }
}

// Node-RED-style palette filter: hides non-matching items and empty categories.
document.querySelector('#palette-search').addEventListener('input', (event) => {
  const query = event.target.value.trim().toLowerCase();
  let categoryEl;
  let categoryHasMatch = false;
  for (const child of paletteList.children) {
    if (child.classList.contains('palette-category')) {
      if (categoryEl) categoryEl.classList.toggle('hidden', !categoryHasMatch);
      categoryEl = child;
      categoryHasMatch = false;
      continue;
    }
    const match = !query || child.textContent.toLowerCase().includes(query);
    child.classList.toggle('hidden', !match);
    categoryHasMatch = categoryHasMatch || match;
  }
  if (categoryEl) categoryEl.classList.toggle('hidden', !categoryHasMatch);
});

canvasWrap.addEventListener('dragover', (event) => {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
});
canvasWrap.addEventListener('drop', (event) => {
  event.preventDefault();
  const type = event.dataTransfer.getData('text/plain');
  const definition = findNodeType(type);
  if (!definition) return;
  const rect = canvas.getBoundingClientRect();
  const screenPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  const worldPoint = viewport.screenToWorld(screenPoint);
  const component = createNodeComponent(definition, { x: worldPoint.x - 75, y: worldPoint.y - 28 });
  engine.addComponent(component);
  engine.select([{ kind: 'component', id: component.id }], { kind: 'component', id: component.id });
  setStatusMessage(`Added ${definition.type} node.`);
});

// ---------------------------------------------------------------------------
// Pointer / keyboard input -> interaction controller
// ---------------------------------------------------------------------------
let spaceHeld = false;
let clickCandidate; // { id, pointerId, screenStart, worldPoint }
let hoverState = { port: undefined, wireId: undefined, componentId: undefined };
let latestSnapGuides = [];
const ARROW_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
const CLONE_ARROW_OFFSET = 22;
const CLONE_ARROW_RADIUS = 9;

// draw.io places a clone-and-connect arrow past the shape's edge on hover;
// our flow is left-to-right so a single east-side arrow covers the common case.
function cloneArrowWorldPosition(componentId) {
  const geometry = engine.geometries[componentId];
  if (!geometry) return undefined;
  return { x: geometry.worldBounds.x + geometry.worldBounds.width + CLONE_ARROW_OFFSET, y: geometry.worldBounds.y + geometry.worldBounds.height / 2 };
}

// draw.io-style affordance: glow the port/wire under the cursor so targets
// are obvious before the user commits to a drag.
function updateHoverState(worldPoint) {
  const hits = hitTestDocument(engine.document, worldPoint, {
    componentGeometries: engine.geometries,
    labelPlacements: engine.labelPlacements,
    zoom: viewport.state.zoom,
    hitTolerancePx: engine.document.settings.hitTolerancePx,
  });
  const hit = hits[0];
  const nextPort = hit?.kind === 'port' ? { componentId: hit.entityId, portId: hit.subId } : undefined;
  const nextWireId = hit?.kind === 'wire' || hit?.kind === 'route-segment' ? hit.entityId : undefined;
  let nextComponentId = hit?.kind === 'component-body' || hit?.kind === 'component-header' ? hit.entityId : undefined;
  // Keep the clone arrow's own hovered component "live" while the cursor is
  // over the gap between the node's edge and the arrow (a contiguous strip,
  // not just a small circle, so crossing it in one mouse move can't drop it).
  if (!nextComponentId && hoverState.componentId) {
    const geometry = engine.geometries[hoverState.componentId];
    const margin = (CLONE_ARROW_RADIUS + 4) / viewport.state.zoom;
    if (geometry) {
      const bounds = geometry.worldBounds;
      const withinStrip = worldPoint.x >= bounds.x + bounds.width
        && worldPoint.x <= bounds.x + bounds.width + CLONE_ARROW_OFFSET + margin
        && worldPoint.y >= bounds.y + bounds.height / 2 - margin
        && worldPoint.y <= bounds.y + bounds.height / 2 + margin;
      if (withinStrip) nextComponentId = hoverState.componentId;
    }
  }
  const changed = nextPort?.componentId !== hoverState.port?.componentId || nextPort?.portId !== hoverState.port?.portId || nextWireId !== hoverState.wireId || nextComponentId !== hoverState.componentId;
  hoverState = { port: nextPort, wireId: nextWireId, componentId: nextComponentId };
  if (changed) { updatePortTooltip(); scheduleRender(); }
}

// Node-RED shows input/output port labels only as a hover tooltip (inputLabels
// / outputLabels), not baked permanently into the node body; mirror that here.
function updatePortTooltip() {
  const port = hoverState.port;
  const portSpec = port && engine.document.components[port.componentId]?.ports.find((candidate) => candidate.id === port.portId);
  const portGeometry = port && engine.geometries[port.componentId]?.ports[port.portId];
  if (!portSpec || !portGeometry) {
    portTooltipEl.classList.add('hidden');
    return;
  }
  const screen = viewport.worldToScreen(portGeometry.center);
  portTooltipEl.textContent = portSpec.function ? `${portSpec.label} \u00b7 ${portSpec.function}` : portSpec.label;
  portTooltipEl.style.left = `${screen.x + 12}px`;
  portTooltipEl.style.top = `${screen.y - 10}px`;
  portTooltipEl.classList.remove('hidden');
}

function modifiersFromEvent(event) {
  return { shift: event.shiftKey, alt: event.altKey, ctrl: event.ctrlKey, meta: event.metaKey, space: spaceHeld };
}

function toEditorPointerEvent(event) {
  const rect = canvas.getBoundingClientRect();
  const screenPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  const point = viewport.screenToWorld(screenPoint);
  return {
    pointerId: event.pointerId,
    point,
    screenPoint,
    button: event.button,
    buttons: event.buttons,
    pointerType: event.pointerType ?? 'mouse',
    pressure: event.pressure ?? 0.5,
    modifiers: modifiersFromEvent(event),
    timestamp: event.timeStamp,
  };
}

canvas.addEventListener('pointerdown', (event) => {
  hideContextMenu();
  portTooltipEl.classList.add('hidden');
  // Defensive: recover if a previous gesture never received its pointerup/cancel
  // (e.g. focus lost mid-drag) so the engine doesn't get stuck mid-preview.
  if (engine.isPreviewActive) engine.cancelPreview();
  canvas.setPointerCapture(event.pointerId);
  const editorEvent = toEditorPointerEvent(event);
  if (event.button === 0 && !spaceHeld) {
    if (hoverState.componentId) {
      const arrowPoint = cloneArrowWorldPosition(hoverState.componentId);
      const toleranceWorld = (CLONE_ARROW_RADIUS + 4) / viewport.state.zoom;
      if (arrowPoint && Math.hypot(editorEvent.point.x - arrowPoint.x, editorEvent.point.y - arrowPoint.y) <= toleranceWorld) {
        cloneAndConnectEast(hoverState.componentId);
        scheduleRender();
        return;
      }
    }
    const hits = hitTestDocument(engine.document, editorEvent.point, {
      componentGeometries: engine.geometries,
      labelPlacements: engine.labelPlacements,
      zoom: viewport.state.zoom,
      hitTolerancePx: engine.document.settings.hitTolerancePx,
    });
    const hit = hits[0];
    if (hit && (hit.kind === 'component-body' || hit.kind === 'component-header')) {
      const component = engine.document.components[hit.entityId];
      if (component?.metadata?.nodeType === 'inject') {
        clickCandidate = { id: hit.entityId, pointerId: event.pointerId, screenStart: editorEvent.screenPoint };
      }
    }
  }
  interaction.pointerDown(editorEvent);
  scheduleRender();
});

canvas.addEventListener('pointermove', (event) => {
  const editorEvent = toEditorPointerEvent(event);
  interaction.pointerMove(editorEvent);
  if (interaction.state.kind === 'idle') updateHoverState(editorEvent.point);
  scheduleRender();
});

canvas.addEventListener('pointerleave', () => {
  hoverState = { port: undefined, wireId: undefined, componentId: undefined };
  portTooltipEl.classList.add('hidden');
  scheduleRender();
});

canvas.addEventListener('dblclick', (event) => {
  const rect = canvas.getBoundingClientRect();
  const screenPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  const worldPoint = viewport.screenToWorld(screenPoint);
  const hits = hitTestDocument(engine.document, worldPoint, {
    componentGeometries: engine.geometries,
    labelPlacements: engine.labelPlacements,
    zoom: viewport.state.zoom,
    hitTolerancePx: engine.document.settings.hitTolerancePx,
  });
  if (hits[0]) return;
  openQuickAdd(screenPoint, worldPoint);
});

canvas.addEventListener('pointerup', (event) => {
  const editorEvent = toEditorPointerEvent(event);
  interaction.pointerUp(editorEvent);
  if (clickCandidate && clickCandidate.pointerId === event.pointerId) {
    const dx = editorEvent.screenPoint.x - clickCandidate.screenStart.x;
    const dy = editorEvent.screenPoint.y - clickCandidate.screenStart.y;
    if (Math.hypot(dx, dy) < 4) triggerInject(clickCandidate.id);
  }
  clickCandidate = undefined;
  scheduleRender();
});

canvas.addEventListener('pointercancel', (event) => {
  interaction.pointerCancel(event.pointerId);
  clickCandidate = undefined;
  scheduleRender();
});

canvas.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const screenPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  const worldPoint = viewport.screenToWorld(screenPoint);
  const hits = hitTestDocument(engine.document, worldPoint, {
    componentGeometries: engine.geometries,
    labelPlacements: engine.labelPlacements,
    zoom: viewport.state.zoom,
    hitTolerancePx: engine.document.settings.hitTolerancePx,
  });
  showContextMenu(screenPoint, hits[0]);
});

canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const screenPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  const factor = Math.pow(1.0015, -event.deltaY);
  viewport.zoomAt(screenPoint, factor);
  updateZoomReadout();
  scheduleRender();
}, { passive: false });

window.addEventListener('keydown', (event) => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (event.key === ' ') spaceHeld = true;
  if (ARROW_KEYS.has(event.key) && interaction.state.kind === 'idle') {
    const ids = engine.selection.items.filter((item) => item.kind === 'component').map((item) => item.id);
    if (ids.length) {
      const step = event.shiftKey ? engine.document.settings.grid.spacing : 1;
      const delta = {
        x: event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0,
        y: event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0,
      };
      engine.moveComponents(ids, delta, { snap: false });
      event.preventDefault();
      scheduleRender();
      return;
    }
  }
  const handled = interaction.keyDown(event.key, modifiersFromEvent(event));
  if (handled) event.preventDefault();
  scheduleRender();
});
window.addEventListener('keyup', (event) => {
  if (event.key === ' ') spaceHeld = false;
});

interaction.on('panRequested', ({ delta }) => {
  const zoom = viewport.state.zoom;
  viewport.pan({ x: delta.x * zoom, y: delta.y * zoom });
});
interaction.on('cursorRequested', ({ cursor }) => {
  canvas.style.cursor = cursor;
});
interaction.on('stateChanged', () => scheduleRender());
interaction.on('marqueeChanged', () => scheduleRender());
interaction.on('connectionPreview', () => scheduleRender());
interaction.on('snapGuidesChanged', ({ guides }) => { latestSnapGuides = guides ?? []; scheduleRender(); });

// If the window loses focus mid-drag (alt-tab, devtools, etc.) the pointerup
// event never arrives; make sure the gesture still resolves cleanly.
window.addEventListener('blur', () => {
  if (interaction.state.kind !== 'idle') interaction.pointerCancel(interaction.state.pointerId);
  clickCandidate = undefined;
});

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------
const resizeObserver = new ResizeObserver(() => {
  viewport.resize(canvasWrap.clientWidth, canvasWrap.clientHeight);
  scheduleRender();
});
resizeObserver.observe(canvasWrap);

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------
const btnUndo = document.querySelector('#btn-undo');
const btnRedo = document.querySelector('#btn-redo');
document.querySelector('#btn-delete').addEventListener('click', () => {
  interaction.keyDown('Delete', { shift: false, alt: false, ctrl: false, meta: false, space: false });
  scheduleRender();
});
btnUndo.addEventListener('click', () => { engine.undo(); });
btnRedo.addEventListener('click', () => { engine.redo(); });
document.querySelector('#btn-zoom-in').addEventListener('click', () => {
  viewport.zoomAt({ x: viewport.state.width / 2, y: viewport.state.height / 2 }, 1.25);
  updateZoomReadout();
  scheduleRender();
});
document.querySelector('#btn-zoom-out').addEventListener('click', () => {
  viewport.zoomAt({ x: viewport.state.width / 2, y: viewport.state.height / 2 }, 0.8);
  updateZoomReadout();
  scheduleRender();
});
document.querySelector('#btn-zoom-fit').addEventListener('click', () => {
  const bounds = engine.scene?.contentBounds ?? { x: 0, y: 0, width: 800, height: 400 };
  viewport.fit(bounds, 60);
  updateZoomReadout();
  scheduleRender();
});
document.querySelector('#btn-clear').addEventListener('click', () => {
  if (!confirm('Clear the whole flow?')) return;
  engine.replaceDocument(createEmptyDocument('flow-demo'), 'Clear canvas');
  logDebug(undefined, 'system', 'Canvas cleared.');
});
document.querySelector('#btn-demo').addEventListener('click', () => {
  buildDemoFlow();
  setStatusMessage('Demo flow loaded.');
});
document.querySelector('#btn-export').addEventListener('click', () => {
  const blob = new Blob([engine.toJSON(true)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'flow.json';
  link.click();
  URL.revokeObjectURL(url);
});
const fileImport = document.querySelector('#file-import');
document.querySelector('#btn-import').addEventListener('click', () => fileImport.click());
fileImport.addEventListener('change', async () => {
  const file = fileImport.files?.[0];
  if (!file) return;
  const text = await file.text();
  try {
    engine.replaceDocument(JSON.parse(text), 'Import flow');
    setStatusMessage(`Imported ${file.name}.`);
  } catch (error) {
    setStatusMessage(`Import failed: ${error.message}`);
  }
  fileImport.value = '';
});

let deployed = false;
let deployTimer;
const btnDeploy = document.querySelector('#btn-deploy');
btnDeploy.addEventListener('click', () => {
  deployed = !deployed;
  btnDeploy.textContent = deployed ? '\u25a0 Stop' : '\u25b6 Deploy';
  btnDeploy.classList.toggle('primary', !deployed);
  if (deployed) {
    logDebug(undefined, 'system', 'Deployed. Inject nodes will fire every 4s.');
    fireAllInjects();
    deployTimer = setInterval(fireAllInjects, 4000);
  } else {
    logDebug(undefined, 'system', 'Stopped.');
    clearInterval(deployTimer);
  }
});

function fireAllInjects() {
  for (const component of Object.values(engine.document.components)) {
    if (component.metadata?.nodeType === 'inject') triggerInject(component.id);
  }
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------
function hideContextMenu() {
  contextMenuEl.classList.add('hidden');
  contextMenuEl.innerHTML = '';
}
function showContextMenu(screenPoint, hit) {
  contextMenuEl.innerHTML = '';
  const actions = [];
  if (hit && (hit.kind === 'component-body' || hit.kind === 'component-header')) {
    const componentId = hit.entityId;
    actions.push(['Duplicate', () => duplicateComponent(componentId)]);
    actions.push(['Delete node', () => engine.removeComponent(componentId, 'detach'), true]);
  } else if (hit && hit.kind === 'wire') {
    const wireId = hit.entityId;
    actions.push(['Delete wire', () => engine.removeWire(wireId), true]);
  } else {
    actions.push(['Fit view', () => document.querySelector('#btn-zoom-fit').click()]);
  }
  for (const [label, handler, danger] of actions) {
    const button = document.createElement('button');
    button.textContent = label;
    if (danger) button.className = 'danger';
    button.addEventListener('click', () => { handler(); hideContextMenu(); scheduleRender(); });
    contextMenuEl.appendChild(button);
  }
  contextMenuEl.style.left = `${screenPoint.x}px`;
  contextMenuEl.style.top = `${screenPoint.y}px`;
  contextMenuEl.classList.remove('hidden');
}
window.addEventListener('pointerdown', (event) => {
  if (!contextMenuEl.contains(event.target)) hideContextMenu();
});

function duplicateComponent(componentId) {
  const source = engine.document.components[componentId];
  if (!source) return;
  const definition = findNodeType(source.metadata?.nodeType) ?? { type: source.labels.title, inputs: [], outputs: [], color: '#999', category: 'function' };
  const copy = createNodeComponent(definition, { x: source.position.x + 30, y: source.position.y + 30 });
  engine.addComponent(copy);
  engine.select([{ kind: 'component', id: copy.id }], { kind: 'component', id: copy.id });
}

// draw.io's "hover a shape, click the blue arrow to clone and auto-connect it".
// Our flow is left-to-right so a single east-side clone covers the common case.
function cloneAndConnectEast(componentId) {
  const source = engine.document.components[componentId];
  if (!source) return;
  const definition = findNodeType(source.metadata?.nodeType) ?? { type: source.labels.title, inputs: [], outputs: [], color: '#999', category: 'function' };
  const offsetX = (source.size?.width ?? 150) + 60;
  const clone = createNodeComponent(definition, { x: source.position.x + offsetX, y: source.position.y });
  engine.addComponent(clone);
  const sourceOut = source.ports.find((port) => port.side === 'east');
  const cloneIn = clone.ports.find((port) => port.side === 'west');
  if (sourceOut && cloneIn) {
    engine.connectWire({
      source: { kind: 'port', componentId: source.id, portId: sourceOut.id },
      target: { kind: 'port', componentId: clone.id, portId: cloneIn.id },
    });
  }
  engine.select([{ kind: 'component', id: clone.id }], { kind: 'component', id: clone.id });
  setStatusMessage(`Cloned and connected ${definition.type}.`);
}

// ---------------------------------------------------------------------------
// Quick-add (Node-RED-style: double-click empty canvas, type to filter, Enter to add)
// ---------------------------------------------------------------------------
const quickAddEl = document.querySelector('#quick-add');
const quickAddInput = document.querySelector('#quick-add-input');
const quickAddResults = document.querySelector('#quick-add-results');
let quickAddWorldPoint;

function openQuickAdd(screenPoint, worldPoint) {
  quickAddWorldPoint = worldPoint;
  quickAddEl.style.left = `${screenPoint.x}px`;
  quickAddEl.style.top = `${screenPoint.y}px`;
  quickAddEl.classList.remove('hidden');
  quickAddInput.value = '';
  renderQuickAddResults('');
  quickAddInput.focus();
}
function closeQuickAdd() {
  quickAddEl.classList.add('hidden');
}
function renderQuickAddResults(query) {
  const normalized = query.trim().toLowerCase();
  const matches = NODE_TYPES.filter((definition) => !normalized || definition.type.includes(normalized));
  quickAddResults.innerHTML = matches
    .map((definition) => `<button data-type="${definition.type}" style="--node-color:${definition.color}">${definition.type}</button>`)
    .join('') || '<p class="props-empty">No matches</p>';
  for (const button of quickAddResults.querySelectorAll('button'))
    button.addEventListener('click', () => addQuickNode(button.dataset.type));
}
function addQuickNode(type) {
  const definition = findNodeType(type);
  if (!definition || !quickAddWorldPoint) return;
  const component = createNodeComponent(definition, { x: quickAddWorldPoint.x - 75, y: quickAddWorldPoint.y - 28 });
  engine.addComponent(component);
  engine.select([{ kind: 'component', id: component.id }], { kind: 'component', id: component.id });
  closeQuickAdd();
}
quickAddInput.addEventListener('input', () => renderQuickAddResults(quickAddInput.value));
quickAddInput.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { closeQuickAdd(); return; }
  if (event.key === 'Enter') {
    const first = quickAddResults.querySelector('button');
    if (first) addQuickNode(first.dataset.type);
  }
});
window.addEventListener('pointerdown', (event) => {
  if (!quickAddEl.contains(event.target)) closeQuickAdd();
});

// ---------------------------------------------------------------------------
// Properties panel
// ---------------------------------------------------------------------------
function renderPropertiesPanel() {
  const primary = engine.selection.primary;
  propsPanel.innerHTML = '';
  if (!primary) {
    propsPanel.innerHTML = '<p class="props-empty">Select a node or wire to edit its properties.</p>';
    return;
  }
  if (primary.kind === 'component') {
    const component = engine.document.components[primary.id];
    if (!component) return;
    const nodeType = component.metadata?.nodeType ?? 'custom';
    const wrapper = document.createElement('div');
    wrapper.dataset.componentId = component.id;
    wrapper.innerHTML = `
      <div class="field"><label>Node type</label><input value="${nodeType}" disabled /></div>
      <div class="field"><label>Title</label><input id="prop-title" value="${escapeHtml(component.labels.title ?? '')}" /></div>
      <div class="field"><label>Info / subtitle</label><input id="prop-subtitle" value="${escapeHtml(component.labels.subtitle ?? '')}" /></div>
      <div class="field-row">
        <div class="field"><label>X</label><input id="prop-x" type="number" value="${Math.round(component.position.x)}" /></div>
        <div class="field"><label>Y</label><input id="prop-y" type="number" value="${Math.round(component.position.y)}" /></div>
      </div>
      <div class="props-actions">
        ${nodeType === 'inject' ? '<button id="prop-fire">Fire once</button>' : ''}
        <button id="prop-duplicate">Duplicate</button>
        <button id="prop-delete" class="danger">Delete</button>
      </div>
    `;
    propsPanel.appendChild(wrapper);
    wrapper.querySelector('#prop-title').addEventListener('change', (event) => {
      engine.updateComponent(component.id, (draft) => { draft.labels.title = event.target.value; });
    });
    wrapper.querySelector('#prop-subtitle').addEventListener('change', (event) => {
      engine.updateComponent(component.id, (draft) => { draft.labels.subtitle = event.target.value; });
    });
    wrapper.querySelector('#prop-x').addEventListener('change', (event) => {
      engine.setComponentPosition(component.id, { x: Number(event.target.value), y: component.position.y });
    });
    wrapper.querySelector('#prop-y').addEventListener('change', (event) => {
      engine.setComponentPosition(component.id, { x: component.position.x, y: Number(event.target.value) });
    });
    wrapper.querySelector('#prop-fire')?.addEventListener('click', () => triggerInject(component.id));
    wrapper.querySelector('#prop-duplicate').addEventListener('click', () => duplicateComponent(component.id));
    wrapper.querySelector('#prop-delete').addEventListener('click', () => engine.removeComponent(component.id, 'detach'));
    return;
  }
  if (primary.kind === 'wire') {
    const wire = engine.document.wires[primary.id];
    if (!wire) return;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div class="field"><label>Label</label><input id="prop-wire-label" value="${escapeHtml(wire.label ?? '')}" /></div>
      <div class="field"><label>Signal</label><input id="prop-wire-signal" value="${escapeHtml(wire.signal ?? '')}" /></div>
      <div class="props-actions"><button id="prop-wire-delete" class="danger">Delete wire</button></div>
    `;
    propsPanel.appendChild(wrapper);
    wrapper.querySelector('#prop-wire-label').addEventListener('change', (event) => {
      engine.updateWire(wire.id, (draft) => { draft.label = event.target.value; });
    });
    wrapper.querySelector('#prop-wire-signal').addEventListener('change', (event) => {
      engine.updateWire(wire.id, (draft) => { draft.signal = event.target.value; });
    });
    wrapper.querySelector('#prop-wire-delete').addEventListener('click', () => engine.removeWire(wire.id));
    return;
  }
  propsPanel.innerHTML = '<p class="props-empty">Select a node or wire to edit its properties.</p>';
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

// Keeps the X/Y readout live while a node is being dragged, without rebuilding
// the panel (which would steal focus from whatever field is being edited).
function syncPropertiesPosition() {
  const wrapper = propsPanel.firstElementChild;
  const componentId = wrapper?.dataset.componentId;
  if (!componentId) return;
  const component = engine.document.components[componentId];
  if (!component) return;
  const xInput = wrapper.querySelector('#prop-x');
  const yInput = wrapper.querySelector('#prop-y');
  if (xInput && document.activeElement !== xInput) xInput.value = Math.round(component.position.x);
  if (yInput && document.activeElement !== yInput) yInput.value = Math.round(component.position.y);
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => {
    for (const other of document.querySelectorAll('.tab')) other.classList.toggle('active', other === tab);
    for (const panel of document.querySelectorAll('.tab-panel')) panel.classList.add('hidden');
    document.querySelector(`#panel-${tab.dataset.tab}`).classList.remove('hidden');
  });
}
document.querySelector('#btn-clear-debug').addEventListener('click', () => { debugLogEl.innerHTML = ''; });

function logDebug(componentId, title, message) {
  const line = document.createElement('div');
  line.className = 'log-line';
  const time = new Date().toLocaleTimeString();
  line.innerHTML = `<span class="ts">${time}</span><span class="node">${escapeHtml(title)}</span>: ${escapeHtml(message)}`;
  debugLogEl.prepend(line);
  while (debugLogEl.children.length > 200) debugLogEl.lastChild.remove();
}

function renderValidationPanel() {
  const issues = engine.validationIssues;
  issueCountEl.textContent = String(issues.length);
  issueCountEl.classList.toggle('hidden', issues.length === 0);
  validationListEl.innerHTML = issues.length === 0
    ? '<p class="props-empty ok">No validation issues.</p>'
    : issues.map((issue) => `<div class="issue"><span class="sev sev-${issue.severity}">${issue.severity}</span>${escapeHtml(issue.message)}</div>`).join('');
}

// ---------------------------------------------------------------------------
// Simulation: pulses that travel along wires when an inject node fires
// ---------------------------------------------------------------------------
const pulses = [];
const flashes = new Map(); // componentId -> expiry timestamp
let lastFrameTime = performance.now();

function outgoingWires(componentId, portId) {
  return Object.values(engine.document.wires).filter(
    (wire) => wire.source.kind === 'port' && wire.source.componentId === componentId && (!portId || wire.source.portId === portId),
  );
}

function fallbackPoints(wire) {
  const sourceGeom = wire.source.kind === 'port' ? engine.geometries[wire.source.componentId]?.ports[wire.source.portId] : undefined;
  const targetGeom = wire.target.kind === 'port' ? engine.geometries[wire.target.componentId]?.ports[wire.target.portId] : undefined;
  if (!sourceGeom || !targetGeom) return [];
  return [sourceGeom.center, targetGeom.center];
}

function spawnPulse(wire) {
  const points = wire.route?.status === 'valid' && wire.route.points?.length >= 2 ? wire.route.points : fallbackPoints(wire);
  if (points.length < 2) return;
  const target = wire.target.kind === 'port' ? wire.target : undefined;
  pulses.push({ points, t: 0, componentId: target?.componentId, portId: target?.portId });
  scheduleRender();
}

function flashNode(componentId) {
  flashes.set(componentId, performance.now() + 550);
  scheduleRender();
}

function triggerInject(componentId) {
  const component = engine.document.components[componentId];
  if (!component) return;
  flashNode(componentId);
  logDebug(componentId, component.labels.title, `msg.payload = ${Math.round(performance.now())}`);
  for (const wire of outgoingWires(componentId)) spawnPulse(wire);
}

function arrivePulse(componentId) {
  const component = engine.document.components[componentId];
  if (!component) return;
  flashNode(componentId);
  const nodeType = component.metadata?.nodeType;
  const title = component.labels.title;
  if (nodeType === 'debug') {
    logDebug(componentId, title, 'msg received');
  } else if (nodeType === 'mqtt out') {
    logDebug(componentId, title, 'published message');
  } else if (nodeType === 'switch') {
    const branch = Math.random() < 0.5 ? 0 : 1;
    logDebug(componentId, title, `routed to output "${branch === 0 ? 'true' : 'false'}"`);
    for (const wire of outgoingWires(componentId, `${componentId}-out${branch}`)) spawnPulse(wire);
  } else if (nodeType === 'delay') {
    logDebug(componentId, title, 'holding message for 400ms');
    setTimeout(() => { for (const wire of outgoingWires(componentId)) spawnPulse(wire); }, 400);
  } else {
    for (const wire of outgoingWires(componentId)) spawnPulse(wire);
  }
}

function stepSimulation(now) {
  const dt = now - lastFrameTime;
  lastFrameTime = now;
  let active = false;
  for (let index = pulses.length - 1; index >= 0; index -= 1) {
    const pulse = pulses[index];
    pulse.t += dt / 700;
    if (pulse.t >= 1) {
      pulses.splice(index, 1);
      if (pulse.componentId) arrivePulse(pulse.componentId);
    } else {
      active = true;
    }
  }
  for (const [componentId, expiry] of flashes) {
    if (now > expiry) flashes.delete(componentId);
    else active = true;
  }
  if (active || pulses.length) scheduleRender();
  requestAnimationFrame(stepSimulation);
}
requestAnimationFrame(stepSimulation);

function pointAlongPolyline(points, t) {
  let total = 0;
  const lengths = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const dx = points[index + 1].x - points[index].x;
    const dy = points[index + 1].y - points[index].y;
    const length = Math.hypot(dx, dy);
    lengths.push(length);
    total += length;
  }
  let distance = t * total;
  for (let index = 0; index < lengths.length; index += 1) {
    if (distance <= lengths[index] || index === lengths.length - 1) {
      const ratio = lengths[index] > 0 ? distance / lengths[index] : 0;
      const a = points[index];
      const b = points[index + 1];
      return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio };
    }
    distance -= lengths[index];
  }
  return points[points.length - 1];
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
const renderer = new Canvas2DRenderer();

function renderFrame() {
  const scene = engine.scene;
  if (!scene) return;
  const worldViewport = viewportWorldRect(viewport.state);
  const plan = buildVisualRenderPlan(scene, {
    zoom: viewport.state.zoom,
    viewport: worldViewport,
    selection: engine.selection,
  });
  // cachePaths disabled: wire route revisions don't advance during preview
  // drags, so a cached Path2D would keep drawing a wire's pre-drag position.
  renderer.render(plan, ctx, { devicePixelRatio: window.devicePixelRatio || 1, background: '#ffffff', cachePaths: false });

  const dpr = window.devicePixelRatio || 1;
  const scale = viewport.state.zoom;
  const translateX = -worldViewport.x * scale;
  const translateY = -worldViewport.y * scale;
  ctx.save();
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * translateX, dpr * translateY);

  // draw.io-style wire "jump" gaps at crossings the library already detects,
  // using the wireBridgeRadius the document settings define for this purpose.
  const crossings = scene.crossings ?? [];
  if (crossings.length) {
    const bridgeRadius = engine.document.settings.wireBridgeRadius ?? 5;
    ctx.save();
    ctx.fillStyle = '#ffffff';
    for (const crossing of crossings) {
      ctx.beginPath();
      ctx.arc(crossing.point.x, crossing.point.y, bridgeRadius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // draw.io-style alignment/spacing guides, computed by snapComponentDrag but
  // previously discarded instead of drawn.
  for (const guide of latestSnapGuides) {
    ctx.save();
    ctx.strokeStyle = guide.kind === 'grid' ? 'rgba(148,163,184,0.9)' : guide.kind === 'port' ? '#0d9488' : '#e11d8f';
    ctx.lineWidth = 1 / scale;
    ctx.setLineDash(guide.kind === 'grid' ? [] : [4 / scale, 3 / scale]);
    ctx.beginPath();
    if (guide.axis === 'x') {
      ctx.moveTo(guide.coordinate, guide.from);
      ctx.lineTo(guide.coordinate, guide.to);
    } else {
      ctx.moveTo(guide.from, guide.coordinate);
      ctx.lineTo(guide.to, guide.coordinate);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Hover affordances (idle only): glow the port under the cursor so a
  // connect-drag target is obvious, and halo the wire under the cursor.
  if (interaction.state.kind === 'idle') {
    if (hoverState.wireId) {
      const wire = engine.document.wires[hoverState.wireId];
      if (wire?.route?.points?.length) {
        ctx.save();
        ctx.strokeStyle = 'rgba(37, 99, 235, 0.35)';
        ctx.lineWidth = (wire.style?.width ?? 2) / scale + 6 / scale;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(wire.route.points[0].x, wire.route.points[0].y);
        for (const point of wire.route.points.slice(1)) ctx.lineTo(point.x, point.y);
        ctx.stroke();
        ctx.restore();
      }
    }
    if (hoverState.port) {
      const portGeom = engine.geometries[hoverState.port.componentId]?.ports[hoverState.port.portId];
      if (portGeom) {
        ctx.save();
        ctx.fillStyle = 'rgba(255, 143, 60, 0.25)';
        ctx.strokeStyle = '#ff8f3c';
        ctx.lineWidth = 2 / scale;
        ctx.beginPath();
        ctx.arc(portGeom.center.x, portGeom.center.y, 9 / scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }
    // draw.io's blue directional clone-and-connect arrows, simplified to the
    // single east direction that matches this flow's left-to-right layout.
    if (hoverState.componentId && !hoverState.port) {
      const arrowPoint = cloneArrowWorldPosition(hoverState.componentId);
      if (arrowPoint) {
        ctx.save();
        ctx.fillStyle = '#2563eb';
        ctx.beginPath();
        ctx.arc(arrowPoint.x, arrowPoint.y, CLONE_ARROW_RADIUS / scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        const r = 4 / scale;
        ctx.moveTo(arrowPoint.x - r * 0.6, arrowPoint.y - r);
        ctx.lineTo(arrowPoint.x + r, arrowPoint.y);
        ctx.lineTo(arrowPoint.x - r * 0.6, arrowPoint.y + r);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
  }

  for (const [componentId, expiry] of flashes) {
    const geometry = engine.geometries[componentId];
    if (!geometry) continue;
    const remaining = Math.max(0, expiry - performance.now()) / 550;
    ctx.save();
    ctx.globalAlpha = 0.55 * remaining + 0.15;
    ctx.strokeStyle = '#ff8f3c';
    ctx.lineWidth = 3 / scale;
    const pad = 4 + 6 * (1 - remaining);
    ctx.strokeRect(geometry.worldBounds.x - pad, geometry.worldBounds.y - pad, geometry.worldBounds.width + pad * 2, geometry.worldBounds.height + pad * 2);
    ctx.restore();
  }

  for (const pulse of pulses) {
    const point = pointAlongPolyline(pulse.points, pulse.t);
    ctx.beginPath();
    ctx.fillStyle = '#ff8f3c';
    ctx.strokeStyle = '#c76a1e';
    ctx.lineWidth = 1.5 / scale;
    ctx.arc(point.x, point.y, 5 / scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  const state = interaction.state;
  if (state.kind === 'marquee') {
    const x = Math.min(state.start.x, state.current.x);
    const y = Math.min(state.start.y, state.current.y);
    const width = Math.abs(state.current.x - state.start.x);
    const height = Math.abs(state.current.y - state.start.y);
    ctx.save();
    ctx.fillStyle = 'rgba(37, 99, 235, 0.12)';
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 1 / scale;
    ctx.setLineDash([6 / scale, 4 / scale]);
    ctx.fillRect(x, y, width, height);
    ctx.strokeRect(x, y, width, height);
    ctx.restore();
  }
  if (state.kind === 'connect-wire') {
    const sourceGeom = state.source.kind === 'port' ? engine.geometries[state.source.componentId]?.ports[state.source.portId] : undefined;
    if (sourceGeom) {
      ctx.save();
      ctx.strokeStyle = state.valid ? '#2c7a3d' : '#b3261e';
      ctx.lineWidth = 2 / scale;
      ctx.setLineDash([5 / scale, 4 / scale]);
      ctx.beginPath();
      ctx.moveTo(sourceGeom.center.x, sourceGeom.center.y);
      ctx.lineTo(state.current.x, state.current.y);
      ctx.stroke();
      ctx.restore();
    }
  }
  ctx.restore();

  updateStatusBar();
}

function updateZoomReadout() {
  zoomReadout.textContent = `${Math.round(viewport.state.zoom * 100)}%`;
}

function updateStatusBar() {
  const selection = engine.selection.items;
  statusSelection.textContent = selection.length === 0 ? 'No selection' : `${selection.length} selected`;
  const document_ = engine.document;
  statusCounts.textContent = `${Object.keys(document_.components).length} nodes \u00b7 ${Object.keys(document_.wires).length} wires`;
  btnUndo.disabled = !engine.canUndo;
  btnRedo.disabled = !engine.canRedo;
}
let statusMessageTimer;
function setStatusMessage(message) {
  statusMessage.textContent = message;
  clearTimeout(statusMessageTimer);
  statusMessageTimer = setTimeout(() => { statusMessage.textContent = ''; }, 3000);
}

// ---------------------------------------------------------------------------
// Demo flow
// ---------------------------------------------------------------------------
function wireComponents(sourceId, sourceOutIndex, targetId, targetInIndex) {
  engine.connectWire({
    source: { kind: 'port', componentId: sourceId, portId: `${sourceId}-out${sourceOutIndex}` },
    target: { kind: 'port', componentId: targetId, portId: `${targetId}-in${targetInIndex}` },
  });
}
function buildDemoFlow() {
  engine.replaceDocument(createEmptyDocument('flow-demo'), 'Load demo flow');
  const inject = createNodeComponent(findNodeType('inject'), { x: 40, y: 80 });
  const fn = createNodeComponent(findNodeType('function'), { x: 260, y: 80 });
  const sw = createNodeComponent(findNodeType('switch'), { x: 480, y: 80 });
  const debugTrue = createNodeComponent(findNodeType('debug'), { x: 740, y: 0 });
  const delay = createNodeComponent(findNodeType('delay'), { x: 740, y: 160 });
  const debugFalse = createNodeComponent(findNodeType('debug'), { x: 960, y: 160 });
  for (const component of [inject, fn, sw, debugTrue, delay, debugFalse]) engine.addComponent(component);
  wireComponents(inject.id, 0, fn.id, 0);
  wireComponents(fn.id, 0, sw.id, 0);
  wireComponents(sw.id, 0, debugTrue.id, 0);
  wireComponents(sw.id, 1, delay.id, 0);
  wireComponents(delay.id, 0, debugFalse.id, 0);
  engine.clearSelection();
  document.querySelector('#btn-zoom-fit').click();
}

// ---------------------------------------------------------------------------
// Engine event wiring
// ---------------------------------------------------------------------------
engine.on('documentChanged', () => { syncPropertiesPosition(); scheduleRender(); });
engine.on('selectionChanged', () => { renderPropertiesPanel(); scheduleRender(); });
engine.on('historyChanged', () => scheduleRender());
engine.on('validationChanged', () => renderValidationPanel());
engine.on('feedback', (event) => { if (event.message) setStatusMessage(event.message); });

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
viewport.resize(canvasWrap.clientWidth || 800, canvasWrap.clientHeight || 600);
buildDemoFlow();
renderPropertiesPanel();
renderValidationPanel();
updateZoomReadout();
scheduleRender();
