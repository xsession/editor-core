import { bestTextColor, resolveWirePaint, wirePatternPrimaryColor } from './colors.js';
import { DEFAULT_COMPONENT_STYLE, DEFAULT_TEXT_STYLE } from './component.js';
import { boundsFromPoints, formatNumber, inflateRect, rectBottom, rectRight, roundedOrthogonalPath, routeBounds, unionRects, } from './geometry.js';
import { findWireCrossings, resolveEndpoint } from './routing.js';
import { renderDrawingElements } from './drawing.js';
export const DEFAULT_EDITOR_THEME = {
    id: 'editor-core-light',
    background: '#f7f8fa',
    gridMinor: '#dfe3e8',
    gridMajor: '#c6ccd4',
    guide: '#7c3aed',
    selection: '#0f6fff',
    selectionHalo: '#93c5fd',
    hover: '#0891b2',
    validTarget: '#059669',
    invalidTarget: '#dc2626',
    warning: '#d97706',
    error: '#dc2626',
    text: '#111827',
    mutedText: '#667085',
    labelBackground: '#ffffff',
    labelBorder: '#cfd5dd',
    wireOutline: '#ffffff',
    wireDefault: '#2563eb',
    component: DEFAULT_COMPONENT_STYLE,
};
const DEFAULT_RENDER_OPTIONS = {
    showGrid: true,
    showPorts: true,
    showLabels: true,
    showRouteHandles: false,
    showSelection: true,
    showDiagnostics: true,
    includeAccessibility: true,
};
function escapeXml(value) {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');
}
function styleAttribute(style) {
    return Object.entries(style)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}:${String(value)}`)
        .join(';');
}
function renderStroke(pathData, layer, className, extra = '') {
    const dash = layer.dash?.length ? ` stroke-dasharray="${layer.dash.map(formatNumber).join(' ')}"` : '';
    const dashOffset = layer.dashOffset !== undefined ? ` stroke-dashoffset="${formatNumber(layer.dashOffset)}"` : '';
    return `<path class="${className}" d="${pathData}" fill="none" stroke="${escapeXml(layer.color)}" stroke-width="${formatNumber(layer.width)}" stroke-opacity="${formatNumber(layer.opacity ?? 1)}" stroke-linecap="${layer.lineCap ?? 'round'}" stroke-linejoin="round" vector-effect="non-scaling-stroke"${dash}${dashOffset}${extra}/>`;
}
function selected(selection, kind, id) {
    return Boolean(selection?.items.some((item) => item.kind === kind && item.id === id));
}
function portTextAttributes(side) {
    switch (side) {
        case 'east':
            return { anchor: 'end', dx: -10, dy: -2 };
        case 'west':
            return { anchor: 'start', dx: 10, dy: -2 };
        case 'north':
            return { anchor: 'middle', dx: 0, dy: 16 };
        case 'south':
            return { anchor: 'middle', dx: 0, dy: -8 };
        default:
            return { anchor: 'start', dx: 8, dy: 4 };
    }
}
function renderComponent(document, geometry, theme, selection, showPorts = true) {
    const component = document.components[geometry.componentId];
    const style = { ...theme.component, ...component.style };
    const body = geometry.worldBody;
    const isSelected = selected(selection, 'component', component.id);
    const title = component.labels.title || component.designator;
    const aria = `${component.designator}, ${component.kind}, ${component.ports.length} connection points`;
    const rows = [];
    let rowIndex = 0;
    for (const port of component.ports.filter((candidate) => candidate.visible).sort((a, b) => a.order - b.order)) {
        const portGeometry = geometry.ports[port.id];
        if (!portGeometry)
            continue;
        const row = portGeometry.rowBounds;
        const rowFill = rowIndex % 2 === 1 ? style.alternateRowFill ?? style.rowFill : style.rowFill;
        if (row) {
            rows.push(`<rect x="${formatNumber(row.x)}" y="${formatNumber(row.y)}" width="${formatNumber(row.width)}" height="${formatNumber(row.height)}" fill="${escapeXml(rowFill)}" stroke="${escapeXml(style.rowStroke)}" stroke-width="0.5" vector-effect="non-scaling-stroke"/>`);
        }
        const text = portTextAttributes(portGeometry.side);
        if (showPorts)
            rows.push(`<circle data-port-id="${escapeXml(port.id)}" cx="${formatNumber(portGeometry.center.x)}" cy="${formatNumber(portGeometry.center.y)}" r="${formatNumber(style.pinDotRadius)}" fill="${escapeXml(style.pinDotFill)}" stroke="${escapeXml(style.pinDotStroke)}" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`);
        const labelX = portGeometry.labelPoint?.x ?? (portGeometry.labelBounds ? portGeometry.labelBounds.x + portGeometry.labelBounds.width / 2 : portGeometry.center.x + text.dx);
        const labelY = portGeometry.labelPoint?.y ?? (portGeometry.labelBounds ? portGeometry.labelBounds.y + portGeometry.labelBounds.height / 2 : portGeometry.center.y + text.dy);
        const labelAnchor = portGeometry.textAnchor ?? (portGeometry.labelBounds ? 'middle' : text.anchor);
        const labelBaseline = portGeometry.labelPoint || portGeometry.labelBounds ? ' dominant-baseline="middle"' : '';
        const labelColor = style.portLabelText ?? bestTextColor(rowFill, '#f8fafc', '#111827');
        rows.push(`<text data-port-label-for="${escapeXml(port.id)}" x="${formatNumber(labelX)}" y="${formatNumber(labelY)}" text-anchor="${labelAnchor}"${labelBaseline} font-family="${escapeXml(DEFAULT_TEXT_STYLE.fontFamily)}" font-size="10.5" fill="${escapeXml(labelColor)}">${escapeXml(port.label)}</text>`);
        if (port.function) {
            const functionDy = portGeometry.side === 'north'
                ? text.dy + 12
                : portGeometry.side === 'south'
                    ? text.dy - 12
                    : text.dy + 12;
            const functionX = portGeometry.functionPoint?.x ?? (portGeometry.functionBounds ? portGeometry.functionBounds.x + portGeometry.functionBounds.width / 2 : portGeometry.center.x + text.dx);
            const functionY = portGeometry.functionPoint?.y ?? (portGeometry.functionBounds ? portGeometry.functionBounds.y + portGeometry.functionBounds.height / 2 : portGeometry.center.y + functionDy);
            const functionAnchor = portGeometry.textAnchor ?? (portGeometry.functionBounds ? 'middle' : text.anchor);
            const functionBaseline = portGeometry.functionPoint || portGeometry.functionBounds ? ' dominant-baseline="middle"' : '';
            const functionColor = style.portFunctionText ?? bestTextColor(rowFill, '#cbd5e1', '#475569');
            rows.push(`<text data-port-function-for="${escapeXml(port.id)}" x="${formatNumber(functionX)}" y="${formatNumber(functionY)}" text-anchor="${functionAnchor}"${functionBaseline} font-family="${escapeXml(DEFAULT_TEXT_STYLE.fontFamily)}" font-size="9.5" fill="${escapeXml(functionColor)}">${escapeXml(port.function)}</text>`);
        }
        rowIndex += 1;
    }
    const selectionOutline = isSelected
        ? `<rect x="${formatNumber(body.x - 4)}" y="${formatNumber(body.y - 4)}" width="${formatNumber(body.width + 8)}" height="${formatNumber(body.height + 8)}" rx="${formatNumber(style.bodyRadius + 3)}" fill="none" stroke="${escapeXml(theme.selection)}" stroke-width="2.5" stroke-dasharray="9 5" vector-effect="non-scaling-stroke"/>`
        : '';
    const titleY = geometry.subtitlePoint ? geometry.titlePoint.y - 3 : geometry.titlePoint.y + 4;
    // Keep 0/180-degree labels upright. For quarter-turn symbols, rotate the
    // header text with the header strip so title and subtitle remain separated.
    const headerTextRotation = component.rotation === 90 ? 90 : component.rotation === 270 ? -90 : 0;
    const titleTransform = headerTextRotation === 0
        ? ''
        : ` transform="rotate(${headerTextRotation} ${formatNumber(geometry.titlePoint.x)} ${formatNumber(titleY)})"`;
    const subtitleY = geometry.subtitlePoint ? geometry.subtitlePoint.y + 4 : 0;
    const subtitleTransform = geometry.subtitlePoint && headerTextRotation !== 0
        ? ` transform="rotate(${headerTextRotation} ${formatNumber(geometry.subtitlePoint.x)} ${formatNumber(subtitleY)})"`
        : '';
    const subtitleColor = bestTextColor(style.headerFill, '#cbd5e1', '#475569');
    const subtitle = component.labels.subtitle
        ? `<text x="${formatNumber(geometry.subtitlePoint.x)}" y="${formatNumber(subtitleY)}"${subtitleTransform} text-anchor="middle" font-family="${escapeXml(DEFAULT_TEXT_STYLE.fontFamily)}" font-size="9.8" fill="${escapeXml(subtitleColor)}">${escapeXml(component.labels.subtitle)}</text>`
        : '';
    return `<g class="editor-core-component" data-component-id="${escapeXml(component.id)}" role="graphics-symbol" aria-label="${escapeXml(aria)}">
