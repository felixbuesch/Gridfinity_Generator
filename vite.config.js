import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { viteSingleFile } from 'vite-plugin-singlefile';

// npm run build        -> dist/ mit getrennten Dateien (Website, GitHub Pages)
// npm run build:single -> dist-single/index.html, eine Datei (offline, Artifact)
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [svelte(), ...(mode === 'single' ? [viteSingleFile()] : [])],
  build: { target: 'es2020', outDir: mode === 'single' ? 'dist-single' : 'dist', chunkSizeWarningLimit: 1500 },
  test: { include: ['tests/**/*.test.js'] },
}));
