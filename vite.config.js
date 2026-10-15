import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [],
  server: { port: 5173, open: true },
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three/')) return 'three';
          if (id.includes('GLTFLoader')) return 'three-gltf';
        },
      },
    },
  },
});
