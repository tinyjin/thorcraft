import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5188, fs: { allow: ['..'] } },
  optimizeDeps: { exclude: ['@thorvg/webcanvas'] },
  build: { target: 'es2022' },
});
