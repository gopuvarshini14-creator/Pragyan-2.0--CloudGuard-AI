import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In Docker the frontend is served by nginx, which proxies /api to the backend.
// This proxy only matters when running `npm run dev` directly on a host.
const apiTarget = process.env.VITE_API_PROXY || 'http://localhost:5000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1400
  }
});
