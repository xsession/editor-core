import { CommandHistory, deepClone } from './commands.js';
import { ApproximateTextMeasurer, buildComponentGeometry } from './component.js';
import { TypedEventEmitter } from './events.js';
import { add, snapPoint } from './geometry.js';
import { placeLabels, pinLabelToWorld, resetLabelToAutomatic } from './labels.js';
import {
  DEFAULT_ROUTING_OPTIONS,
  createWaypointConstraint,
  moveOrthogonalSegment,
  routeWire,
  type RoutingObstacle,
} from './routing.js';
import { parseDocument, serializeDocument } from './serialization.js';
import { validateDocument } from './validation.js';
import type {
  ComponentGeometry,
  ComponentMutationOptions,
  ComponentNode,
  EditorDocument,
  EditorEventMap,
  EditorFeedback,
  EditorSettings,
  EntityId,
  IdFactory,
  LabelNode,
  LabelPlacement,
  MutationImpact,
  Point,
  PortEndpoint,
  PortSpec,
  RouteConstraint,
  SelectionRef,
  SelectionState,
  ValidationIssue,
  WireEdge,
  WireEndpoint,
  WireStyle,
} from './types.js';

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  grid: { visible: true, snap: true, spacing: 10, majorEvery: 5, opacity: 0.32 },
  defaultRouting: deepClone(DEFAULT_ROUTING_OPTIONS),
  labelGap: 10,
  hitTolerancePx: 7,
  portTargetSizePx: 24,
  componentHandleSizePx: 10,
  wireBridgeRadius: 5,
  preserveManualRoutesOnMove: true,
  reflowLabelsOnEdit: true,
  reduceMotion: false,
};

export const DEFAULT_WIRE_STYLE: WireStyle = {
  pattern: { kind: 'solid', color: '#2563eb' },
  width: 3,
  outlineWidth: 1,
  opacity: 1,
  selectedDash: [10, 6],
  lineCap: 'round',
  lineJoin: 'round',
  zIndex: 0,
};

export class DefaultIdFactory implements IdFactory {
  private counter = 0;

  public next(prefix: string): EntityId {
    const cryptoObject = globalThis.crypto as Crypto | undefined;
    if (cryptoObject?.randomUUID) return `${prefix}-${cryptoObject.randomUUID()}`;
    this.counter += 1;
    return `${prefix}-${Date.now().toString(36)}-${this.counter.toString(36)}`;
  }
}

export class SequentialIdFactory implements IdFactory {
  private counters = new Map<string, number>();

  public next(prefix: string): EntityId {
    const value = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, value);
    return `${prefix}-${value}`;
  }
}

export interface ConnectWireInput {
  id?: EntityId;
  kind?: WireEdge['kind'];
  label?: string;
  signal?: string;
  source: WireEndpoint;
  target: WireEndpoint;
  routing?: Partial<WireEdge['routing']>;
  style?: Partial<WireStyle>;
}

export interface EngineOptions {
  idFactory?: IdFactory;
  historyLimit?: number;
  autoRoute?: boolean;
  validateOnChange?: boolean;
}

interface PreviewState {
  label: string;
  before: EditorDocument;
  mergeKey?: string;
}

function endpointMatches(endpoint: WireEndpoint, componentId: EntityId, portId: EntityId): boolean {
  return endpoint.kind === 'port' && endpoint.componentId === componentId && endpoint.portId === portId;
}

function emptyImpact(): MutationImpact {
  return {
    changedComponents: [],
    changedPorts: [],
    reroutedWires: [],
    invalidatedWires: [],
    detachedWires: [],
    movedLabels: [],
    overlappingLabels: [],
    warnings: [],
  };
}

function connectedPortIds(document: EditorDocument, componentId: EntityId): Set<EntityId> {
  const result = new Set<EntityId>();
  for (const wire of Object.values(document.wires)) {
    for (const endpoint of [wire.source, wire.target]) {
      if (endpoint.kind === 'port' && endpoint.componentId === componentId) result.add(endpoint.portId);
    }
  }
  return result;
}

