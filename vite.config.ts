// Production build (WP27): both pages (editor, headless capture) and the included sprite library, which the
// preview loads from /assets/sprites at runtime and dev serves straight from the project root.
import { defineConfig } from 'vite';
import { cpSync } from 'node:fs';
import { resolve } from 'node:path';
import { captureStatusPlugin } from './tools/captureStatusPlugin.ts';

export default defineConfig({
  base: './',
  build: {
    rollupOptions: { input: { main: resolve(__dirname, 'index.html'), capture: resolve(__dirname, 'capture.html'), captureMedia: resolve(__dirname, 'capture-media.html') } },
    chunkSizeWarningLimit: 2000,
  },
  plugins: (() => {
    let outDir = resolve(__dirname, 'dist');
    return [captureStatusPlugin(), {
      name: 'copy-sprite-library',
      apply: 'build' as const,
      configResolved(c: { root: string; build: { outDir: string } }) { outDir = resolve(c.root, c.build.outDir); },
      closeBundle() { for (const d of ['sprites', 'sounds']) cpSync(resolve(__dirname, `assets/${d}`), resolve(outDir, `assets/${d}`), { recursive: true }); },
    }];
  })(),
});
