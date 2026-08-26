import type { EditorTheme, WirePaintLayer, WireStyle } from './types.js';
export interface RgbColor {
    r: number;
    g: number;
    b: number;
    a: number;
}
export declare function parseHexColor(value: string): RgbColor | undefined;
export declare function toHexColor(color: RgbColor, includeAlpha?: boolean): string;
export declare function relativeLuminance(value: string): number;
export declare function contrastRatio(a: string, b: string): number;
export declare function bestTextColor(background: string, light?: string, dark?: string): string;
export declare function mixColors(a: string, b: string, ratio?: number): string;
export interface WirePaintResolution {
    engineeringLayers: WirePaintLayer[];
    outline?: WirePaintLayer;
    selection?: WirePaintLayer;
    warning?: WirePaintLayer;
}
/**
 * Converts engineering wire colour semantics into an ordered stack of strokes.
 * Selection and validation are separate visual channels so they never replace
 * the insulation colour that carries engineering meaning.
 */
export declare function resolveWirePaint(style: WireStyle, theme: EditorTheme, state?: {
    selected?: boolean;
    hovered?: boolean;
    warning?: boolean;
    invalid?: boolean;
}): WirePaintResolution;
export declare function wirePatternPrimaryColor(style: WireStyle): string;
export declare const COLORBLIND_SAFE_WIRE_PALETTE: readonly ["#0072B2", "#D55E00", "#009E73", "#CC79A7", "#E69F00", "#56B4E9", "#F0E442", "#000000"];
export declare function choosePaletteColor(index: number): string;
//# sourceMappingURL=colors.d.ts.map