export function createEmptyDocument(id = 'document-1', settings: Partial<EditorSettings> = {}): EditorDocument {
  return {
    schemaVersion: 1,
    id,
    revision: 0,
    settings: {
      ...deepClone(DEFAULT_EDITOR_SETTINGS),
      ...settings,
      grid: { ...DEFAULT_EDITOR_SETTINGS.grid, ...settings.grid },
      defaultRouting: { ...DEFAULT_EDITOR_SETTINGS.defaultRouting, ...settings.defaultRouting },
    },
    components: {},
    wires: {},
    labels: {},
    componentOrder: [],
    wireOrder: [],
    labelOrder: [],
  };
}

export class HarnessEditorEngine {
  private documentState: EditorDocument;
  private readonly events = new TypedEventEmitter<EditorEventMap>();
  private readonly history: CommandHistory<EditorDocument>;
  private readonly idFactory: IdFactory;
  private readonly options: Required<Pick<EngineOptions, 'autoRoute' | 'validateOnChange'>>;
  private geometryState: Record<EntityId, ComponentGeometry> = {};
  private labelPlacementState: LabelPlacement[] = [];
  private validationState: ValidationIssue[] = [];
  private selectionState: SelectionState = { items: [] };
  private preview?: PreviewState;

  public constructor(document: EditorDocument = createEmptyDocument(), options: EngineOptions = {}) {
    this.documentState = deepClone(document);
    this.idFactory = options.idFactory ?? new DefaultIdFactory();
    this.history = new CommandHistory(options.historyLimit ?? 200);
    this.options = { autoRoute: options.autoRoute ?? true, validateOnChange: options.validateOnChange ?? true };
    this.recomputeDerived(this.documentState, true);
  }

  public static fromJSON(serialized: string, options: EngineOptions = {}): HarnessEditorEngine {
    return new HarnessEditorEngine(parseDocument(serialized), options);
  }

  public get document(): Readonly<EditorDocument> {
    return this.documentState;
  }

  public get geometries(): Readonly<Record<EntityId, ComponentGeometry>> {
    return this.geometryState;
  }

  public get labelPlacements(): readonly LabelPlacement[] {
    return this.labelPlacementState;
  }

  public get validationIssues(): readonly ValidationIssue[] {
    return this.validationState;
  }

  public get selection(): Readonly<SelectionState> {
    return this.selectionState;
  }

  public get canUndo(): boolean {
    return this.history.canUndo;
  }

  public get canRedo(): boolean {
    return this.history.canRedo;
  }

  /** True while a direct-manipulation preview is active and not yet committed. */
  public get isPreviewActive(): boolean {
    return this.preview !== undefined;
  }

  public on<TKey extends keyof EditorEventMap>(type: TKey, listener: (event: EditorEventMap[TKey]) => void): () => void {
    return this.events.on(type, listener);
  }

  public toJSON(pretty = true): string {
    return serializeDocument(this.documentState, pretty);
  }

  public replaceDocument(document: EditorDocument, reason = 'replace document'): void {
    this.documentState = deepClone(document);
    this.history.clear();
    this.preview = undefined;
    this.selectionState = { items: [] };
    this.recomputeDerived(this.documentState, true);
    this.emitAll(reason);
  }

  public execute(label: string, mutate: (draft: EditorDocument, impact: MutationImpact) => void, options: { mergeKey?: string } = {}): MutationImpact {
    if (this.preview) throw new Error('Cannot execute a committed command while a preview gesture is active.');
    const impact = emptyImpact();
    const result = this.history.execute(
      label,
      this.documentState,
      (draft) => {
        mutate(draft, impact);
        draft.revision += 1;
        this.recomputeDerived(draft, false, impact);
      },
      options,
    );
    this.documentState = result.state;
    this.recomputeDerived(this.documentState, true, impact);
    this.emitAll(label, impact);
    return impact;
  }

