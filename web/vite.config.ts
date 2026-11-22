import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

export default defineConfig({
  plugins: [preact()],
  build: { outDir: 'dist', assetsDir: 'assets', sourcemap: false },
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
      '/ws': { target: 'ws://localhost:8000', ws: true },
      '/sfx': 'http://localhost:8000',
      '/music': 'http://localhost:8000',
    },
  },
  test: { environment: 'node' },
} as any)
