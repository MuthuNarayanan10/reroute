import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const root = resolve(__dirname);
const API = process.env.API_URL ?? 'http://localhost:3000';

/** Dev only: serve app.html for /app and /app/* (the production server does the same). */
function spaFallback(): Plugin {
  return {
    name: 'reroute-spa-fallback',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url ?? '';
        if (url === '/app' || (url.startsWith('/app/') && !url.includes('.'))) req.url = '/app.html';
        else if (url === '/privacy' || url === '/terms') req.url = `${url}.html`;
        next();
      });
    },
  };
}

export default defineConfig({
  root,
  plugins: [react(), spaFallback()],
  build: {
    outDir: resolve(root, 'dist'),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        index: resolve(root, 'index.html'),
        privacy: resolve(root, 'privacy.html'),
        terms: resolve(root, 'terms.html'),
        app: resolve(root, 'app.html'),
        notFound: resolve(root, '404.html'),
      },
    },
  },
  server: {
    port: 5173,
    proxy: Object.fromEntries(['/auth', '/app-api', '/public', '/api'].map((p) => [p, { target: API, changeOrigin: false }])),
  },
});