<title>${escapeXml(aria)}</title>
${selectionOutline}
<rect x="${formatNumber(body.x)}" y="${formatNumber(body.y)}" width="${formatNumber(body.width)}" height="${formatNumber(body.height)}" rx="${formatNumber(style.bodyRadius)}" fill="${escapeXml(style.bodyFill)}" stroke="${escapeXml(style.bodyStroke)}" stroke-width="${formatNumber(style.bodyStrokeWidth)}" vector-effect="non-scaling-stroke"/>
<rect x="${formatNumber(geometry.headerBounds.x)}" y="${formatNumber(geometry.headerBounds.y)}" width="${formatNumber(geometry.headerBounds.width)}" height="${formatNumber(geometry.headerBounds.height)}" rx="${formatNumber(style.bodyRadius)}" fill="${escapeXml(style.headerFill)}"/>
${rows.join('\n')}
<text x="${formatNumber(geometry.titlePoint.x)}" y="${formatNumber(titleY)}"${titleTransform} text-anchor="middle" font-family="${escapeXml(DEFAULT_TEXT_STYLE.fontFamily)}" font-size="12.5" font-weight="650" fill="${escapeXml(style.headerText)}">${escapeXml(title)}</text>
${subtitle}
</g>`;
}
function renderWire(wire, theme, selection) {
    if (!wire.route || wire.route.points.length < 2 || wire.hidden)
        return '';
    const routePath = roundedOrthogonalPath(wire.route.points, wire.routing.requestedRadius).path;
    const paint = resolveWirePaint(wire.style, theme, {
        selected: selected(selection, 'wire', wire.id),
        invalid: wire.route.status === 'invalid',
        warning: wire.route.status === 'fallback',
    });
    const strokes = [];
    if (paint.selection)
        strokes.push(renderStroke(routePath, paint.selection, 'editor-core-wire-selection'));
    if (paint.warning)
        strokes.push(renderStroke(routePath, paint.warning, 'editor-core-wire-warning'));
    if (paint.outline)
        strokes.push(renderStroke(routePath, paint.outline, 'editor-core-wire-outline'));
    for (const layer of paint.engineeringLayers)
        strokes.push(renderStroke(routePath, layer, 'editor-core-wire-stroke'));
    const label = wire.label ?? wire.signal ?? wire.id;
    return `<g class="editor-core-wire" data-wire-id="${escapeXml(wire.id)}" role="graphics-symbol" aria-label="${escapeXml(label)}"><title>${escapeXml(label)}</title>${strokes.join('')}</g>`;
}
function renderCrossingBridges(document, theme, background) {
    const wires = document.wireOrder.map((id) => document.wires[id]).filter((wire) => Boolean(wire));
    const crossings = findWireCrossings(wires);
    const result = [];
    for (const crossing of crossings) {
        const over = document.wires[crossing.overWire];
        if (!over?.route)
            continue;
        const radius = document.settings.wireBridgeRadius;
        const segment = over.route.segments.find((candidate) => {
            const minX = Math.min(candidate.start.x, candidate.end.x) - 0.1;
            const maxX = Math.max(candidate.start.x, candidate.end.x) + 0.1;
            const minY = Math.min(candidate.start.y, candidate.end.y) - 0.1;
            const maxY = Math.max(candidate.start.y, candidate.end.y) + 0.1;
            return crossing.point.x >= minX && crossing.point.x <= maxX && crossing.point.y >= minY && crossing.point.y <= maxY;
        });
        if (!segment)
            continue;
        const color = wirePatternPrimaryColor(over.style);
        result.push(`<circle cx="${formatNumber(crossing.point.x)}" cy="${formatNumber(crossing.point.y)}" r="${formatNumber(radius + over.style.width)}" fill="${escapeXml(background)}"/>`);
        if (segment.axis === 'horizontal') {
            result.push(`<path d="M ${formatNumber(crossing.point.x - radius)} ${formatNumber(crossing.point.y)} A ${formatNumber(radius)} ${formatNumber(radius)} 0 0 1 ${formatNumber(crossing.point.x + radius)} ${formatNumber(crossing.point.y)}" fill="none" stroke="${escapeXml(color)}" stroke-width="${formatNumber(over.style.width)}" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`);
        }
        else {
            result.push(`<path d="M ${formatNumber(crossing.point.x)} ${formatNumber(crossing.point.y - radius)} A ${formatNumber(radius)} ${formatNumber(radius)} 0 0 0 ${formatNumber(crossing.point.x)} ${formatNumber(crossing.point.y + radius)}" fill="none" stroke="${escapeXml(color)}" stroke-width="${formatNumber(over.style.width)}" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`);
        }
    }
    return result.join('\n');
}
function resolvedLabelStyle(label, theme) {
    const background = label.style.background ?? theme.labelBackground;
    const fill = label.style.fill ?? bestTextColor(background, '#f8fafc', '#111827');
    return {
        ...DEFAULT_TEXT_STYLE,
        background,
        borderColor: theme.labelBorder,
        borderWidth: 1,
        borderRadius: 3,
        ...label.style,
        fill,
    };
}
function renderLabel(label, placement, theme, selection) {
    const style = resolvedLabelStyle(label, theme);
    const isSelected = selected(selection, 'label', label.id);
    const leader = placement.leader
        ? `<line x1="${formatNumber(placement.leader.start.x)}" y1="${formatNumber(placement.leader.start.y)}" x2="${formatNumber(placement.leader.end.x)}" y2="${formatNumber(placement.leader.end.y)}" stroke="${escapeXml(theme.mutedText)}" stroke-width="1" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>`
        : '';
    const border = placement.status === 'overlap' ? theme.warning : isSelected ? theme.selection : style.borderColor ?? theme.labelBorder;
    const textY = placement.bounds.y + style.paddingY + style.fontSize;
    const secondaryFill = bestTextColor(style.background ?? theme.labelBackground, '#cbd5e1', '#475569');
    const secondary = label.secondaryText
        ? `<text x="${formatNumber(placement.position.x)}" y="${formatNumber(textY + style.lineHeight)}" text-anchor="middle" font-family="${escapeXml(style.fontFamily)}" font-size="${formatNumber(style.fontSize * 0.88)}" fill="${escapeXml(secondaryFill)}">${escapeXml(label.secondaryText)}</text>`
        : '';
    return `<g class="editor-core-label" data-label-id="${escapeXml(label.id)}" role="graphics-symbol" aria-label="${escapeXml(label.text)}">
