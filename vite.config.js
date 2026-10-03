import { defineConfig } from 'vite';

// Relative base: the built game runs from any host or subfolder.
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  server: { port: 5270, strictPort: true },
  preview: { port: 5271, strictPort: true },
});
