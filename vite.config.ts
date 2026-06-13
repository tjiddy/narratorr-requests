import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// Client dev server proxies /api to the Fastify server. In prod the server
// serves the built client (dist/client) via @fastify/static.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: 'src/client',
  // Absolute base so hashed asset URLs resolve from any deep link when the prod
  // server serves index.html as the SPA fallback (e.g. /requests, /admin).
  base: '/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/client'),
      '@core': path.resolve(__dirname, './src/core'),
      '@shared': path.resolve(__dirname, './src/shared'),
    },
  },
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
  server: {
    // Dev ports are configurable so the app can run alongside sibling projects
    // (Narratorr/earwitness) without colliding on 3000/5173. The proxy targets the
    // Fastify server's PORT (the one documented var); SERVER_PORT is an explicit
    // override for the rare case the client and server ports must differ.
    port: Number(process.env.CLIENT_PORT) || 5173,
    proxy: {
      // Regex (not bare '/api') so it doesn't swallow the client's own /api.ts module.
      '^/api/': {
        target: `http://localhost:${Number(process.env.SERVER_PORT || process.env.PORT) || 3000}`,
        changeOrigin: true,
      },
    },
  },
});
