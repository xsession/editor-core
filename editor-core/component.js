import { boundsFromPoints, clamp, rect, rectCenter, rotateSide, sideNormal, sideTangent, transformLocalPoint, transformLocalVector, unionRects, } from './geometry.js';
export const DEFAULT_CONNECTION_POLICY = {
    maximumConnections: 1,
    allowSelfConnection: false,
};
export const DEFAULT_COMPONENT_LAYOUT = {
    minimumSize: { width: 150, height: 88 },
    padding: { top: 10, right: 12, bottom: 10, left: 12 },
    headerHeight: 38,
    footerHeight: 0,
    rowHeight: 24,
    rowGap: 0,
    bankGap: 8,
    autoWidth: true,
    autoHeight: true,
    preserveManualSize: true,
    portLeadIn: 20,
    obstaclePadding: 10,
    labelGap: 8,
};
export const DEFAULT_COMPONENT_STYLE = {
    bodyFill: '#ffffff',
    bodyStroke: '#4b5563',
    bodyStrokeWidth: 1.5,
    bodyRadius: 4,
    headerFill: '#f3f4f6',
    headerText: '#111827',
    portLabelText: '#334155',
    portFunctionText: '#64748b',
    rowFill: '#ffffff',
    alternateRowFill: '#f9fafb',
    rowStroke: '#e5e7eb',
    pinDotFill: '#111827',
    pinDotStroke: '#ffffff',
    pinDotRadius: 4,
    selectedStroke: '#2563eb',
    invalidStroke: '#dc2626',
    warningStroke: '#d97706',
};
export const DEFAULT_TEXT_STYLE = {
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    fontSize: 12,
    fontWeight: 400,
    fontStyle: 'normal',
    lineHeight: 16,
    letterSpacing: 0,
    fill: '#111827',
    paddingX: 4,
    paddingY: 2,
    borderWidth: 0,
    borderRadius: 2,
    align: 'start',
};
export class ApproximateTextMeasurer {
    measure(text, style = {}) {
        const resolved = { ...DEFAULT_TEXT_STYLE, ...style };
        const lines = text.length === 0 ? [''] : text.split(/\r?\n/u);
        const widthFactor = 0.58;
        const longest = Math.max(...lines.map((line) => [...line].length));
        const width = Math.max(0, longest * resolved.fontSize * widthFactor + resolved.letterSpacing * Math.max(0, longest - 1));
        const height = lines.length * resolved.lineHeight;
        return {
            width,
            height,
            ascent: resolved.fontSize * 0.78,
            descent: resolved.fontSize * 0.22,
            lineHeight: resolved.lineHeight,
        };
    }
}
function visibleBankPorts(component, bank, connectedPortIds) {
    const lookup = new Map(component.ports.map((port) => [port.id, port]));
    const ports = bank.portIds
        .map((id) => lookup.get(id))
        .filter((value) => Boolean(value?.visible))
        .filter((port) => !bank.collapseEmpty || connectedPortIds.has(port.id));
    if (bank.flow === 'reverse')
        return [...ports].reverse();
    if (bank.flow === 'center-out') {
        return [...ports].sort((a, b) => {
            const center = (ports.length - 1) / 2;
            const da = Math.abs(a.order - center);
            const db = Math.abs(b.order - center);
            return da === db ? a.order - b.order : da - db;
        });
    }
    return ports;
}
/**
 * Returns deterministic pin banks whose membership agrees with each port's
 * current side. A component can be rebuilt by editing only PortSpec.side; stale
 * bank references are ignored and the port is placed into a synthetic bank on
 * its new side. This keeps direct manipulation and library previews safe even
 * while a host is incrementally rebuilding the pin matrix.
 */
