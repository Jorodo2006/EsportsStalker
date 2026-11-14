/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const GATEWAY = 'http://127.0.0.1:47365';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { chunkSizeWarningLimit: 1500 },
  // Pruebas de la lógica de la interfaz (modelos, valor, recomendaciones): npm test las pasa con las del servidor
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
  // En desarrollo Vite hace lo mismo que nginx en Docker: reenvía el backend al gateway
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy: { '/api': GATEWAY, '/events': GATEWAY } }
});