  public beginPreview(label: string, mergeKey?: string): void {
    if (this.preview) throw new Error('A preview gesture is already active.');
    this.preview = { label, before: deepClone(this.documentState), mergeKey };
    this.events.emit('interactionChanged', { state: `preview:${label}` });
  }

  public updatePreview(mutate: (draft: EditorDocument, impact: MutationImpact) => void): MutationImpact {
    if (!this.preview) throw new Error('No preview gesture is active.');
    const impact = emptyImpact();
    const draft = deepClone(this.preview.before);
    mutate(draft, impact);
    this.recomputeDerived(draft, false, impact);
    this.documentState = draft;
    this.recomputeDerived(this.documentState, true, impact);
    this.events.emit('documentChanged', { document: this.documentState, reason: `preview:${this.preview.label}`, impact });
    return impact;
  }

  public commitPreview(): MutationImpact {
    if (!this.preview) return emptyImpact();
    const preview = this.preview;
    const before = preview.before;
    const after = deepClone(this.documentState);
    after.revision = before.revision + 1;
    const impact = this.diffImpact(before, after);
    this.recomputeDerived(after, false, impact);
    this.history.record(preview.label, before, after, { mergeKey: preview.mergeKey });
    this.documentState = after;
    this.preview = undefined;
    this.recomputeDerived(this.documentState, true, impact);
    this.emitAll(preview.label, impact);
    this.events.emit('interactionChanged', { state: 'idle' });
    return impact;
  }

  public cancelPreview(): void {
    if (!this.preview) return;
    const label = this.preview.label;
    this.documentState = deepClone(this.preview.before);
    this.preview = undefined;
    this.recomputeDerived(this.documentState, true);
    this.events.emit('documentChanged', { document: this.documentState, reason: `cancel:${label}` });
    this.events.emit('interactionChanged', { state: 'idle' });
  }

  public undo(): void {
    if (this.preview) this.cancelPreview();
    const result = this.history.undo(this.documentState);
    if (!result.entry) return;
    this.documentState = result.state;
    this.recomputeDerived(this.documentState, true);
    this.emitAll(`undo:${result.entry.label}`);
  }

  public redo(): void {
    if (this.preview) this.cancelPreview();
    const result = this.history.redo(this.documentState);
    if (!result.entry) return;
    this.documentState = result.state;
    this.recomputeDerived(this.documentState, true);
    this.emitAll(`redo:${result.entry.label}`);
  }

  public addComponent(component: ComponentNode): MutationImpact {
    return this.execute(`Add ${component.designator}`, (draft, impact) => {
      if (draft.components[component.id]) throw new Error(`Component ${component.id} already exists.`);
      draft.components[component.id] = deepClone(component);
      draft.componentOrder.push(component.id);
      impact.changedComponents.push(component.id);
      impact.changedPorts.push(...component.ports.map((port) => port.id));
    });
  }

  public removeComponent(componentId: EntityId, wirePolicy: 'prevent' | 'delete' | 'detach' = 'prevent'): MutationImpact {
    return this.execute('Remove component', (draft, impact) => {
      const component = draft.components[componentId];
      if (!component) return;
      const attached = Object.values(draft.wires).filter(
        (wire) => (wire.source.kind === 'port' && wire.source.componentId === componentId) || (wire.target.kind === 'port' && wire.target.componentId === componentId),
      );
      if (attached.length > 0 && wirePolicy === 'prevent') throw new Error(`${component.designator} still has ${attached.length} attached wire(s).`);
      const geometry = this.geometryState[componentId];
      for (const wire of attached) {
        if (wirePolicy === 'delete') {
          delete draft.wires[wire.id];
          draft.wireOrder = draft.wireOrder.filter((id) => id !== wire.id);
        } else if (wirePolicy === 'detach') {
          if (wire.source.kind === 'port' && wire.source.componentId === componentId) {
            const port = geometry?.ports[wire.source.portId];
            wire.source = { kind: 'free', point: port?.center ?? component.position };
          }
          if (wire.target.kind === 'port' && wire.target.componentId === componentId) {
            const port = geometry?.ports[wire.target.portId];
            wire.target = { kind: 'free', point: port?.center ?? component.position };
          }
          impact.detachedWires.push(wire.id);
        }
      }
      for (const label of Object.values(draft.labels)) {
        if (label.anchor.ownerId === componentId) {
          label.anchor = { ownerKind: 'free', point: geometry?.worldBody ? { x: geometry.worldBody.x, y: geometry.worldBody.y } : component.position };
          label.mode = 'world-pinned';
          label.worldPosition = geometry?.worldBody ? { x: geometry.worldBody.x, y: geometry.worldBody.y } : component.position;
        }
      }
      delete draft.components[componentId];
      draft.componentOrder = draft.componentOrder.filter((id) => id !== componentId);
      impact.changedComponents.push(componentId);
    });
  }

