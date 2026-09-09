import { ComponentBuilder } from './component.js';
import { DEFAULT_WIRE_STYLE, HarnessEditorEngine, SequentialIdFactory, createEmptyDocument } from './engine.js';
function wire(document, id, source, target, label, pattern, routePattern = 'orthogonal', requestedRadius = 10) {
    return {
        id,
        kind: 'discrete',
        label,
        signal: label,
        source,
        target,
        routing: {
            ...document.settings.defaultRouting,
            pattern: routePattern,
            requestedRadius,
            constraints: [],
        },
        style: {
            ...DEFAULT_WIRE_STYLE,
            pattern,
            width: 4,
            zIndex: document.wireOrder.length,
        },
        locked: false,
        hidden: false,
    };
}
function label(id, text, ownerId, ownerKind, priority = 10) {
    return {
        id,
        text,
        anchor: { ownerKind, ownerId, wireFraction: ownerKind === 'wire' ? 0.5 : undefined },
        mode: 'auto',
        orientation: ownerKind === 'wire' ? 'follow-segment' : 'horizontal',
        offset: { x: 0, y: 0 },
        priority,
        avoidWires: ownerKind !== 'wire',
        avoidComponents: true,
        allowLeader: true,
        visible: true,
        locked: false,
        style: ownerKind === 'wire' ? { fontSize: 10 } : {},
    };
}
/** Creates a deterministic document used by tests, screenshots, and the browser demo. */
export function createSampleDocument() {
    const document = createEmptyDocument('sample-harness');
    document.settings.grid.spacing = 10;
    document.settings.defaultRouting.grid = 10;
    document.settings.defaultRouting.clearance = 16;
    document.settings.defaultRouting.leadIn = 28;
    document.settings.defaultRouting.requestedRadius = 6;
    document.settings.defaultRouting.minimumSegment = 2;
    const source = new ComponentBuilder('J1', 'J1', 'connector')
        .at(80, 120)
        .withLabels({ title: 'J1', subtitle: 'POWER / CAN' })
        .addBank({ id: 'J1:east', side: 'east', flow: 'forward', rowGap: 2, edgePadding: 12, collapseEmpty: false })
        .addPort({ id: 'J1:1', label: '1', function: 'VBAT', side: 'east', bankId: 'J1:east', electricalClass: 'power-output' })
        .addPort({ id: 'J1:2', label: '2', function: 'GND', side: 'east', bankId: 'J1:east', electricalClass: 'ground' })
        .addPort({ id: 'J1:3', label: '3', function: 'CAN_H', side: 'east', bankId: 'J1:east', electricalClass: 'bidirectional' })
        .addPort({ id: 'J1:4', label: '4', function: 'CAN_L', side: 'east', bankId: 'J1:east', electricalClass: 'bidirectional' })
        .addPort({ id: 'J1:5', label: '5', function: 'IGN', side: 'east', bankId: 'J1:east', electricalClass: 'signal-output' })
        .addPort({ id: 'J1:6', label: '6', function: 'WAKE', side: 'east', bankId: 'J1:east', electricalClass: 'signal-output' })
        .build();
    const ecu = new ComponentBuilder('A1', 'A1', 'device')
        .at(390, 80)
        .withLabels({ title: 'A1', subtitle: 'CONTROL UNIT', manufacturer: 'Editor Core' })
        .addBank({ id: 'A1:west', side: 'west', flow: 'forward', rowGap: 2, edgePadding: 12, collapseEmpty: false })
        .addBank({ id: 'A1:east', side: 'east', flow: 'forward', rowGap: 2, edgePadding: 12, collapseEmpty: false })
        .addPort({ id: 'A1:1', label: 'P1', function: 'VBAT_IN', side: 'west', bankId: 'A1:west', electricalClass: 'power-input' })
        .addPort({ id: 'A1:2', label: 'P2', function: 'GND', side: 'west', bankId: 'A1:west', electricalClass: 'ground' })
        .addPort({ id: 'A1:3', label: 'P3', function: 'CAN_H', side: 'west', bankId: 'A1:west', electricalClass: 'bidirectional' })
        .addPort({ id: 'A1:4', label: 'P4', function: 'CAN_L', side: 'west', bankId: 'A1:west', electricalClass: 'bidirectional' })
        .addPort({ id: 'A1:5', label: 'P5', function: 'IGN_SENSE', side: 'east', bankId: 'A1:east', electricalClass: 'signal-input' })
        .addPort({ id: 'A1:6', label: 'P6', function: 'WAKE_IN', side: 'east', bankId: 'A1:east', electricalClass: 'signal-input' })
        .build();
    const destination = new ComponentBuilder('J2', 'J2', 'connector')
        .at(760, 150)
        .rotate(90)
        .withLabels({ title: 'J2', subtitle: 'SERVICE HEADER' })
        .addBank({ id: 'J2:west', side: 'west', flow: 'forward', rowGap: 2, edgePadding: 12, collapseEmpty: false })
        .addPort({ id: 'J2:1', label: '1', function: 'IGN', side: 'west', bankId: 'J2:west', electricalClass: 'signal-input' })
        .addPort({ id: 'J2:2', label: '2', function: 'WAKE', side: 'west', bankId: 'J2:west', electricalClass: 'signal-input' })
        .addPort({ id: 'J2:3', label: '3', function: 'GND', side: 'west', bankId: 'J2:west', electricalClass: 'ground' })
        .build();
    for (const component of [source, ecu, destination]) {
        document.components[component.id] = component;
        document.componentOrder.push(component.id);
    }
    const wires = [
        wire(document, 'W1', { kind: 'port', componentId: 'J1', portId: 'J1:1' }, { kind: 'port', componentId: 'A1', portId: 'A1:1' }, 'VBAT', { kind: 'solid', color: '#dc2626' }, 'horizontal-first', 6),
        wire(document, 'W2', { kind: 'port', componentId: 'J1', portId: 'J1:2' }, { kind: 'port', componentId: 'A1', portId: 'A1:2' }, 'GND', { kind: 'stripe', base: '#111827', stripe: '#facc15', stripeWidth: 1.5, repeat: 14 }, 'orthogonal', 5),
        wire(document, 'W3', { kind: 'port', componentId: 'J1', portId: 'J1:3' }, { kind: 'port', componentId: 'A1', portId: 'A1:3' }, 'CAN_H', { kind: 'tracer', base: '#16a34a', tracer: '#ffffff', repeat: 16, tracerLength: 5 }, 'dogleg-horizontal', 2),
        wire(document, 'W4', { kind: 'port', componentId: 'J1', portId: 'J1:4' }, { kind: 'port', componentId: 'A1', portId: 'A1:4' }, 'CAN_L', { kind: 'dual', primary: '#facc15', secondary: '#16a34a', ratio: 0.55 }, 'dogleg-horizontal', 1),
        wire(document, 'W5', { kind: 'port', componentId: 'A1', portId: 'A1:5' }, { kind: 'port', componentId: 'J2', portId: 'J2:1' }, 'IGN', { kind: 'solid', color: '#f97316' }, 'orthogonal', 1),
        wire(document, 'W6', { kind: 'port', componentId: 'A1', portId: 'A1:6' }, { kind: 'port', componentId: 'J2', portId: 'J2:2' }, 'WAKE', { kind: 'shield', sheath: '#94a3b8', core: '#2563eb' }, 'vertical-first', 10),
    ];
    for (const item of wires) {
        document.wires[item.id] = item;
        document.wireOrder.push(item.id);
    }
    const labels = [
        label('L-J1', 'SOURCE CONNECTOR', 'J1', 'component', 30),
        label('L-A1', 'CONTROL UNIT', 'A1', 'component', 30),
        label('L-J2', 'SERVICE', 'J2', 'component', 30),
        label('L-W3', 'CAN TWISTED PAIR', 'W3', 'wire', 20),
        label('L-W6', 'SHIELDED WAKE', 'W6', 'wire', 20),
    ];
    for (const item of labels) {
        document.labels[item.id] = item;
        document.labelOrder.push(item.id);
    }
    return document;
}
export function createSampleEngine() {
    return new HarnessEditorEngine(createSampleDocument(), {
        idFactory: new SequentialIdFactory(),
        autoRoute: true,
        validateOnChange: true,
    });
}
//# sourceMappingURL=sample.js.map