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
interface Window { claude?: any; __gf?: any }
