import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Build = eine einzige HTML-Datei (three.js inline), offline nutzbar und als Artifact veröffentlichbar.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: { target: 'es2020' },
});
