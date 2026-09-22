import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // The API is served by apps/server. Proxying in development keeps the
      // browser on one origin, so session cookies behave the same as they will
      // in production where the server also serves this bundle.
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
  build: {
    // Emitted into the server's static directory so a single process serves
    // both the API and the UI. That matters for the LAN deployment, where
    // running two processes doubles what can break unattended.
    outDir: 'dist',
    sourcemap: true,
  },
});