${leader}
<rect x="${formatNumber(placement.bounds.x)}" y="${formatNumber(placement.bounds.y)}" width="${formatNumber(placement.bounds.width)}" height="${formatNumber(placement.bounds.height)}" rx="${formatNumber(style.borderRadius)}" fill="${escapeXml(style.background ?? theme.labelBackground)}" stroke="${escapeXml(border)}" stroke-width="${formatNumber(isSelected ? 2 : style.borderWidth)}" vector-effect="non-scaling-stroke"/>
<text x="${formatNumber(placement.position.x)}" y="${formatNumber(textY)}" text-anchor="middle" font-family="${escapeXml(style.fontFamily)}" font-size="${formatNumber(style.fontSize)}" font-weight="${escapeXml(String(style.fontWeight))}" fill="${escapeXml(style.fill)}">${escapeXml(label.text)}</text>
${secondary}
</g>`;
}
function renderRouteHandles(document, selection, theme) {
    const result = [];
    for (const item of selection?.items ?? []) {
        if (item.kind !== 'wire')
            continue;
        const wire = document.wires[item.id];
        if (!wire?.route)
            continue;
        for (let index = 1; index < wire.route.points.length - 1; index += 1) {
            const point = wire.route.points[index];
            result.push(`<rect data-route-handle="${escapeXml(wire.id)}:${index}" x="${formatNumber(point.x - 4)}" y="${formatNumber(point.y - 4)}" width="8" height="8" rx="2" fill="${escapeXml(theme.background)}" stroke="${escapeXml(theme.selection)}" stroke-width="2" vector-effect="non-scaling-stroke"/>`);
        }
    }
    return result.join('\n');
}
function documentBounds(document, geometries, placements) {
    const rects = [];
    for (const geometry of Object.values(geometries))
        rects.push(geometry.worldBounds);
    for (const wire of Object.values(document.wires))
        if (wire.route?.points.length)
            rects.push(routeBounds(wire.route.points, wire.style.width + 10));
    for (const placement of placements)
        rects.push(placement.bounds);
    if (rects.length === 0)
        return { x: -500, y: -300, width: 1000, height: 600 };
    return inflateRect(unionRects(rects), 80);
}
function renderSnapGuides(guides, theme) {
    return guides.map((guide) => {
        const line = guide.axis === 'x'
            ? `<line x1="${formatNumber(guide.coordinate)}" y1="${formatNumber(guide.from)}" x2="${formatNumber(guide.coordinate)}" y2="${formatNumber(guide.to)}"/>`
            : `<line x1="${formatNumber(guide.from)}" y1="${formatNumber(guide.coordinate)}" x2="${formatNumber(guide.to)}" y2="${formatNumber(guide.coordinate)}"/>`;
        const labelX = guide.axis === 'x' ? guide.coordinate + 5 : (guide.from + guide.to) / 2;
        const labelY = guide.axis === 'x' ? (guide.from + guide.to) / 2 : guide.coordinate - 5;
        const label = guide.label
            ? `<text x="${formatNumber(labelX)}" y="${formatNumber(labelY)}" font-family="${escapeXml(DEFAULT_TEXT_STYLE.fontFamily)}" font-size="9" fill="${escapeXml(theme.guide)}">${escapeXml(guide.label)}</text>`
            : '';
        return `<g class="editor-core-snap-guide editor-core-snap-${guide.kind}" fill="none" stroke="${escapeXml(theme.guide)}" stroke-width="1" stroke-dasharray="4 3" vector-effect="non-scaling-stroke">${line}${label}</g>`;
    }).join('\n');
}
function previewRoutePoints(start, end) {
    if (Math.abs(start.x - end.x) < 1e-6 || Math.abs(start.y - end.y) < 1e-6)
        return [start, end];
    const middleX = (start.x + end.x) / 2;
    return [start, { x: middleX, y: start.y }, { x: middleX, y: end.y }, end];
}
function renderInteractionOverlay(document, geometries, overlay, theme) {
    if (!overlay)
        return '';
    const result = [];
    if (overlay.snapGuides?.length)
        result.push(renderSnapGuides(overlay.snapGuides, theme));
    if (overlay.marquee) {
        const bounds = overlay.marquee.bounds;
        result.push(`<rect class="editor-core-marquee" x="${formatNumber(bounds.x)}" y="${formatNumber(bounds.y)}" width="${formatNumber(bounds.width)}" height="${formatNumber(bounds.height)}" fill="${escapeXml(theme.selectionHalo)}" fill-opacity="0.16" stroke="${escapeXml(theme.selection)}" stroke-width="1.2" stroke-dasharray="${overlay.marquee.mode === 'window' ? '6 3' : '2 3'}" vector-effect="non-scaling-stroke"/>`);
    }
    if (overlay.connection) {
        const source = resolveEndpoint(overlay.connection.source, geometries);
        const target = overlay.connection.target ? resolveEndpoint(overlay.connection.target, geometries) : undefined;
        if (source) {
            const end = target?.point ?? overlay.connection.point;
            const path = roundedOrthogonalPath(previewRoutePoints(source.point, end), 6).path;
            const color = overlay.connection.valid ? theme.validTarget : theme.invalidTarget;
            result.push(`<path class="editor-core-connection-preview" d="${path}" fill="none" stroke="${escapeXml(color)}" stroke-width="3" stroke-dasharray="8 5" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`);
            result.push(`<circle cx="${formatNumber(end.x)}" cy="${formatNumber(end.y)}" r="8" fill="${escapeXml(color)}" fill-opacity="0.18" stroke="${escapeXml(color)}" stroke-width="2" vector-effect="non-scaling-stroke"/>`);
            if (overlay.connection.reason) {
                result.push(`<text x="${formatNumber(end.x + 12)}" y="${formatNumber(end.y - 10)}" font-family="${escapeXml(DEFAULT_TEXT_STYLE.fontFamily)}" font-size="10" fill="${escapeXml(color)}">${escapeXml(overlay.connection.reason)}</text>`);
            }
        }
    }
    if (overlay.statusText) {
        result.push(`<text x="12" y="22" font-family="${escapeXml(DEFAULT_TEXT_STYLE.fontFamily)}" font-size="11" fill="${escapeXml(theme.mutedText)}">${escapeXml(overlay.statusText)}</text>`);
    }
    return result.join('\n');
}
export function renderEditorSvg(document, context) {
    const theme = context.theme ?? DEFAULT_EDITOR_THEME;
    const options = { ...DEFAULT_RENDER_OPTIONS, ...(context.options ?? {}) };
    const viewBox = options.viewport ?? documentBounds(document, context.geometries, context.labelPlacements);
    const gridMinor = Math.max(1, document.settings.grid.spacing);
    const gridMajor = gridMinor * Math.max(1, document.settings.grid.majorEvery);
    const grid = options.showGrid && document.settings.grid.visible
        ? `<rect x="${formatNumber(viewBox.x)}" y="${formatNumber(viewBox.y)}" width="${formatNumber(viewBox.width)}" height="${formatNumber(viewBox.height)}" fill="url(#editor-core-grid-major)"/>`
        : '';
    const wires = document.wireOrder
        .map((id) => document.wires[id])
        .filter((wire) => Boolean(wire))
        .sort((a, b) => a.style.zIndex - b.style.zIndex || a.id.localeCompare(b.id))
        .map((wire) => renderWire(wire, theme, context.selection))
        .join('\n');
    const components = document.componentOrder
        .map((id) => context.geometries[id])
        .filter((geometry) => Boolean(geometry))
        .sort((a, b) => document.components[a.componentId].zIndex - document.components[b.componentId].zIndex || a.componentId.localeCompare(b.componentId))
        .map((geometry) => renderComponent(document, geometry, theme, context.selection, options.showPorts))
        .join('\n');
    const placementMap = new Map(context.labelPlacements.map((placement) => [placement.labelId, placement]));
    const labels = options.showLabels
        ? document.labelOrder
            .map((id) => {
            const label = document.labels[id];
            const placement = placementMap.get(id);
            return label && placement && label.visible ? renderLabel(label, placement, theme, context.selection) : '';
        })
            .join('\n')
        : '';
    const handles = options.showRouteHandles ? renderRouteHandles(document, context.selection, theme) : '';
    const overlay = renderInteractionOverlay(document, context.geometries, context.overlay, theme);
    const drawing = renderDrawingElements(context.drawingElements, theme);
    const background = options.background ?? theme.background;
    const accessibility = options.includeAccessibility ? ' role="graphics-document" aria-label="Harness visual editor canvas"' : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${formatNumber(viewBox.x)} ${formatNumber(viewBox.y)} ${formatNumber(viewBox.width)} ${formatNumber(viewBox.height)}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"${accessibility} data-editor-core-schema="1">
<title>Harness visual editor</title>
<desc>Offline cable and wiring-harness editor scene with components, ports, wires, labels, and routing handles.</desc>
<defs>
<pattern id="editor-core-grid-minor" width="${formatNumber(gridMinor)}" height="${formatNumber(gridMinor)}" patternUnits="userSpaceOnUse"><path d="M ${formatNumber(gridMinor)} 0 L 0 0 0 ${formatNumber(gridMinor)}" fill="none" stroke="${escapeXml(theme.gridMinor)}" stroke-width="0.6" opacity="${formatNumber(document.settings.grid.opacity)}" vector-effect="non-scaling-stroke"/></pattern>
<pattern id="editor-core-grid-major" width="${formatNumber(gridMajor)}" height="${formatNumber(gridMajor)}" patternUnits="userSpaceOnUse"><rect width="${formatNumber(gridMajor)}" height="${formatNumber(gridMajor)}" fill="url(#editor-core-grid-minor)"/><path d="M ${formatNumber(gridMajor)} 0 L 0 0 0 ${formatNumber(gridMajor)}" fill="none" stroke="${escapeXml(theme.gridMajor)}" stroke-width="1" opacity="${formatNumber(document.settings.grid.opacity)}" vector-effect="non-scaling-stroke"/></pattern>
</defs>
<rect x="${formatNumber(viewBox.x)}" y="${formatNumber(viewBox.y)}" width="${formatNumber(viewBox.width)}" height="${formatNumber(viewBox.height)}" fill="${escapeXml(background)}"/>
<g id="editor-core-grid-layer" pointer-events="none">${grid}</g>
<g id="editor-core-wire-layer">${wires}</g>
<g id="editor-core-crossing-layer" pointer-events="none">${renderCrossingBridges(document, theme, background)}</g>
<g id="editor-core-component-layer">${components}</g>
<g id="editor-core-label-layer">${labels}</g>
<g id="editor-core-drawing-layer"><defs><marker id="editor-core-drawing-arrow" markerWidth="8" markerHeight="8" refX="3" refY="3" orient="auto"><path d="M6 0L0 3L6 6z" fill="context-stroke"/></marker></defs>${drawing}</g>
<g id="editor-core-interaction-layer" pointer-events="none">${overlay}</g>
<g id="editor-core-handle-layer">${handles}</g>
</svg>`;
}
export function renderSvgFragment(document, context) {
    const svg = renderEditorSvg(document, context);
    return svg.slice(svg.indexOf('>') + 1, svg.lastIndexOf('</svg>'));
}
export function contentBoundsFromSvgContext(document, context) {
    return context.options?.viewport ?? documentBounds(document, context.geometries, context.labelPlacements);
}
//# sourceMappingURL=svg.js.map