  public moveComponents(componentIds: EntityId[], delta: Point, options: { snap?: boolean; preview?: boolean } = {}): MutationImpact {
    const mutate = (draft: EditorDocument, impact: MutationImpact): void => {
      for (const componentId of componentIds) {
        const component = draft.components[componentId];
        if (!component || component.locked) continue;
        const moved = add(component.position, delta);
        component.position = options.snap ?? draft.settings.grid.snap ? snapPoint(moved, draft.settings.grid.spacing) : moved;
        impact.changedComponents.push(componentId);
      }
    };
    if (options.preview) return this.updatePreview(mutate);
    return this.execute(componentIds.length === 1 ? 'Move component' : 'Move components', mutate, { mergeKey: `move:${[...componentIds].sort().join(',')}` });
  }

  public setComponentPosition(componentId: EntityId, position: Point): MutationImpact {
    return this.execute('Set component position', (draft, impact) => {
      const component = draft.components[componentId];
      if (!component || component.locked) return;
      component.position = draft.settings.grid.snap ? snapPoint(position, draft.settings.grid.spacing) : { ...position };
      impact.changedComponents.push(componentId);
    }, { mergeKey: `position:${componentId}` });
  }

  public rotateComponents(componentIds: EntityId[], clockwise = true): MutationImpact {
    return this.execute(componentIds.length === 1 ? 'Rotate component' : 'Rotate components', (draft, impact) => {
      for (const componentId of componentIds) {
        const component = draft.components[componentId];
        if (!component || component.locked) continue;
        component.rotation = ((component.rotation + (clockwise ? 90 : 270)) % 360) as 0 | 90 | 180 | 270;
        impact.changedComponents.push(componentId);
      }
    });
  }

  public updateComponent(
    componentId: EntityId,
    update: Partial<ComponentNode> | ((component: ComponentNode) => void),
    options: Partial<ComponentMutationOptions> = {},
  ): MutationImpact {
    const resolved: ComponentMutationOptions = {
      connectedPortRemoval: options.connectedPortRemoval ?? 'prevent',
      reroute: options.reroute ?? 'full',
      reflowLabels: options.reflowLabels ?? true,
    };
    return this.execute('Edit component', (draft, impact) => {
      const component = draft.components[componentId];
      if (!component) throw new Error(`Unknown component ${componentId}.`);
      const beforePorts = new Map(component.ports.map((port) => [port.id, deepClone(port)]));
      if (typeof update === 'function') update(component);
      else Object.assign(component, deepClone(update));
      this.handleRemovedPorts(draft, componentId, beforePorts, component.ports, resolved, impact);
      impact.changedComponents.push(componentId);
      impact.changedPorts.push(...component.ports.map((port) => port.id));
    });
  }

  public replacePorts(componentId: EntityId, ports: PortSpec[], options: Partial<ComponentMutationOptions> = {}): MutationImpact {
    return this.updateComponent(componentId, (component) => {
      component.ports = deepClone(ports);
      for (const bank of component.pinBanks) bank.portIds = bank.portIds.filter((id) => ports.some((port) => port.id === id));
    }, options);
  }