function normalizedBanks(component) {
    const lookup = new Map(component.ports.map((port) => [port.id, port]));
    const assigned = new Set();
    const banks = [];
    for (const bank of component.pinBanks) {
        const portIds = [];
        for (const portId of bank.portIds) {
            const port = lookup.get(portId);
            if (!port || assigned.has(portId) || port.side !== bank.side)
                continue;
            portIds.push(portId);
            assigned.add(portId);
        }
        if (portIds.length)
            banks.push({ ...bank, portIds });
    }
    for (const side of ['north', 'east', 'south', 'west']) {
        const ports = component.ports
            .filter((port) => port.side === side && !assigned.has(port.id))
            .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
        if (!ports.length)
            continue;
        banks.push({
            id: `auto-${side}`,
            side,
            portIds: ports.map((port) => port.id),
            flow: 'forward',
            rowGap: component.layout.rowGap,
            edgePadding: side === 'north' || side === 'south'
                ? Math.max(component.layout.padding.left, component.layout.padding.right)
                : Math.max(component.layout.padding.top, component.layout.padding.bottom),
            collapseEmpty: false,
        });
    }
    return banks;
}
const PORT_LABEL_STYLE = {
    ...DEFAULT_TEXT_STYLE,
    fontSize: 10.5,
    lineHeight: 13,
};
const PORT_FUNCTION_STYLE = {
    ...DEFAULT_TEXT_STYLE,
    fontSize: 9.5,
    lineHeight: 12,
    fill: '#64748b',
};
const PORT_TEXT_LINE_GAP = 2;
const PORT_TEXT_EDGE_GAP = 10;
const PORT_ROW_VERTICAL_PADDING = 3;
const HORIZONTAL_PIN_CELL_PADDING = 8;
const HORIZONTAL_PIN_BAND_PADDING = 6;
const OPPOSING_SIDE_GUTTER = 28;
const SINGLE_SIDE_GUTTER = 36;
function measurePortText(port, measurer, labelStyle, functionStyle) {
    const label = measurer.measure(port.label, labelStyle);
    const fn = port.function ? measurer.measure(port.function, functionStyle) : undefined;
    const stackHeight = label.height + (fn ? PORT_TEXT_LINE_GAP + fn.height : 0);
    return { label, fn, stackHeight, maximumWidth: Math.max(label.width, fn?.width ?? 0) };
}
function layoutProfile(component, banks, options) {
    const measurer = options.textMeasurer ?? new ApproximateTextMeasurer();
    const labelStyle = { ...PORT_LABEL_STYLE, ...options.portLabelStyle };
    const functionStyle = { ...PORT_FUNCTION_STYLE, ...options.portFunctionStyle };
    const titleMetrics = measurer.measure(component.labels.title || component.designator, {
        ...DEFAULT_TEXT_STYLE,
        fontSize: 13,
        fontWeight: 650,
        ...options.titleStyle,
    });
    const subtitleMetrics = measurer.measure(component.labels.subtitle ?? '', {
        ...DEFAULT_TEXT_STYLE,
        fontSize: 11,
        lineHeight: 13,
        fill: '#4b5563',
        ...options.subtitleStyle,
    });
    const sides = {
        north: { side: 'north', items: [], packedLength: 0, crossSize: 0, edgePadding: 0, requiredLength: 0 },
        east: { side: 'east', items: [], packedLength: 0, crossSize: 0, edgePadding: 0, requiredLength: 0 },
        south: { side: 'south', items: [], packedLength: 0, crossSize: 0, edgePadding: 0, requiredLength: 0 },
        west: { side: 'west', items: [], packedLength: 0, crossSize: 0, edgePadding: 0, requiredLength: 0 },
    };
    for (const side of ['north', 'east', 'south', 'west']) {
        const sideBanks = banks.filter((bank) => bank.side === side);
        let firstOnSide = true;
        for (const bank of sideBanks) {
            const ports = visibleBankPorts(component, bank, options.connectedPortIds);
            if (!ports.length)
                continue;
            sides[side].edgePadding = Math.max(sides[side].edgePadding, Math.max(0, bank.edgePadding));
            for (let index = 0; index < ports.length; index += 1) {
                const port = ports[index];
                const measured = measurePortText(port, measurer, labelStyle, functionStyle);
                const verticalSide = side === 'east' || side === 'west';
                const alongSize = verticalSide
                    ? Math.max(component.layout.rowHeight, port.minimumRowHeight ?? 0, measured.stackHeight + PORT_ROW_VERTICAL_PADDING * 2)
                    : Math.max(30, measured.maximumWidth + HORIZONTAL_PIN_CELL_PADDING * 2);
                const textCrossSize = verticalSide
                    ? measured.maximumWidth + PORT_TEXT_EDGE_GAP * 2
                    : measured.stackHeight + HORIZONTAL_PIN_BAND_PADDING * 2;
                const gapBefore = firstOnSide
                    ? 0
                    : index === 0
                        ? Math.max(0, component.layout.bankGap)
                        : Math.max(0, bank.rowGap);
                sides[side].items.push({
                    bank,
                    port,
                    labelMetrics: measured.label,
                    functionMetrics: measured.fn,
                    alongSize,
                    textCrossSize,
                    gapBefore,
                });
                firstOnSide = false;
            }
        }
        const profile = sides[side];
        profile.packedLength = profile.items.reduce((total, item) => total + item.gapBefore + item.alongSize, 0);
        profile.crossSize = profile.items.reduce((maximum, item) => Math.max(maximum, item.textCrossSize), 0);
        profile.requiredLength = profile.items.length ? profile.packedLength + profile.edgePadding * 2 : 0;
    }
    return { sides, titleMetrics, subtitleMetrics };
}
function calculateAutoSize(component, profile) {
    const { north, east, south, west } = profile.sides;
    const titleWidth = Math.max(profile.titleMetrics.width, profile.subtitleMetrics.width)
        + component.layout.padding.left
        + component.layout.padding.right
        + 24;
    const sideColumnsWidth = west.crossSize
        + east.crossSize
        + (west.items.length && east.items.length ? OPPOSING_SIDE_GUTTER : SINGLE_SIDE_GUTTER);
    const horizontalPinsWidth = Math.max(north.requiredLength, south.requiredLength)
        + component.layout.padding.left
        + component.layout.padding.right;
    let requiredWidth = Math.max(component.layout.minimumSize.width, titleWidth, sideColumnsWidth, horizontalPinsWidth);
    const verticalPinsHeight = Math.max(west.requiredLength, east.requiredLength, component.layout.rowHeight + Math.max(component.layout.padding.top, component.layout.padding.bottom) * 2);
    let requiredHeight = Math.max(component.layout.minimumSize.height, north.crossSize
        + component.layout.headerHeight
        + component.layout.padding.top
        + verticalPinsHeight
        + component.layout.padding.bottom
        + component.layout.footerHeight
        + south.crossSize);
    if (component.size && component.layout.preserveManualSize) {
        if (!component.layout.autoWidth)
            requiredWidth = component.size.width;
        else
            requiredWidth = Math.max(requiredWidth, component.size.width);
        if (!component.layout.autoHeight)
            requiredHeight = component.size.height;
        else
            requiredHeight = Math.max(requiredHeight, component.size.height);
    }
    if (component.layout.maximumSize) {
        requiredWidth = clamp(requiredWidth, component.layout.minimumSize.width, component.layout.maximumSize.width);
        requiredHeight = clamp(requiredHeight, component.layout.minimumSize.height, component.layout.maximumSize.height);
    }
    return { width: requiredWidth, height: requiredHeight };
}
function transformRect(localRect, size, component) {
    const corners = [
        { x: localRect.x, y: localRect.y },
        { x: localRect.x + localRect.width, y: localRect.y },
        { x: localRect.x + localRect.width, y: localRect.y + localRect.height },
        { x: localRect.x, y: localRect.y + localRect.height },
    ].map((local) => transformLocalPoint(local, size, component.position, component.rotation, component.mirrorX, component.mirrorY));
    return boundsFromPoints(corners);
}
/**
 * Allocates non-overlapping centers along one side. Automatic items use the
 * free space uniformly. Explicit side fractions are treated as preferences and
 * then collision-resolved without changing the bank/port order.
 */
