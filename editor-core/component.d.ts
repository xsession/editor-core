import type { ComponentGeometry, ComponentKind, ComponentLabelFields, ComponentLayoutRules, ComponentNode, ComponentVisualStyle, ConnectionPolicy, ElectricalClass, EntityId, PinBankSpec, Point, PortSpec, Side, Size, TextMeasurer, TextMetrics, TextStyle } from './types.js';
export declare const DEFAULT_CONNECTION_POLICY: ConnectionPolicy;
export declare const DEFAULT_COMPONENT_LAYOUT: ComponentLayoutRules;
export declare const DEFAULT_COMPONENT_STYLE: ComponentVisualStyle;
export declare const DEFAULT_TEXT_STYLE: TextStyle;
export declare class ApproximateTextMeasurer implements TextMeasurer {
    measure(text: string, style?: Partial<TextStyle>): TextMetrics;
}
export interface ComponentGeometryOptions {
    textMeasurer?: TextMeasurer;
    connectedPortIds?: ReadonlySet<EntityId>;
    minimumPortHitSize?: number;
    titleStyle?: Partial<TextStyle>;
    subtitleStyle?: Partial<TextStyle>;
    portLabelStyle?: Partial<TextStyle>;
    portFunctionStyle?: Partial<TextStyle>;
}
export declare function buildComponentGeometry(component: ComponentNode, options?: ComponentGeometryOptions): ComponentGeometry;
export declare function componentPortMap(component: ComponentNode): Map<EntityId, PortSpec>;
export declare function componentCenter(component: ComponentNode): Point;
export declare function cloneComponent(component: ComponentNode): ComponentNode;
export declare function moveComponent(component: ComponentNode, delta: Point): ComponentNode;
export declare function rotateComponent(component: ComponentNode, clockwise?: boolean): ComponentNode;
export declare function resizeComponent(component: ComponentNode, size: Size): ComponentNode;
export interface AddPortInput {
    id?: EntityId;
    label: string;
    function?: string;
    detail?: string;
    side?: Side;
    order?: number;
    bankId?: string;
    electricalClass?: ElectricalClass;
    connectionPolicy?: Partial<ConnectionPolicy>;
}
export declare class ComponentBuilder {
    private readonly node;
    constructor(id: EntityId, designator: string, kind?: ComponentKind);
    definition(id: string): this;
    at(x: number, y: number): this;
    withLabels(labels: Partial<ComponentLabelFields>): this;
    withLayout(layout: Partial<ComponentLayoutRules>): this;
    withStyle(style: Partial<ComponentVisualStyle>): this;
    withSize(width: number, height: number): this;
    rotate(rotation: 0 | 90 | 180 | 270): this;
    addBank(bank: Omit<PinBankSpec, 'portIds'> & {
        portIds?: EntityId[];
    }): this;
    addPort(input: AddPortInput): this;
    addPorts(count: number, options?: {
        side?: Side;
        bankId?: string;
        label?: (index: number) => string;
        function?: (index: number) => string | undefined;
        id?: (index: number) => EntityId;
        electricalClass?: ElectricalClass;
        maximumConnections?: number;
    }): this;
    build(): ComponentNode;
}
export declare function createConnector(id: EntityId, designator: string, pinCount: number, position: Point, side?: Side): ComponentNode;
export declare function bodyAnchorPoint(geometry: ComponentGeometry, side: Side, offset?: number): Point;
export declare function localBodyCenter(geometry: ComponentGeometry): Point;
//# sourceMappingURL=component.d.ts.map