  public connectWire(input: ConnectWireInput): { wire: WireEdge; impact: MutationImpact } {
    const wire: WireEdge = {
      id: input.id ?? this.idFactory.next('wire'),
      kind: input.kind ?? 'discrete',
      label: input.label,
      signal: input.signal,
      source: deepClone(input.source),
      target: deepClone(input.target),
      routing: { ...deepClone(this.documentState.settings.defaultRouting), ...deepClone(input.routing ?? {}), constraints: deepClone(input.routing?.constraints ?? []) },
      style: { ...deepClone(DEFAULT_WIRE_STYLE), ...deepClone(input.style ?? {}), pattern: deepClone(input.style?.pattern ?? DEFAULT_WIRE_STYLE.pattern) },
      locked: false,
      hidden: false,
    };
    const validation = this.canConnect(wire.source, wire.target);
    if (!validation.valid) throw new Error(validation.reason);
    const impact = this.execute('Connect wire', (draft, mutationImpact) => {
      draft.wires[wire.id] = deepClone(wire);
      draft.wireOrder.push(wire.id);
      mutationImpact.reroutedWires.push(wire.id);
    });
    return { wire: deepClone(this.documentState.wires[wire.id]!), impact };
  }

  public removeWire(wireId: EntityId): MutationImpact {
    return this.execute('Remove wire', (draft) => {
      delete draft.wires[wireId];
      draft.wireOrder = draft.wireOrder.filter((id) => id !== wireId);
      for (const labelId of [...draft.labelOrder]) {
        const label = draft.labels[labelId];
        if (label?.anchor.ownerKind === 'wire' && label.anchor.ownerId === wireId) {
          delete draft.labels[labelId];
          draft.labelOrder = draft.labelOrder.filter((id) => id !== labelId);
        }
      }
    });
  }

  public reconnectWireEndpoint(wireId: EntityId, end: 'source' | 'target', endpoint: WireEndpoint): MutationImpact {
    return this.execute('Reconnect wire', (draft, impact) => {
      const wire = draft.wires[wireId];
      if (!wire) throw new Error(`Unknown wire ${wireId}.`);
      const other = end === 'source' ? wire.target : wire.source;
      const validation = this.canConnectInDocument(draft, end === 'source' ? endpoint : other, end === 'target' ? endpoint : other, wireId);
      if (!validation.valid) throw new Error(validation.reason);
      wire[end] = deepClone(endpoint) as never;
      impact.reroutedWires.push(wireId);
    });
  }

  public updateWire(wireId: EntityId, update: Partial<WireEdge> | ((wire: WireEdge) => void)): MutationImpact {
    return this.execute('Edit wire', (draft, impact) => {
      const wire = draft.wires[wireId];
      if (!wire) throw new Error(`Unknown wire ${wireId}.`);
      if (typeof update === 'function') update(wire);
      else Object.assign(wire, deepClone(update));
      impact.reroutedWires.push(wireId);
    });
  }

  public setManualRoute(wireId: EntityId, points: Point[], locked = true): MutationImpact {
    return this.execute('Edit wire route', (draft, impact) => {
      const wire = draft.wires[wireId];
      if (!wire) throw new Error(`Unknown wire ${wireId}.`);
      const internal = points.slice(1, -1);
      wire.routing.pattern = 'manual';
      wire.routing.constraints = internal.map((point, index) => createWaypointConstraint(`${wireId}:waypoint:${index + 1}`, point, locked));
      impact.reroutedWires.push(wireId);
    });
  }

  public moveWireSegment(wireId: EntityId, segmentIndex: number, delta: Point): MutationImpact {
    const wire = this.documentState.wires[wireId];
    if (!wire?.route) throw new Error(`Wire ${wireId} has no route to edit.`);
    const moved = moveOrthogonalSegment(wire.route.points, segmentIndex, delta);
    return this.setManualRoute(wireId, moved, true);
  }

