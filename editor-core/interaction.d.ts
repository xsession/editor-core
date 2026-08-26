import type { EditorPointerEvent, EntityId, HitResult, ModifierState, Point, Rect, WireEndpoint } from './types.js';
import { HarnessEditorEngine } from './engine.js';
import { type SnapGuide } from './snapping.js';
export type InteractionState = {
    kind: 'idle';
} | {
    kind: 'marquee';
    pointerId: number;
    start: Point;
    current: Point;
    additive: boolean;
    subtractive: boolean;
} | {
    kind: 'drag-components';
    pointerId: number;
    start: Point;
    componentIds: EntityId[];
} | {
    kind: 'drag-label';
    pointerId: number;
    start: Point;
    labelId: EntityId;
} | {
    kind: 'drag-wire-segment';
    pointerId: number;
    start: Point;
    wireId: EntityId;
    segmentIndex: number;
    originalPoints: Point[];
} | {
    kind: 'connect-wire';
    pointerId: number;
    source: WireEndpoint;
    current: Point;
    target?: WireEndpoint;
    valid: boolean;
    reason?: string;
} | {
    kind: 'pan';
    pointerId: number;
    start: Point;
    current: Point;
};
export interface InteractionEventMap {
    stateChanged: {
        state: InteractionState;
    };
    marqueeChanged: {
        bounds?: Rect;
        mode?: 'window' | 'crossing';
    };
    connectionPreview: {
        source?: WireEndpoint;
        target?: WireEndpoint;
        point?: Point;
        valid?: boolean;
        reason?: string;
    };
    panRequested: {
        delta: Point;
    };
    cursorRequested: {
        cursor: string;
    };
    contextMenuRequested: {
        point: Point;
        hit?: HitResult;
    };
    snapGuidesChanged: {
        guides: SnapGuide[];
    };
}
export interface InteractionControllerOptions {
    zoom: () => number;
    dragThresholdPx?: number;
    enableTouchPan?: boolean;
}
export declare class EditorInteractionController {
    private readonly engine;
    private readonly options;
    private stateValue;
    private readonly events;
    private readonly dragThresholdPx;
    private componentDragStartGeometries?;
    constructor(engine: HarnessEditorEngine, options: InteractionControllerOptions);
    get state(): Readonly<InteractionState>;
    on<TKey extends keyof InteractionEventMap>(type: TKey, listener: (event: InteractionEventMap[TKey]) => void): () => void;
    pointerDown(event: EditorPointerEvent): void;
    pointerMove(event: EditorPointerEvent): void;
    pointerUp(event: EditorPointerEvent): void;
    pointerCancel(pointerId: number): void;
    keyDown(key: string, modifiers: ModifierState): boolean;
    private hitsAt;
    private setState;
}
//# sourceMappingURL=interaction.d.ts.map