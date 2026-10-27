import { defineConfig } from 'vite';

// The client talks to the game server on its own origin, as it will where the gateway serves it: in development these
// paths are proxied to `pnpm dev:server` (ASTRA_SERVER points them at another, as the online smoke spec does).
const server = process.env.ASTRA_SERVER || 'http://127.0.0.1:8787';
const proxy = {
  '/auth': server,
  '/characters': server,
  '/health': server,
  '/ws': { target: server.replace(/^http/, 'ws'), ws: true },
};

export default defineConfig({
  server: { port: Number(process.env.PORT) || 5173, host: true, proxy },
  preview: { proxy },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
