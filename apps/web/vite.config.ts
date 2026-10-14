import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwind()],
  optimizeDeps: { include: ['@tiptap/react', '@tiptap/starter-kit', 'pdfjs-dist'] },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: process.env.VITE_API_TARGET ?? 'http://127.0.0.1:4000', ws: true } },
  },
  preview: {
    port: 4173,
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:4000', ws: true } },
  },
});