  public addRouteConstraint(wireId: EntityId, constraint: RouteConstraint): MutationImpact {
    return this.execute('Add route constraint', (draft, impact) => {
      const wire = draft.wires[wireId];
      if (!wire) throw new Error(`Unknown wire ${wireId}.`);
      wire.routing.constraints = [...wire.routing.constraints.filter((candidate) => candidate.id !== constraint.id), deepClone(constraint)];
      impact.reroutedWires.push(wireId);
    });
  }

  public autoRoute(wireIds?: EntityId[]): MutationImpact {
    return this.execute('Auto-route wires', (draft, impact) => {
      const ids = wireIds ?? draft.wireOrder;
      for (const id of ids) {
        const wire = draft.wires[id];
        if (!wire || wire.locked) continue;
        wire.routing.pattern = 'orthogonal';
        wire.routing.constraints = wire.routing.constraints.filter((constraint) => constraint.kind === 'avoid-rect' || constraint.kind === 'prefer-rect');
        impact.reroutedWires.push(id);
      }
    });
  }

  public addLabel(label: LabelNode): MutationImpact {
    return this.execute('Add label', (draft, impact) => {
      if (draft.labels[label.id]) throw new Error(`Label ${label.id} already exists.`);
      draft.labels[label.id] = deepClone(label);
      draft.labelOrder.push(label.id);
      impact.movedLabels.push(label.id);
    });
  }

  public updateLabel(labelId: EntityId, update: Partial<LabelNode> | ((label: LabelNode) => void)): MutationImpact {
    return this.execute('Edit label', (draft, impact) => {
      const label = draft.labels[labelId];
      if (!label) throw new Error(`Unknown label ${labelId}.`);
      if (typeof update === 'function') update(label);
      else Object.assign(label, deepClone(update));
      impact.movedLabels.push(labelId);
    }, { mergeKey: `label:${labelId}` });
  }

  public moveLabel(labelId: EntityId, worldPosition: Point): MutationImpact {
    return this.updateLabel(labelId, (label) => Object.assign(label, pinLabelToWorld(label, worldPosition)));
  }

  public resetLabel(labelId: EntityId): MutationImpact {
    return this.updateLabel(labelId, (label) => Object.assign(label, resetLabelToAutomatic(label)));
  }

  public removeLabel(labelId: EntityId): MutationImpact {
    return this.execute('Remove label', (draft) => {
      delete draft.labels[labelId];
      draft.labelOrder = draft.labelOrder.filter((id) => id !== labelId);
    });
  }

  public select(items: SelectionRef[], primary?: SelectionRef): void {
    const deduplicated = new Map<string, SelectionRef>();
    for (const item of items) deduplicated.set(`${item.kind}:${item.id}:${String(item.subId ?? '')}`, deepClone(item));
    this.selectionState = { items: [...deduplicated.values()], primary: primary ? deepClone(primary) : [...deduplicated.values()][0] };
    this.events.emit('selectionChanged', { selection: this.selectionState });
  }

  public toggleSelection(item: SelectionRef): void {
    const key = `${item.kind}:${item.id}:${String(item.subId ?? '')}`;
    const existing = new Map(this.selectionState.items.map((candidate) => [`${candidate.kind}:${candidate.id}:${String(candidate.subId ?? '')}`, candidate]));
    if (existing.has(key)) existing.delete(key);
    else existing.set(key, deepClone(item));
    this.select([...existing.values()], existing.has(key) ? item : [...existing.values()][0]);
  }

  public clearSelection(): void {
    this.selectionState = { items: [] };
    this.events.emit('selectionChanged', { selection: this.selectionState });
  }

  public canConnect(source: WireEndpoint, target: WireEndpoint): { valid: boolean; reason: string } {
    return this.canConnectInDocument(this.documentState, source, target);
  }

