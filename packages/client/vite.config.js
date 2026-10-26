import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: Number(process.env.PORT) || 5173, host: true },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
