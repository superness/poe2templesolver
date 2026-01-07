import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['highs'], // Don't pre-bundle highs, it has WASM
  },
  build: {
    target: 'esnext', // Needed for top-level await in WASM
  },
})
