import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Separate large dependencies into independent chunks
          'ethers': ['ethers'],
          'd3': ['d3'],
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'ui-vendor': ['lucide-react', 'react-hook-form', '@hookform/resolvers', 'zod'],
          'i18n': ['i18next', 'react-i18next', 'i18next-browser-languagedetector']
        }
      }
    },
    // Increase chunk size warning limit to 1MB since some third-party libraries are indeed large
    chunkSizeWarningLimit: 1000
  }
})

