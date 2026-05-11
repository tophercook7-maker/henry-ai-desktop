import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import electronRenderer from 'vite-plugin-electron-renderer';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['better-sqlite3'],
              output: {
                // ESM banner: shim __filename, __dirname, AND require() so bundled
                // CommonJS-style code (require('fs'), etc) keeps working in the
                // ESM Node context Electron uses when package.json has type:module.
                banner: `import { fileURLToPath } from 'url'; import { dirname } from 'path'; import { createRequire } from 'module'; const __filename = fileURLToPath(import.meta.url); const __dirname = dirname(__filename); const require = createRequire(import.meta.url);`,
                inlineDynamicImports: true,
              },
            },
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart(args) {
          args.reload();
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['better-sqlite3'],
              output: {
                inlineDynamicImports: true,
              },
            },
          },
        },
      },
    ]),
    electronRenderer(),
  ],
  base: './',
  build: {
    outDir: 'renderer',
  },
  optimizeDeps: {
    exclude: ['@capacitor-mlkit/barcode-scanning'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@capacitor-mlkit/barcode-scanning': path.resolve(
        __dirname,
        './src/stubs/barcodeScanning.ts'
      ),
    },
  },
});
