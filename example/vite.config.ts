import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: fileURLToPath(new URL('../upa/frontend/public', import.meta.url)),
  server: {
    host: '0.0.0.0',
    port: 5174,
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] },
  },
});