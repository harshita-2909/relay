import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const CHIRP_URL = process.env.CHIRP_URL ?? 'http://localhost:4001';
const RELAY_URL = process.env.RELAY_URL ?? 'http://localhost:4000';

// The browser talks to two separate services through the dev server:
//   /chirp-api/* → Chirp (the pretend app)
//   /relay-api/* → Relay (inbox, preferences, templates, records)
export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: true,
    proxy: {
      '/chirp-api': { target: CHIRP_URL, rewrite: (p) => p.replace(/^\/chirp-api/, '/api') },
      '/relay-api': { target: RELAY_URL, rewrite: (p) => p.replace(/^\/relay-api/, '/api') },
    },
  },
});