function linearCenters(items, start, end) {
    if (!items.length)
        return [];
    const span = Math.max(0, end - start);
    const totalItems = items.reduce((sum, item) => sum + item.alongSize, 0);
    const requiredGaps = items.slice(1).reduce((sum, item) => sum + item.gapBefore, 0);
    const spare = Math.max(0, span - totalItems - requiredGaps);
    const automaticExtraGap = items.length > 1 ? spare / (items.length - 1) : 0;
    const automatic = [];
    let cursor = start;
    for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        if (index > 0)
            cursor += item.gapBefore + automaticExtraGap;
        automatic.push(cursor + item.alongSize / 2);
        cursor += item.alongSize;
    }
    if (items.length === 1)
        automatic[0] = start + span / 2;
    if (!items.some((item) => item.port.sideFraction !== undefined))
        return automatic;
    const centers = items.map((item, index) => item.port.sideFraction === undefined
        ? automatic[index]
        : start + clamp(item.port.sideFraction, 0, 1) * span);
    centers[0] = Math.max(centers[0], start + items[0].alongSize / 2);
    for (let index = 1; index < items.length; index += 1) {
        const previous = items[index - 1];
        const current = items[index];
        const minimum = centers[index - 1] + previous.alongSize / 2 + current.gapBefore + current.alongSize / 2;
        centers[index] = Math.max(centers[index], minimum);
    }
    const last = items.length - 1;
    centers[last] = Math.min(centers[last], end - items[last].alongSize / 2);
    for (let index = last - 1; index >= 0; index -= 1) {
        const current = items[index];
        const next = items[index + 1];
        const maximum = centers[index + 1] - current.alongSize / 2 - next.gapBefore - next.alongSize / 2;
        centers[index] = Math.min(centers[index], maximum);
    }
    return centers;
}
function worldTextGeometry(localCenter, metrics, size, component) {
    const point = transformLocalPoint(localCenter, size, component.position, component.rotation, component.mirrorX, component.mirrorY);
    return {
        point,
        bounds: rect(point.x - metrics.width / 2, point.y - metrics.height / 2, metrics.width, metrics.height),
    };
}
function verticalTextCenters(item, centerY) {
    const stackHeight = item.labelMetrics.height + (item.functionMetrics ? PORT_TEXT_LINE_GAP + item.functionMetrics.height : 0);
    const top = centerY - stackHeight / 2;
    return {
        label: { x: 0, y: top + item.labelMetrics.height / 2 },
        fn: item.functionMetrics
            ? { x: 0, y: top + item.labelMetrics.height + PORT_TEXT_LINE_GAP + item.functionMetrics.height / 2 }
            : undefined,
    };
}
function horizontalTextCenters(item, centerX, side, size) {
    const stackHeight = item.labelMetrics.height + (item.functionMetrics ? PORT_TEXT_LINE_GAP + item.functionMetrics.height : 0);
    const top = side === 'north'
        ? HORIZONTAL_PIN_BAND_PADDING
        : size.height - HORIZONTAL_PIN_BAND_PADDING - stackHeight;
    return {
        label: { x: centerX, y: top + item.labelMetrics.height / 2 },
        fn: item.functionMetrics
            ? { x: centerX, y: top + item.labelMetrics.height + PORT_TEXT_LINE_GAP + item.functionMetrics.height / 2 }
            : undefined,
    };
}
export function buildComponentGeometry(component, options = {}) {
    const connectedPortIds = options.connectedPortIds ?? new Set();
    const banks = normalizedBanks(component);
    const profile = layoutProfile(component, banks, { ...options, connectedPortIds });
    const size = calculateAutoSize(component, profile);
    const localBody = rect(0, 0, size.width, size.height);
    const northBandHeight = profile.sides.north.crossSize;
    const southBandHeight = profile.sides.south.crossSize;
    const headerTop = northBandHeight;
    const headerHeight = Math.min(component.layout.headerHeight, Math.max(0, size.height - northBandHeight - southBandHeight - component.layout.footerHeight));
    const localHeader = rect(0, headerTop, size.width, headerHeight);
    const footerTop = Math.max(headerTop + headerHeight, size.height - southBandHeight - component.layout.footerHeight);
    const localFooter = component.layout.footerHeight > 0
        ? rect(0, footerTop, size.width, component.layout.footerHeight)
        : undefined;
    const worldBody = transformRect(localBody, size, component);
    const headerBounds = transformRect(localHeader, size, component);
    const footerBounds = localFooter ? transformRect(localFooter, size, component) : undefined;
    const worldPorts = {};
    const rowBounds = {};
    const minimumHit = options.minimumPortHitSize ?? 18;
    const contentTop = headerTop + headerHeight + component.layout.padding.top;
    const contentBottom = Math.max(contentTop, footerTop - component.layout.padding.bottom);
    const horizontalStart = component.layout.padding.left;
    const horizontalEnd = Math.max(horizontalStart, size.width - component.layout.padding.right);
    for (const side of ['north', 'east', 'south', 'west']) {
        const sideProfile = profile.sides[side];
        const verticalSide = side === 'east' || side === 'west';
        const start = verticalSide
            ? contentTop + sideProfile.edgePadding
            : horizontalStart + sideProfile.edgePadding;
        const end = verticalSide
            ? Math.max(start, contentBottom - sideProfile.edgePadding)
            : Math.max(start, horizontalEnd - sideProfile.edgePadding);
        const centers = linearCenters(sideProfile.items, start, end);
        for (let index = 0; index < sideProfile.items.length; index += 1) {
            const item = sideProfile.items[index];
            const port = item.port;
            const normal = sideNormal(side);
            const tangent = sideTangent(side);
            const alongCenter = centers[index];
            const baseCenter = verticalSide
                ? { x: side === 'east' ? size.width : 0, y: alongCenter }
                : { x: alongCenter, y: side === 'south' ? size.height : 0 };
            const tangentCenter = {
                x: baseCenter.x + tangent.x * (port.tangentOffset ?? 0),
                y: baseCenter.y + tangent.y * (port.tangentOffset ?? 0),
            };
            const localCenter = {
                x: tangentCenter.x + normal.x * (port.normalOffset ?? 0),
                y: tangentCenter.y + normal.y * (port.normalOffset ?? 0),
            };
            const worldCenter = transformLocalPoint(localCenter, size, component.position, component.rotation, component.mirrorX, component.mirrorY);
            const worldNormal = transformLocalVector(normal, component.rotation, component.mirrorX, component.mirrorY);
            const worldTangent = transformLocalVector(tangent, component.rotation, component.mirrorX, component.mirrorY);
            const hitBounds = rect(worldCenter.x - minimumHit / 2, worldCenter.y - minimumHit / 2, minimumHit, minimumHit);
            let localRow;
            let textCenters;
            if (side === 'west') {
                localRow = rect(0, tangentCenter.y - item.alongSize / 2, profile.sides.west.crossSize, item.alongSize);
                textCenters = verticalTextCenters(item, tangentCenter.y);
                textCenters.label.x = PORT_TEXT_EDGE_GAP + item.labelMetrics.width / 2;
                if (textCenters.fn && item.functionMetrics)
                    textCenters.fn.x = PORT_TEXT_EDGE_GAP + item.functionMetrics.width / 2;
            }
            else if (side === 'east') {
                localRow = rect(size.width - profile.sides.east.crossSize, tangentCenter.y - item.alongSize / 2, profile.sides.east.crossSize, item.alongSize);
                textCenters = verticalTextCenters(item, tangentCenter.y);
                textCenters.label.x = size.width - PORT_TEXT_EDGE_GAP - item.labelMetrics.width / 2;
                if (textCenters.fn && item.functionMetrics)
                    textCenters.fn.x = size.width - PORT_TEXT_EDGE_GAP - item.functionMetrics.width / 2;
            }
            else if (side === 'north') {
                localRow = rect(tangentCenter.x - item.alongSize / 2, 0, item.alongSize, northBandHeight);
                textCenters = horizontalTextCenters(item, tangentCenter.x, 'north', size);
            }
            else {
                localRow = rect(tangentCenter.x - item.alongSize / 2, size.height - southBandHeight, item.alongSize, southBandHeight);
                textCenters = horizontalTextCenters(item, tangentCenter.x, 'south', size);
            }
            const worldRow = transformRect(localRow, size, component);
            const labelGeometry = worldTextGeometry(textCenters.label, item.labelMetrics, size, component);
            const functionGeometry = textCenters.fn && item.functionMetrics
                ? worldTextGeometry(textCenters.fn, item.functionMetrics, size, component)
                : undefined;
            rowBounds[port.id] = worldRow;
            worldPorts[port.id] = {
                portId: port.id,
                componentId: component.id,
                center: worldCenter,
                normal: worldNormal,
                tangent: worldTangent,
                side: rotateSide(side, component.rotation),
                hitBounds,
                rowBounds: worldRow,
                labelPoint: labelGeometry.point,
                labelBounds: labelGeometry.bounds,
                functionPoint: functionGeometry?.point,
                functionBounds: functionGeometry?.bounds,
                textAnchor: 'middle',
            };
        }
    }
    const titleLocal = {
        x: size.width / 2,
        y: headerTop + headerHeight / 2 - (component.labels.subtitle ? 5 : 0),
    };
    const titlePoint = transformLocalPoint(titleLocal, size, component.position, component.rotation, component.mirrorX, component.mirrorY);
    const subtitlePoint = component.labels.subtitle
        ? transformLocalPoint({ x: size.width / 2, y: headerTop + headerHeight / 2 + 8 }, size, component.position, component.rotation, component.mirrorX, component.mirrorY)
        : undefined;
    const portBounds = Object.values(worldPorts).flatMap((port) => [
        port.hitBounds,
        port.labelBounds,
        port.functionBounds,
    ].filter((value) => Boolean(value)));
    const worldBounds = unionRects([worldBody, ...portBounds]);
    return {
        componentId: component.id,
        localBody,
        worldBody,
        worldBounds,
        headerBounds,
        footerBounds,
        ports: worldPorts,
        rowBounds,
        titlePoint,
        subtitlePoint,
        rotation: component.rotation,
    };
}
export function componentPortMap(component) {
    return new Map(component.ports.map((port) => [port.id, port]));
}
export function componentCenter(component) {
    return { ...component.position };
}
export function cloneComponent(component) {
    return JSON.parse(JSON.stringify(component));
}
export function moveComponent(component, delta) {
    return { ...component, position: { x: component.position.x + delta.x, y: component.position.y + delta.y } };
}
export function rotateComponent(component, clockwise = true) {
    const delta = clockwise ? 90 : 270;
    return { ...component, rotation: ((component.rotation + delta) % 360) };
}
export function resizeComponent(component, size) {
    const width = Math.max(component.layout.minimumSize.width, size.width);
    const height = Math.max(component.layout.minimumSize.height, size.height);
    return { ...component, size: { width, height } };
}
export class ComponentBuilder {
    node;
    constructor(id, designator, kind = 'connector') {
        this.node = {
            id,
            kind,
            designator,
            labels: { title: designator },
            position: { x: 0, y: 0 },
            rotation: 0,
            mirrorX: false,
            mirrorY: false,
            ports: [],
            pinBanks: [],
            layout: JSON.parse(JSON.stringify(DEFAULT_COMPONENT_LAYOUT)),
            locked: false,
            hidden: false,
            zIndex: 0,
        };
    }
    definition(id) {
        this.node.definitionId = id;
        return this;
    }
    at(x, y) {
        this.node.position = { x, y };
        return this;
    }
    withLabels(labels) {
        this.node.labels = { ...this.node.labels, ...labels };
        return this;
    }
    withLayout(layout) {
        this.node.layout = {
            ...this.node.layout,
            ...layout,
            minimumSize: { ...this.node.layout.minimumSize, ...layout.minimumSize },
            maximumSize: layout.maximumSize ? { ...layout.maximumSize } : this.node.layout.maximumSize,
            padding: { ...this.node.layout.padding, ...layout.padding },
        };
        return this;
    }
    withStyle(style) {
        this.node.style = { ...(this.node.style ?? {}), ...style };
        return this;
    }
    withSize(width, height) {
        this.node.size = { width, height };
        return this;
    }
    rotate(rotation) {
        this.node.rotation = rotation;
        return this;
    }
    addBank(bank) {
        this.node.pinBanks.push({ ...bank, portIds: [...(bank.portIds ?? [])] });
        return this;
    }
    addPort(input) {
        const id = input.id ?? `${this.node.id}:p${this.node.ports.length + 1}`;
        const side = input.side ?? 'east';
        const bankId = input.bankId;
        const order = input.order ?? this.node.ports.filter((port) => port.side === side).length;
        this.node.ports.push({
            id,
            label: input.label,
            function: input.function,
            detail: input.detail,
            side,
            order,
            bankId,
            visible: true,
            electricalClass: input.electricalClass ?? 'unknown',
            connectionPolicy: { ...DEFAULT_CONNECTION_POLICY, ...input.connectionPolicy },
        });
        if (bankId) {
            const bank = this.node.pinBanks.find((candidate) => candidate.id === bankId);
            if (bank)
                bank.portIds.push(id);
        }
        return this;
    }
    addPorts(count, options = {}) {
        for (let index = 0; index < count; index += 1) {
            this.addPort({
                id: options.id?.(index),
                label: options.label?.(index) ?? String(index + 1),
                function: options.function?.(index),
                side: options.side,
                bankId: options.bankId,
                order: index,
                electricalClass: options.electricalClass,
                connectionPolicy: { maximumConnections: options.maximumConnections ?? 1 },
            });
        }
        return this;
    }
    build() {
        return cloneComponent(this.node);
    }
}
export function createConnector(id, designator, pinCount, position, side = 'east') {
    const bankId = `${id}:bank:${side}`;
    return new ComponentBuilder(id, designator, 'connector')
        .at(position.x, position.y)
        .withLabels({ title: designator, subtitle: `${pinCount}-position connector` })
        .addBank({ id: bankId, side, flow: 'forward', rowGap: 0, edgePadding: 10, collapseEmpty: false })
        .addPorts(pinCount, { side, bankId })
        .build();
}
export function bodyAnchorPoint(geometry, side, offset = 0) {
    const body = geometry.worldBody;
    switch (side) {
        case 'north':
            return { x: body.x + body.width / 2, y: body.y - offset };
        case 'east':
            return { x: body.x + body.width + offset, y: body.y + body.height / 2 };
        case 'south':
            return { x: body.x + body.width / 2, y: body.y + body.height + offset };
        case 'west':
            return { x: body.x - offset, y: body.y + body.height / 2 };
    }
}
export function localBodyCenter(geometry) {
    return rectCenter(geometry.worldBody);
}
//# sourceMappingURL=component.js.map