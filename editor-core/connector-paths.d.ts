import type { EntityId, Point, RouteCrossing } from './types.js';
export declare function polylineConnectorPath(points: Point[]): string;
export declare function smoothConnectorPath(points: Point[], tension?: number): string;
export declare function jumpOverConnectorPath(points: Point[], crossings: RouteCrossing[], wireId: EntityId, radius?: number): string;
export type ConnectorPathBuilder = (points: Point[], options?: Record<string, any>) => string;
export declare class ConnectorPathRegistry {
    readonly connectors: Map<string, ConnectorPathBuilder>;
    constructor();
    register(name: string, connector: ConnectorPathBuilder): this;
    build(name: string, points: Point[], options?: Record<string, any>): string;
}
