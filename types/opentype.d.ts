declare module 'opentype.js' {
  export interface PathCommand { type: 'M' | 'L' | 'C' | 'Q' | 'Z'; x: number; y: number; x1: number; y1: number; x2: number; y2: number }
  export interface GlyphPath { commands: PathCommand[] }
  export interface RenderOptions { kerning?: boolean; letterSpacing?: number; features?: unknown }
  export interface Glyph {
    index: number;
    name?: string;
    unicode?: number;
    advanceWidth?: number;
    getPath(x: number, y: number, fontSize: number, options?: RenderOptions, font?: Font): GlyphPath;
  }
  export interface Font {
    unitsPerEm: number;
    ascender: number;
    descender: number;
    names: { fontFamily?: Record<string, string>; fullName?: Record<string, string> };
    charToGlyph(ch: string): Glyph;
    getKerningValue(left: Glyph, right: Glyph): number;
    getPath(text: string, x: number, y: number, fontSize: number, options?: RenderOptions): GlyphPath;
    getPaths(text: string, x: number, y: number, fontSize: number, options?: RenderOptions): GlyphPath[];
    getAdvanceWidth(text: string, fontSize: number, options?: RenderOptions): number;
  }
  export function parse(buffer: ArrayBuffer): Font;
}
