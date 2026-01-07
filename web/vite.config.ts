import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Base path for GitHub Pages (repo name)
  base: '/poe2templesolver/',
  optimizeDeps: {
    exclude: ['highs'], // Don't pre-bundle highs, it has WASM
  },
  build: {
    target: 'esnext', // Needed for top-level await in WASM
  },
})