  public announce(message: string, entityIds?: EntityId[]): void {
    const feedback: EditorFeedback = { kind: 'announcement', message, entityIds };
    this.events.emit('feedback', feedback);
  }

  private canConnectInDocument(
    document: EditorDocument,
    source: WireEndpoint,
    target: WireEndpoint,
    excludingWireId?: EntityId,
  ): { valid: boolean; reason: string } {
    if (source.kind === 'port' && target.kind === 'port' && source.componentId === target.componentId && source.portId === target.portId) {
      return { valid: false, reason: 'A port cannot be connected to itself.' };
    }
    for (const endpoint of [source, target]) {
      if (endpoint.kind !== 'port') continue;
      const component = document.components[endpoint.componentId];
      const port = component?.ports.find((candidate) => candidate.id === endpoint.portId);
      if (!component || !port) return { valid: false, reason: `Missing connection target ${endpoint.componentId}.${endpoint.portId}.` };
      const count = Object.values(document.wires).filter(
        (wire) => wire.id !== excludingWireId && (endpointMatches(wire.source, endpoint.componentId, endpoint.portId) || endpointMatches(wire.target, endpoint.componentId, endpoint.portId)),
      ).length;
      if (count >= port.connectionPolicy.maximumConnections) return { valid: false, reason: `${component.designator}.${port.label} has reached its connection limit.` };
    }
    if (source.kind === 'port' && target.kind === 'port') {
      const sourcePort = document.components[source.componentId]!.ports.find((port) => port.id === source.portId)!;
      const targetPort = document.components[target.componentId]!.ports.find((port) => port.id === target.portId)!;
      if (!sourcePort.connectionPolicy.allowSelfConnection && source.componentId === target.componentId) {
        return { valid: false, reason: 'Connections within the same component require an explicit self-connection policy.' };
      }
      const allowed = sourcePort.connectionPolicy.allowedElectricalClasses;
      if (allowed && !allowed.includes(targetPort.electricalClass)) return { valid: false, reason: `Electrical class ${targetPort.electricalClass} is not permitted by the source port.` };
    }
    return { valid: true, reason: '' };
  }

  private handleRemovedPorts(
    draft: EditorDocument,
    componentId: EntityId,
    beforePorts: Map<EntityId, PortSpec>,
    afterPorts: PortSpec[],
    options: ComponentMutationOptions,
    impact: MutationImpact,
  ): void {
    const afterIds = new Set(afterPorts.map((port) => port.id));
    const removed = [...beforePorts.keys()].filter((id) => !afterIds.has(id));
    if (removed.length === 0) return;
    const newByLabel = new Map(afterPorts.map((port) => [port.label, port]));
    const oldGeometry = this.geometryState[componentId];
    for (const portId of removed) {
      const attached = Object.values(draft.wires).filter(
        (wire) => endpointMatches(wire.source, componentId, portId) || endpointMatches(wire.target, componentId, portId),
      );
      if (attached.length === 0) continue;
      if (options.connectedPortRemoval === 'prevent') throw new Error(`Cannot remove connected port ${beforePorts.get(portId)?.label ?? portId}.`);
      const replacement = options.connectedPortRemoval === 'remap-by-label'
        ? newByLabel.get(beforePorts.get(portId)?.label ?? '')
        : undefined;
      for (const wire of attached) {
        const detach = (endpoint: PortEndpoint): WireEndpoint => {
          if (replacement) return { kind: 'port', componentId, portId: replacement.id };
          const portGeometry = oldGeometry?.ports[endpoint.portId];
          return { kind: 'free', point: portGeometry?.center ?? draft.components[componentId]!.position };
        };
        if (endpointMatches(wire.source, componentId, portId)) wire.source = detach(wire.source as PortEndpoint);
        if (endpointMatches(wire.target, componentId, portId)) wire.target = detach(wire.target as PortEndpoint);
        if (replacement) impact.reroutedWires.push(wire.id);
        else impact.detachedWires.push(wire.id);
      }
    }
  }

