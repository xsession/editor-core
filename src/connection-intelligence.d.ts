import type { ComponentGeometry, EditorDocument, EntityId, Point, RouteResult, WireEndpoint, WireKind } from './types.js';
import type { SceneSpatialIndex } from './advanced-visual.js';
import type { RoutingContext } from './routing.js';

export interface ConnectionCandidate {
    endpoint: { kind: 'port'; componentId: EntityId; portId: EntityId };
    componentId: EntityId;
    portId: EntityId;
    point: Point;
    distancePx: number;
    facing: number;
    electricalAffinity: number;
    valid: boolean;
    reasons: string[];
    score: number;
    port: unknown;
}
export interface ConnectionCandidateOptions {
    snapRadiusPx?: number;
    releaseRadiusPx?: number;
    facingWeight?: number;
    electricalWeight?: number;
    wireKind?: WireKind;
    includeInvalid?: boolean;
    limit?: number;
}
export declare function findConnectionCandidates(document: EditorDocument, sourceEndpoint: WireEndpoint, pointer: Point, context: { zoom: number; componentGeometries: Record<EntityId, ComponentGeometry> }, spatialIndex: SceneSpatialIndex, options?: ConnectionCandidateOptions): ConnectionCandidate[];

export declare class MagneticConnectionSession {
    active?: ConnectionCandidate;
    readonly sourceEndpoint: WireEndpoint;
    readonly options: ConnectionCandidateOptions;
    constructor(sourceEndpoint: WireEndpoint, options?: ConnectionCandidateOptions);
    update(pointer: Point, document: EditorDocument, context: { zoom: number; componentGeometries: Record<EntityId, ComponentGeometry> }, spatialIndex: SceneSpatialIndex): { candidate?: ConnectionCandidate; snappedPoint: Point; acquired: boolean };
    clear(): void;
}

export declare function createConnectionPreview(sourceEndpoint: WireEndpoint, pointerOrTarget: Point | WireEndpoint, context: RoutingContext, options?: {
    id?: EntityId;
    wireKind?: WireKind;
    maxSearchNodes?: number;
    routing?: Record<string, unknown>;
    style?: Record<string, unknown>;
}): RouteResult;
