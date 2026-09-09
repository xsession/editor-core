import { createEmptyDocument, DEFAULT_WIRE_STYLE } from '../editor-core/engine.js';
import { DEFAULT_ROUTING_OPTIONS } from '../editor-core/routing.js';

const COMPONENT_LAYOUT = Object.freeze({
    minimumSize: { width: 86, height: 52 },
    padding: { top: 8, right: 8, bottom: 8, left: 8 },
    headerHeight: 22,
    footerHeight: 0,
    rowHeight: 18,
    rowGap: 2,
    bankGap: 4,
    autoWidth: false,
    autoHeight: false,
    preserveManualSize: true,
    portLeadIn: 16,
    obstaclePadding: 8,
    labelGap: 8,
});

function port(id, label, side, order, electricalClass) {
    return {
        id,
        label,
        side,
        order,
        visible: true,
        electricalClass,
        connectionPolicy: {
            maximumConnections: 8,
            allowSelfConnection: false,
        },
    };
}

export function makeBenchmarkComponent(index, columns, spacingX = 150, spacingY = 90) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const id = `c${index}`;
    return {
        id,
        kind: 'device',
        designator: `U${index + 1}`,
        labels: { title: `NODE ${index + 1}` },
        position: { x: column * spacingX + 60, y: row * spacingY + 45 },
        size: { width: 86, height: 52 },
        rotation: 0,
        mirrorX: false,
        mirrorY: false,
        ports: [
            port(`${id}:in`, 'IN', 'west', 0, 'signal-input'),
            port(`${id}:out`, 'OUT', 'east', 1, 'signal-output'),
        ],
        pinBanks: [],
        layout: { ...COMPONENT_LAYOUT, minimumSize: { ...COMPONENT_LAYOUT.minimumSize }, padding: { ...COMPONENT_LAYOUT.padding } },
        locked: false,
        hidden: false,
        zIndex: 0,
    };
}

export function generateBenchmarkDocument(componentCount, options = {}) {
    const document = createEmptyDocument(`benchmark-${componentCount}`);
    document.settings.grid.visible = false;
    document.settings.grid.snap = false;
    const columns = options.columns ?? Math.max(10, Math.ceil(Math.sqrt(componentCount * 1.6)));
    for (let index = 0; index < componentCount; index += 1) {
        const component = makeBenchmarkComponent(index, columns, options.spacingX, options.spacingY);
        document.components[component.id] = component;
        document.componentOrder.push(component.id);
    }

    const wireStride = Math.max(1, options.wireStride ?? 4);
    if (options.includeWires !== false) {
        let wireIndex = 0;
        for (let index = 0; index + wireStride < componentCount; index += wireStride) {
            const sourceId = `c${index}`;
            const targetId = `c${index + wireStride}`;
            const id = `w${wireIndex++}`;
            document.wires[id] = {
                id,
                kind: 'discrete',
                source: { kind: 'port', componentId: sourceId, portId: `${sourceId}:out` },
                target: { kind: 'port', componentId: targetId, portId: `${targetId}:in` },
                routing: { ...DEFAULT_ROUTING_OPTIONS, constraints: [] },
                style: { ...DEFAULT_WIRE_STYLE, pattern: { ...DEFAULT_WIRE_STYLE.pattern } },
                locked: false,
                hidden: false,
            };
            document.wireOrder.push(id);
        }
    }
    return document;
}