  private recomputeDerived(document: EditorDocument, updateInstance: boolean, impact?: MutationImpact): void {
    const geometries: Record<EntityId, ComponentGeometry> = {};
    for (const componentId of document.componentOrder) {
      const component = document.components[componentId];
      if (!component || component.hidden) continue;
      geometries[componentId] = buildComponentGeometry(component, {
        connectedPortIds: connectedPortIds(document, componentId),
        minimumPortHitSize: document.settings.portTargetSizePx,
      });
    }
    if (this.options.autoRoute) {
      const obstacles: RoutingObstacle[] = Object.values(geometries).map((geometry) => ({ id: geometry.componentId, rect: geometry.worldBody, kind: 'component' }));
      const existingRoutes: Array<{ wireId: EntityId; points: Point[]; zIndex?: number }> = [];
      for (const wireId of document.wireOrder) {
        const wire = document.wires[wireId];
        if (!wire || wire.hidden) continue;
        wire.route = routeWire(wire, { componentGeometries: geometries, obstacles, existingRoutes, revision: document.revision });
        existingRoutes.push({ wireId, points: wire.route.points, zIndex: wire.style.zIndex });
        if (impact) {
          if (!impact.reroutedWires.includes(wireId)) impact.reroutedWires.push(wireId);
          if (wire.route.status === 'invalid' && !impact.invalidatedWires.includes(wireId)) impact.invalidatedWires.push(wireId);
        }
      }
    }
    const routes = Object.fromEntries(
      document.wireOrder
        .map((id) => document.wires[id])
        .filter((wire): wire is WireEdge => Boolean(wire?.route))
        .map((wire) => [wire.id, wire.route!]),
    );
    const placementMap = placeLabels(
      document.labelOrder.map((id) => document.labels[id]).filter((label): label is LabelNode => Boolean(label)),
      new ApproximateTextMeasurer(),
      {
        components: geometries,
        routes,
        previousPlacements: Object.fromEntries(this.labelPlacementState.map((placement) => [placement.labelId, placement])),
        labelGap: document.settings.labelGap,
      },
    );
    const placements = Object.values(placementMap);
    if (impact) {
      for (const placement of placements) {
        if (!impact.movedLabels.includes(placement.labelId)) impact.movedLabels.push(placement.labelId);
        if (placement.status === 'overlap' && !impact.overlappingLabels.includes(placement.labelId)) impact.overlappingLabels.push(placement.labelId);
      }
    }
    const issues = this.options.validateOnChange ? validateDocument(document, geometries, placementMap) : [];
    if (updateInstance) {
      this.geometryState = geometries;
      this.labelPlacementState = placements;
      this.validationState = issues;
    }
  }

  private diffImpact(before: EditorDocument, after: EditorDocument): MutationImpact {
    const impact = emptyImpact();
    for (const id of new Set([...Object.keys(before.components), ...Object.keys(after.components)])) {
      if (JSON.stringify(before.components[id]) !== JSON.stringify(after.components[id])) impact.changedComponents.push(id);
    }
    for (const id of new Set([...Object.keys(before.wires), ...Object.keys(after.wires)])) {
      if (JSON.stringify(before.wires[id]) !== JSON.stringify(after.wires[id])) impact.reroutedWires.push(id);
    }
    for (const id of new Set([...Object.keys(before.labels), ...Object.keys(after.labels)])) {
      if (JSON.stringify(before.labels[id]) !== JSON.stringify(after.labels[id])) impact.movedLabels.push(id);
    }
    return impact;
  }

  private emitAll(reason: string, impact?: MutationImpact): void {
    this.events.emit('documentChanged', { document: this.documentState, reason, impact });
    this.events.emit('validationChanged', { issues: this.validationState });
    this.events.emit('historyChanged', {
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      undoLabel: this.history.undoLabel,
      redoLabel: this.history.redoLabel,
    });
  }
}
