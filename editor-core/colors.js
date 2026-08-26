export function parseHexColor(value) {
    const normalized = value.trim().replace(/^#/u, '');
    if (!/^[0-9a-f]{3,8}$/iu.test(normalized))
        return undefined;
    if (normalized.length === 3 || normalized.length === 4) {
        const digits = normalized.split('').map((digit) => digit + digit).join('');
        return parseHexColor(`#${digits}`);
    }
    if (normalized.length !== 6 && normalized.length !== 8)
        return undefined;
    const r = Number.parseInt(normalized.slice(0, 2), 16);
    const g = Number.parseInt(normalized.slice(2, 4), 16);
    const b = Number.parseInt(normalized.slice(4, 6), 16);
    const a = normalized.length === 8 ? Number.parseInt(normalized.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
}
export function toHexColor(color, includeAlpha = false) {
    const channel = (value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
    const alpha = includeAlpha ? channel(color.a * 255) : '';
    return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}${alpha}`;
}
function linearChannel(value) {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}
export function relativeLuminance(value) {
    const color = parseHexColor(value);
    if (!color)
        return 0;
    return 0.2126 * linearChannel(color.r) + 0.7152 * linearChannel(color.g) + 0.0722 * linearChannel(color.b);
}
export function contrastRatio(a, b) {
    const l1 = relativeLuminance(a);
    const l2 = relativeLuminance(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
export function bestTextColor(background, light = '#ffffff', dark = '#111827') {
    return contrastRatio(background, light) >= contrastRatio(background, dark) ? light : dark;
}
export function mixColors(a, b, ratio = 0.5) {
    const ca = parseHexColor(a);
    const cb = parseHexColor(b);
    if (!ca || !cb)
        return a;
    const t = Math.max(0, Math.min(1, ratio));
    return toHexColor({
        r: ca.r + (cb.r - ca.r) * t,
        g: ca.g + (cb.g - ca.g) * t,
        b: ca.b + (cb.b - ca.b) * t,
        a: ca.a + (cb.a - ca.a) * t,
    });
}
/**
 * Converts engineering wire colour semantics into an ordered stack of strokes.
 * Selection and validation are separate visual channels so they never replace
 * the insulation colour that carries engineering meaning.
 */
export function resolveWirePaint(style, theme, state = {}) {
    const layers = [];
    const opacity = style.opacity;
    switch (style.pattern.kind) {
        case 'solid':
            layers.push({ color: style.pattern.color, width: style.width, opacity, lineCap: style.lineCap });
            break;
        case 'stripe':
            layers.push({ color: style.pattern.base, width: style.width, opacity, lineCap: style.lineCap });
            layers.push({
                color: style.pattern.stripe,
                width: Math.max(1, Math.min(style.width, style.pattern.stripeWidth)),
                opacity,
                dash: [style.pattern.repeat / 2, style.pattern.repeat / 2],
                lineCap: 'butt',
            });
            break;
        case 'tracer':
            layers.push({ color: style.pattern.base, width: style.width, opacity, lineCap: style.lineCap });
            layers.push({
                color: style.pattern.tracer,
                width: Math.max(1, style.width * 0.34),
                opacity,
                dash: [style.pattern.tracerLength, Math.max(1, style.pattern.repeat - style.pattern.tracerLength)],
                lineCap: 'round',
            });
            break;
        case 'dual': {
            const primaryWidth = style.width * Math.max(0.1, Math.min(0.9, style.pattern.ratio));
            layers.push({ color: style.pattern.secondary, width: style.width, opacity, lineCap: style.lineCap });
            layers.push({ color: style.pattern.primary, width: primaryWidth, opacity, lineCap: style.lineCap });
            break;
        }
        case 'shield':
            layers.push({ color: style.pattern.sheath, width: style.width + 3, opacity: opacity * 0.72, lineCap: style.lineCap });
            if (style.pattern.core)
                layers.push({ color: style.pattern.core, width: style.width, opacity, lineCap: style.lineCap });
            break;
        case 'custom':
            layers.push(...style.pattern.layers.map((layer) => ({ ...layer, opacity: (layer.opacity ?? 1) * opacity })));
            break;
    }
    const result = { engineeringLayers: layers };
    if (style.outlineWidth > 0) {
        result.outline = {
            color: theme.wireOutline,
            width: style.width + style.outlineWidth * 2,
            opacity: Math.min(1, opacity * 0.8),
            lineCap: style.lineCap,
        };
    }
    if (state.selected || state.hovered) {
        result.selection = {
            color: state.selected ? theme.selection : theme.hover,
            width: style.width + (state.selected ? 8 : 5),
            opacity: state.selected ? 0.42 : 0.3,
            dash: state.selected ? style.selectedDash ?? [10, 6] : undefined,
            lineCap: 'round',
        };
    }
    if (state.invalid || state.warning) {
        result.warning = {
            color: state.invalid ? theme.error : theme.warning,
            width: style.width + 5,
            opacity: 0.9,
            dash: [4, 4],
            lineCap: 'round',
        };
    }
    return result;
}
export function wirePatternPrimaryColor(style) {
    switch (style.pattern.kind) {
        case 'solid':
            return style.pattern.color;
        case 'stripe':
            return style.pattern.base;
        case 'tracer':
            return style.pattern.base;
        case 'dual':
            return style.pattern.primary;
        case 'shield':
            return style.pattern.core ?? style.pattern.sheath;
        case 'custom':
            return style.pattern.layers[style.pattern.layers.length - 1]?.color ?? '#000000';
    }
}
export const COLORBLIND_SAFE_WIRE_PALETTE = [
    '#0072B2',
    '#D55E00',
    '#009E73',
    '#CC79A7',
    '#E69F00',
    '#56B4E9',
    '#F0E442',
    '#000000',
];
export function choosePaletteColor(index) {
    return COLORBLIND_SAFE_WIRE_PALETTE[((index % COLORBLIND_SAFE_WIRE_PALETTE.length) + COLORBLIND_SAFE_WIRE_PALETTE.length) % COLORBLIND_SAFE_WIRE_PALETTE.length];
}
//# sourceMappingURL=colors.js.map