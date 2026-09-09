export const DEFAULT_DARK_THEME = {
    id: 'editor-core-dark',
    background: '#20242a',
    gridMinor: '#2d333b',
    gridMajor: '#3a424c',
    guide: '#94a3b8',
    selection: '#38bdf8',
    selectionHalo: '#0ea5e9',
    hover: '#f59e0b',
    validTarget: '#22c55e',
    invalidTarget: '#ef4444',
    warning: '#f59e0b',
    error: '#ef4444',
    text: '#f8fafc',
    mutedText: '#94a3b8',
    labelBackground: '#f8fafc',
    labelBorder: '#64748b',
    wireOutline: '#111827',
    wireDefault: '#60a5fa',
    component: {
        bodyFill: '#f8fafc',
        bodyStroke: '#475569',
        bodyStrokeWidth: 1.5,
        bodyRadius: 5,
        headerFill: '#e2e8f0',
        headerText: '#0f172a',
        portLabelText: '#334155',
        portFunctionText: '#64748b',
        rowFill: '#ffffff',
        alternateRowFill: '#f8fafc',
        rowStroke: '#e2e8f0',
        pinDotFill: '#111827',
        pinDotStroke: '#ffffff',
        pinDotRadius: 4,
        selectedStroke: '#2563eb',
        invalidStroke: '#dc2626',
        warningStroke: '#d97706',
    },
};
export const DEFAULT_LIGHT_THEME = {
    ...DEFAULT_DARK_THEME,
    id: 'editor-core-light',
    background: '#f8fafc',
    gridMinor: '#e2e8f0',
    gridMajor: '#cbd5e1',
    guide: '#64748b',
    selectionHalo: '#bfdbfe',
    text: '#0f172a',
    mutedText: '#64748b',
    wireOutline: '#ffffff',
};
function parseHex(color) {
    const value = color.trim();
    const short = /^#([0-9a-f]{3})$/iu.exec(value);
    if (short) {
        return {
            r: Number.parseInt(short[1][0] + short[1][0], 16),
            g: Number.parseInt(short[1][1] + short[1][1], 16),
            b: Number.parseInt(short[1][2] + short[1][2], 16),
        };
    }
    const full = /^#([0-9a-f]{6})$/iu.exec(value);
    if (!full)
        return undefined;
    return {
        r: Number.parseInt(full[1].slice(0, 2), 16),
        g: Number.parseInt(full[1].slice(2, 4), 16),
        b: Number.parseInt(full[1].slice(4, 6), 16),
    };
}
function channel(value) {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}
export function relativeLuminance(color) {
    const rgb = parseHex(color);
    if (!rgb)
        return undefined;
    return channel(rgb.r) * 0.2126 + channel(rgb.g) * 0.7152 + channel(rgb.b) * 0.0722;
}
export function contrastRatio(a, b) {
    const first = relativeLuminance(a);
    const second = relativeLuminance(b);
    if (first === undefined || second === undefined)
        return undefined;
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}
export function contrastingText(background, dark = '#111827', light = '#ffffff') {
    const darkRatio = contrastRatio(background, dark) ?? 1;
    const lightRatio = contrastRatio(background, light) ?? 1;
    return darkRatio >= lightRatio ? dark : light;
}
export function normalizeWirePattern(pattern) {
    switch (pattern.kind) {
        case 'solid':
            return pattern;
        case 'stripe':
            return {
                ...pattern,
                stripeWidth: Math.max(0.5, pattern.stripeWidth),
                repeat: Math.max(2, pattern.repeat),
            };
        case 'tracer':
            return {
                ...pattern,
                repeat: Math.max(2, pattern.repeat),
                tracerLength: Math.max(0.5, pattern.tracerLength),
            };
        case 'dual':
            return { ...pattern, ratio: Math.max(0.1, Math.min(0.9, pattern.ratio)) };
        case 'shield':
            return pattern;
        case 'custom':
            return {
                ...pattern,
                layers: pattern.layers.map((layer) => ({ ...layer, width: Math.max(0.1, layer.width) })),
            };
    }
}
export function wirePaintLayers(style, outlineColor = '#ffffff') {
    const pattern = normalizeWirePattern(style.pattern);
    const layers = [];
    if (style.outlineWidth > 0) {
        layers.push({
            color: outlineColor,
            width: style.width + style.outlineWidth * 2,
            opacity: style.opacity,
            lineCap: style.lineCap,
        });
    }
    switch (pattern.kind) {
        case 'solid':
            layers.push({ color: pattern.color, width: style.width, opacity: style.opacity, lineCap: style.lineCap });
            break;
        case 'stripe':
            layers.push({ color: pattern.base, width: style.width, opacity: style.opacity, lineCap: style.lineCap });
            layers.push({
                color: pattern.stripe,
                width: Math.min(style.width, pattern.stripeWidth),
                opacity: style.opacity,
                dash: [pattern.repeat * 0.7, pattern.repeat * 0.3],
                lineCap: 'butt',
            });
            break;
        case 'tracer':
            layers.push({ color: pattern.base, width: style.width, opacity: style.opacity, lineCap: style.lineCap });
            layers.push({
                color: pattern.tracer,
                width: Math.max(1, style.width * 0.42),
                opacity: style.opacity,
                dash: [pattern.tracerLength, Math.max(0.5, pattern.repeat - pattern.tracerLength)],
                lineCap: 'round',
            });
            break;
        case 'dual': {
            const primaryWidth = style.width;
            const secondaryWidth = Math.max(0.8, style.width * (1 - pattern.ratio));
            layers.push({ color: pattern.primary, width: primaryWidth, opacity: style.opacity, lineCap: style.lineCap });
            layers.push({ color: pattern.secondary, width: secondaryWidth, opacity: style.opacity, lineCap: style.lineCap });
            break;
        }
        case 'shield':
            layers.push({
                color: pattern.sheath,
                width: style.width + 3,
                opacity: Math.min(1, style.opacity * 0.85),
                dash: [6, 3],
                lineCap: style.lineCap,
            });
            if (pattern.core)
                layers.push({ color: pattern.core, width: style.width, opacity: style.opacity, lineCap: style.lineCap });
            break;
        case 'custom':
            layers.push(...pattern.layers.map((layer) => ({ ...layer, opacity: (layer.opacity ?? 1) * style.opacity })));
            break;
    }
    return layers;
}
export function colorPatternDescription(pattern) {
    switch (pattern.kind) {
        case 'solid':
            return `solid ${pattern.color}`;
        case 'stripe':
            return `${pattern.base} with ${pattern.stripe} stripe`;
        case 'tracer':
            return `${pattern.base} with ${pattern.tracer} tracer`;
        case 'dual':
            return `${pattern.primary}/${pattern.secondary} dual color`;
        case 'shield':
            return `${pattern.sheath} shield${pattern.core ? ` with ${pattern.core} core` : ''}`;
        case 'custom':
            return `custom ${pattern.layers.length}-layer pattern`;
    }
}
//# sourceMappingURL=paint.js.map