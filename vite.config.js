import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// npm run build        -> dist/ mit getrennten Dateien (Website, GitHub Pages)
// npm run build:single -> dist-single/index.html, eine Datei (offline, Artifact)
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  build: { target: 'es2020', outDir: mode === 'single' ? 'dist-single' : 'dist' },
}));
