import type { EditorDocument, EntityId } from './types.js';
export interface SpatialPoint {
    x: number;
    y: number;
    z: number;
}
export interface SpatialCablePath {
    id: EntityId;
    wireId: EntityId;
    label: string;
    diameterMm: number;
    minimumBendRadiusMm: number;
    color: string;
    controlPoints: SpatialPoint[];
    lockedPointIndices: number[];
    surfaceMode: 'free' | 'on-surface' | 'inside-product';
}
export interface SpatialViewpoint {
    id: EntityId;
    name: string;
    position: SpatialPoint;
    target: SpatialPoint;
    createdAt: string;
}
export interface SpatialProductModel {
    name: string;
    mediaType: 'model/gltf-binary';
    dataUrl: string;
    opacity: number;
}
export interface SpatialHarnessDocument {
    version: 1;
    unit: 'mm';
    cables: Record<EntityId, SpatialCablePath>;
    cableOrder: EntityId[];
    viewpoints: SpatialViewpoint[];
    productModel?: SpatialProductModel;
}
export interface SpatialCableAnalysis {
    lengthMm: number;
    minimumObservedBendRadiusMm: number | null;
    bendViolations: Array<{
        pointIndex: number;
        radiusMm: number;
        requiredMm: number;
    }>;
    valid: boolean;
}
export declare function createSpatialHarnessDocument(document: EditorDocument, previous?: SpatialHarnessDocument): SpatialHarnessDocument;
export declare function analyzeSpatialCable(path: SpatialCablePath): SpatialCableAnalysis;
export declare function insertSpatialControlPoint(path: SpatialCablePath, afterIndex: number): SpatialCablePath;
//# sourceMappingURL=spatial-harness.d.ts.map