import { defineConfig } from 'tsdown'

/**
 * Electron executes sandboxed preloads as CommonJS scripts even when the
 * application package is ESM. Bundle the fixed bridge and keep Electron's
 * renderer globals as Electron-provided runtime imports.
 */
export default defineConfig({
  entry: { 'preload-electron': 'lib/preload-electron.js' },
  outDir: 'lib',
  format: ['cjs'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  sourcemap: false,
  clean: false,
  deps: { neverBundle: ['electron'] },
})
