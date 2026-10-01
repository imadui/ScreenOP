import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

const alias = {
  '@shared': resolve('src/shared'),
  '@app-types': resolve('src/types')
};

// 'wasm-unsafe-eval' + oneloom-media: let the camera bubble load the local MediaPipe
// WebAssembly runtime (served from the app's own resources, never from the network).
const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' oneloom-media:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: oneloom-media:",
  "media-src 'self' blob: mediastream: oneloom-media:",
  "connect-src 'self' oneloom-media:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'"
].join('; ');

// The dev server needs inline scripts (React refresh preamble) and a websocket for HMR.
const DEV_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' oneloom-media:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: oneloom-media:",
  "media-src 'self' blob: mediastream: oneloom-media:",
  "connect-src 'self' ws://127.0.0.1:* http://127.0.0.1:* oneloom-media:",
  "font-src 'self' data:",
  "object-src 'none'"
].join('; ');

function contentSecurityPolicy(): Plugin {
  let isServe = false;
  return {
    name: 'oneloom-csp',
    configResolved(config) {
      isServe = config.command === 'serve';
    },
    transformIndexHtml(html) {
      const csp = isServe ? DEV_CSP : PROD_CSP;
      return html.replace('%ONELOOM_CSP%', csp);
    }
  };
}

export default defineConfig({
  main: {
    resolve: { alias }
  },
  preload: {
    resolve: { alias }
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias },
    plugins: [react(), contentSecurityPolicy()],
    server: { host: '127.0.0.1', strictPort: false },
    build: {
      minify: true,
      rollupOptions: {
        input: { index: resolve('src/renderer/index.html') }
      }
    }
  }
});
