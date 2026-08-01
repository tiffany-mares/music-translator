/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // shadcn convention: @/ -> src/ (mirrors tsconfig paths; vitest shares this)
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  plugins: [react(), tailwindcss()],
  // crepeWorker dynamically imports tfjs; iife workers can't code-split.
  worker: { format: 'es' },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
    // The always-mounted marketing DOM makes jsdom role scans slow under
    // parallel suite load; 5s default flakes on slower runs.
    testTimeout: 20000,
  },
})
