import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// The shared `.env` lives at the repo root. Vite only exposes keys with the `VITE_`
// prefix to the browser, so the backend credentials in that file never reach the bundle.
const envDir = fileURLToPath(new URL('../..', import.meta.url));
const proxied = ['/api', '/healthz'];

export default defineConfig(({ mode }) => {
  const target = loadEnv(mode, envDir).VITE_API_PROXY || 'http://localhost:3000';
  return {
    envDir,
    envPrefix: 'VITE_',
    plugins: [react()],
    server: {
      port: 5173,
      proxy: Object.fromEntries(proxied.map((path) => [path, { target, changeOrigin: false }])),
    },
  };
});
