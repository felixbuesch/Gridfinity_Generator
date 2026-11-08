/// <reference types="svelte" />
/// <reference types="vite/client" />
declare module '*/gf.js' { const GF: any; export default GF; }
declare module '*/intro.js' {
  export const DEFAULTS: Record<string, any>;
  export const USES: Use[];
  export function planOptions(use: string, W: number, D: number): Record<string, number>;
  export function createIntro(o: { onDone: (r: { use: Use; W: number; D: number; opts: Record<string, number> }) => void }): { show(): void };
  export interface Use { id: 'desk' | 'drawer' | 'box'; name: string; tag: string; W: number; D: number; q: string; area: string; hint: string }
}
declare module '*/stage.js' { const Stage: any; export default Stage; export const MiniView: any; }
declare module '*/core.js' { const x: any; export = x; }
interface Window { claude?: any; __gf?: any; __planer?: any }
