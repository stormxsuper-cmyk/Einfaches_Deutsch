import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dev server is reached through many hostnames: localhost, a LAN IP, a Docker
// port mapping, a tunnel or a deployed domain. Vite's host check blocks all of
// them by default (HTTP 403 "Blocked request. This host is not allowed"), which
// the browser shows as an empty page, so allow every host explicitly.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
    // The browser must never talk to a hard-coded localhost backend: relative
    // /api requests are forwarded to the API server instead.
    proxy: {
      '/api': { target: process.env.VITE_PROXY_TARGET || 'http://localhost:4000', changeOrigin: true },
    },
  },
  preview: { host: '0.0.0.0', port: 4173, allowedHosts: true },
});
