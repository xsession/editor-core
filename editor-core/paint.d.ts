import type { EditorTheme, WireColorPattern, WirePaintLayer, WireStyle } from './types.js';
export declare const DEFAULT_DARK_THEME: EditorTheme;
export declare const DEFAULT_LIGHT_THEME: EditorTheme;
export declare function relativeLuminance(color: string): number | undefined;
export declare function contrastRatio(a: string, b: string): number | undefined;
export declare function contrastingText(background: string, dark?: string, light?: string): string;
export declare function normalizeWirePattern(pattern: WireColorPattern): WireColorPattern;
export declare function wirePaintLayers(style: WireStyle, outlineColor?: string): WirePaintLayer[];
export declare function colorPatternDescription(pattern: WireColorPattern): string;
//# sourceMappingURL=paint.d.ts.map