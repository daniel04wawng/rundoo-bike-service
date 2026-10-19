import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const apiPort = process.env.API_PORT || 3000;

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    // Two pages: the mechanic app (/) and the bike-shop landing page (/bike-shops/).
    rollupOptions: {
      input: {
        app: resolve(import.meta.dirname, 'web/index.html'),
        landing: resolve(import.meta.dirname, 'web/bike-shops/index.html'),
      },
    },
  },
  server: {
    port: Number(process.env.WEB_PORT || 5173),
    proxy: { '/api': `http://localhost:${apiPort}` },
  },
});
