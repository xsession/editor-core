/**
 * Framework-agnostic model contracts for engineering visual editors.
 * All coordinates are document-space logical units. The host decides how
 * logical units map to millimetres, pixels, or another engineering unit.
 */
export type EntityId = string;
export interface Point {
    x: number;
    y: number;
}
export interface Size {
    width: number;
    height: number;
}
export interface Rect extends Point, Size {
}
export interface Insets {
    top: number;
    right: number;
    bottom: number;
    left: number;
}
export type Side = 'north' | 'east' | 'south' | 'west';
export type Axis = 'horizontal' | 'vertical';
export type OrthogonalRotation = 0 | 90 | 180 | 270;
export type TextAlign = 'start' | 'middle' | 'end';
export type VerticalAlign = 'top' | 'middle' | 'bottom';
export interface TextMetrics {
    width: number;
    height: number;
    ascent: number;
    descent: number;
    lineHeight: number;
}
export interface TextMeasurer {
    measure(text: string, style?: Partial<TextStyle>): TextMetrics;
}
export interface TextStyle {
    fontFamily: string;
    fontSize: number;
    fontWeight: number | string;
    fontStyle: 'normal' | 'italic';
    lineHeight: number;
    letterSpacing: number;
    fill: string;
    background?: string;
    paddingX: number;
    paddingY: number;
    borderColor?: string;
    borderWidth: number;
    borderRadius: number;
    align: TextAlign;
}
export interface StrokeStyle {
    color: string;
    width: number;
    opacity: number;
    dash?: number[];
    lineCap: 'butt' | 'round' | 'square';
    lineJoin: 'miter' | 'round' | 'bevel';
}
export interface FillStyle {
    color: string;
    opacity: number;
}
export interface ComponentVisualStyle {
    bodyFill: string;
    bodyStroke: string;
    bodyStrokeWidth: number;
    bodyRadius: number;
    headerFill: string;
    headerText: string;
    /** Primary pin-label text rendered against the component body. */
    portLabelText?: string;
    /** Secondary pin-function text rendered against the component body. */
    portFunctionText?: string;
    rowFill: string;
    alternateRowFill?: string;
    rowStroke: string;
    pinDotFill: string;
    pinDotStroke: string;
    pinDotRadius: number;
    selectedStroke: string;
    invalidStroke: string;
    warningStroke: string;
}
export interface EditorTheme {
    id: string;
    background: string;
    gridMinor: string;
    gridMajor: string;
    guide: string;
    selection: string;
    selectionHalo: string;
    hover: string;
    validTarget: string;
    invalidTarget: string;
    warning: string;
    error: string;
    text: string;
    mutedText: string;
    labelBackground: string;
    labelBorder: string;
    wireOutline: string;
    wireDefault: string;
    component: ComponentVisualStyle;
}
export type ElectricalClass = 'passive' | 'power-input' | 'power-output' | 'signal-input' | 'signal-output' | 'bidirectional' | 'ground' | 'shield' | 'unknown';
export interface ConnectionPolicy {
    maximumConnections: number;
    allowSelfConnection: boolean;
    allowWireKinds?: WireKind[];
    allowedElectricalClasses?: ElectricalClass[];
    requiredMateGroup?: string;
}
export interface PortSpec {
    id: EntityId;
    label: string;
    function?: string;
    detail?: string;
    side: Side;
    order: number;
    bankId?: string;
    visible: boolean;
    electricalClass: ElectricalClass;
    connectionPolicy: ConnectionPolicy;
    /** Optional normalized position along its side, 0..1. Auto layout when absent. */
    sideFraction?: number;
    /** Tangential offset after automatic placement. */
    tangentOffset?: number;
    /** Normal offset from the body edge. Positive points outward. */
    normalOffset?: number;
    /** Optional explicit row height contribution. */
    minimumRowHeight?: number;
    metadata?: Record<string, unknown>;
}
export type PinBankFlow = 'forward' | 'reverse' | 'center-out';
export interface PinBankSpec {
    id: string;
    side: Side;
    portIds: EntityId[];
    flow: PinBankFlow;
    rowGap: number;
    edgePadding: number;
    labelColumnWidth?: number;
    functionColumnWidth?: number;
    collapseEmpty: boolean;
    header?: string;
}
export type ComponentKind = 'connector' | 'terminal-point' | 'termination' | 'device' | 'inline-device' | 'passive' | 'branch-point' | 'custom';
export interface ComponentLabelFields {
    title: string;
    subtitle?: string;
    manufacturer?: string;
    partNumber?: string;
    description?: string;
}
export interface ComponentLayoutRules {
    minimumSize: Size;
    maximumSize?: Size;
    padding: Insets;
    headerHeight: number;
    footerHeight: number;
    rowHeight: number;
    rowGap: number;
    bankGap: number;
    autoWidth: boolean;
    autoHeight: boolean;
    preserveManualSize: boolean;
    portLeadIn: number;
    obstaclePadding: number;
    labelGap: number;
}
export interface ComponentNode {
    id: EntityId;
    definitionId?: string;
    kind: ComponentKind;
    designator: string;
    labels: ComponentLabelFields;
    position: Point;
    size?: Size;
    rotation: OrthogonalRotation;
    mirrorX: boolean;
    mirrorY: boolean;
    ports: PortSpec[];
    pinBanks: PinBankSpec[];
    layout: ComponentLayoutRules;
    style?: Partial<ComponentVisualStyle>;
    locked: boolean;
    hidden: boolean;
    zIndex: number;
    metadata?: Record<string, unknown>;
}
export interface PortGeometry {
    portId: EntityId;
    componentId: EntityId;
    center: Point;
    normal: Point;
    tangent: Point;
    side: Side;
    hitBounds: Rect;
    rowBounds?: Rect;
    /** World-space SVG anchor point for the primary pin label. */
    labelPoint?: Point;
    labelBounds?: Rect;
    /** World-space SVG anchor point for the secondary pin function. */
    functionPoint?: Point;
    functionBounds?: Rect;
    textAnchor?: TextAlign;
}
export interface ComponentGeometry {
    componentId: EntityId;
    localBody: Rect;
    worldBody: Rect;
    worldBounds: Rect;
    headerBounds: Rect;
    footerBounds?: Rect;
    ports: Record<EntityId, PortGeometry>;
    rowBounds: Record<EntityId, Rect>;
    titlePoint: Point;
    subtitlePoint?: Point;
    rotation: OrthogonalRotation;
}
export type EndpointKind = 'port' | 'free' | 'off-page' | 'junction';
export interface PortEndpoint {
    kind: 'port';
    componentId: EntityId;
    portId: EntityId;
}
export interface FreeEndpoint {
    kind: 'free';
    point: Point;
    direction?: Side;
    termination?: string;
}
export interface OffPageEndpoint {
    kind: 'off-page';
    point: Point;
    reference: string;
    direction?: Side;
}
export interface JunctionEndpoint {
    kind: 'junction';
    point: Point;
    junctionId: EntityId;
}
export type WireEndpoint = PortEndpoint | FreeEndpoint | OffPageEndpoint | JunctionEndpoint;
export type WireKind = 'discrete' | 'cable-core' | 'shield' | 'drain' | 'bundle' | 'mate' | 'annotation';
export type RoutePattern = 'direct' | 'orthogonal' | 'horizontal-first' | 'vertical-first' | 'dogleg-horizontal' | 'dogleg-vertical' | 'trunk-horizontal' | 'trunk-vertical' | 'manual';
export type RouteConstraintKind = 'waypoint' | 'locked-waypoint' | 'corridor-horizontal' | 'corridor-vertical' | 'avoid-rect' | 'prefer-rect' | 'locked-segment';
export interface RouteConstraint {
    id: EntityId;
    kind: RouteConstraintKind;
    point?: Point;
    rect?: Rect;
    coordinate?: number;
    segmentIndex?: number;
    strength: 'hard' | 'strong' | 'soft';
    ownerFrame: 'world' | 'source' | 'target';
    metadata?: Record<string, unknown>;
}
export interface RoutingOptions {
    pattern: RoutePattern;
    clearance: number;
    grid: number;
    leadIn: number;
    requestedRadius: number;
    minimumSegment: number;
    bendPenalty: number;
    crossingPenalty: number;
    proximityPenalty: number;
    reversePenalty: number;
    previousRouteStability: number;
    maxSearchNodes: number;
    allowCrossings: boolean;
    preferSharedChannels: boolean;
    constraints: RouteConstraint[];
    trunkCoordinate?: number;
    doglegCoordinate?: number;
}
export type WireColorPattern = {
    kind: 'solid';
    color: string;
} | {
    kind: 'stripe';
    base: string;
    stripe: string;
    stripeWidth: number;
    repeat: number;
} | {
    kind: 'tracer';
    base: string;
    tracer: string;
    repeat: number;
    tracerLength: number;
} | {
    kind: 'dual';
    primary: string;
    secondary: string;
    ratio: number;
} | {
    kind: 'shield';
    sheath: string;
    core?: string;
} | {
    kind: 'custom';
    layers: WirePaintLayer[];
};
export interface WirePaintLayer {
    color: string;
    width: number;
    opacity?: number;
    dash?: number[];
    dashOffset?: number;
    lineCap?: 'butt' | 'round' | 'square';
}
export interface WireStyle {
    pattern: WireColorPattern;
    width: number;
    outlineWidth: number;
    opacity: number;
    selectedDash?: number[];
    lineCap: 'butt' | 'round' | 'square';
    lineJoin: 'miter' | 'round' | 'bevel';
    zIndex: number;
}
export interface WireEdge {
    id: EntityId;
    kind: WireKind;
    label?: string;
    signal?: string;
    source: WireEndpoint;
    target: WireEndpoint;
    routing: RoutingOptions;
    style: WireStyle;
    route?: RouteResult;
    locked: boolean;
    hidden: boolean;
    metadata?: Record<string, unknown>;
}
export interface RouteSegment {
    start: Point;
    end: Point;
    axis: Axis | 'diagonal';
    length: number;
}
export interface RouteCrossing {
    point: Point;
    wireA: EntityId;
    wireB: EntityId;
    overWire: EntityId;
    underWire: EntityId;
}
export interface RouteResult {
    points: Point[];
    segments: RouteSegment[];
    cornerRadii: number[];
    length: number;
    bends: number;
    crossings: number;
    obstacleViolations: EntityId[];
    status: 'valid' | 'fallback' | 'invalid';
    diagnostics: string[];
    generatedAtRevision?: number;
}
export type LabelOwnerKind = 'component' | 'port' | 'wire' | 'free' | 'group';
export type LabelPlacementMode = 'auto' | 'owner-relative' | 'world-pinned';
export type LabelOrientation = 'horizontal' | 'follow-segment' | 'vertical';
export type ComponentLabelCandidate = 'north' | 'north-east' | 'east' | 'south-east' | 'south' | 'south-west' | 'west' | 'north-west' | 'inside-header' | 'inside-body';
export interface LabelAnchor {
    ownerKind: LabelOwnerKind;
    ownerId?: EntityId;
    portId?: EntityId;
    wireFraction?: number;
    segmentIndex?: number;
    point?: Point;
    preferredCandidates?: ComponentLabelCandidate[];
}
export interface LabelNode {
    id: EntityId;
    text: string;
    secondaryText?: string;
    anchor: LabelAnchor;
    mode: LabelPlacementMode;
    orientation: LabelOrientation;
    offset: Point;
    worldPosition?: Point;
    priority: number;
    avoidWires: boolean;
    avoidComponents: boolean;
    allowLeader: boolean;
    visible: boolean;
    locked: boolean;
    style: Partial<TextStyle>;
    metadata?: Record<string, unknown>;
}
export interface LabelPlacement {
    labelId: EntityId;
    position: Point;
    bounds: Rect;
    anchorPoint: Point;
    rotation: number;
    leader?: {
        start: Point;
        end: Point;
    };
    candidate?: ComponentLabelCandidate;
    score: number;
    collisions: EntityId[];
    status: 'placed' | 'overlap' | 'invalid-anchor';
}
export interface ViewportState {
    pan: Point;
    zoom: number;
    width: number;
    height: number;
}
export interface GridSettings {
    visible: boolean;
    snap: boolean;
    spacing: number;
    majorEvery: number;
    opacity: number;
}
export interface EditorSettings {
    grid: GridSettings;
    defaultRouting: RoutingOptions;
    labelGap: number;
    hitTolerancePx: number;
    portTargetSizePx: number;
    componentHandleSizePx: number;
    wireBridgeRadius: number;
    preserveManualRoutesOnMove: boolean;
    reflowLabelsOnEdit: boolean;
    reduceMotion: boolean;
}
export interface EditorDocument {
    schemaVersion: 1;
    id: EntityId;
    revision: number;
    settings: EditorSettings;
    components: Record<EntityId, ComponentNode>;
    wires: Record<EntityId, WireEdge>;
    labels: Record<EntityId, LabelNode>;
    componentOrder: EntityId[];
    wireOrder: EntityId[];
    labelOrder: EntityId[];
    metadata?: Record<string, unknown>;
}
export type SelectionKind = 'component' | 'port' | 'wire' | 'label' | 'route-handle';
export interface SelectionRef {
    kind: SelectionKind;
    id: EntityId;
    subId?: EntityId | number;
}
export interface SelectionState {
    items: SelectionRef[];
    primary?: SelectionRef;
}
export type HitKind = 'component-body' | 'component-header' | 'port' | 'wire' | 'label' | 'route-waypoint' | 'route-segment' | 'resize-handle' | 'rotate-handle';
export interface HitResult {
    kind: HitKind;
    entityId: EntityId;
    subId?: EntityId | number;
    distance: number;
    zIndex: number;
    point: Point;
}
export interface ModifierState {
    shift: boolean;
    alt: boolean;
    ctrl: boolean;
    meta: boolean;
    space: boolean;
}
export type PointerButton = 0 | 1 | 2;
export interface EditorPointerEvent {
    pointerId: number;
    point: Point;
    screenPoint: Point;
    button: PointerButton;
    buttons: number;
    pointerType: 'mouse' | 'pen' | 'touch';
    pressure: number;
    modifiers: ModifierState;
    timestamp: number;
}
export interface ValidationIssue {
    id: string;
    severity: 'info' | 'warning' | 'error';
    code: string;
    message: string;
    entityIds: EntityId[];
    suggestedAction?: string;
}
export interface MutationImpact {
    changedComponents: EntityId[];
    changedPorts: EntityId[];
    reroutedWires: EntityId[];
    invalidatedWires: EntityId[];
    detachedWires: EntityId[];
    movedLabels: EntityId[];
    overlappingLabels: EntityId[];
    warnings: string[];
}
export interface EditorFeedback {
    kind: 'status' | 'toast' | 'warning' | 'error' | 'route-preview' | 'target-preview' | 'announcement';
    message: string;
    entityIds?: EntityId[];
    persistent?: boolean;
}
export interface EditorEventMap {
    documentChanged: {
        document: EditorDocument;
        reason: string;
        impact?: MutationImpact;
    };
    selectionChanged: {
        selection: SelectionState;
    };
    validationChanged: {
        issues: ValidationIssue[];
    };
    feedback: EditorFeedback;
    historyChanged: {
        canUndo: boolean;
        canRedo: boolean;
        undoLabel?: string;
        redoLabel?: string;
    };
    interactionChanged: {
        state: string;
    };
}
export interface IdFactory {
    next(prefix: string): EntityId;
}
export interface ComponentMutationOptions {
    connectedPortRemoval: 'prevent' | 'detach' | 'remap-by-label';
    reroute: 'none' | 'preview' | 'full';
    reflowLabels: boolean;
}
export interface RenderOptions {
    viewport?: Rect;
    showGrid: boolean;
    showPorts: boolean;
    showLabels: boolean;
    showRouteHandles: boolean;
    showSelection: boolean;
    showDiagnostics: boolean;
    includeAccessibility: boolean;
    background?: string;
}
//# sourceMappingURL=types.d.ts.map