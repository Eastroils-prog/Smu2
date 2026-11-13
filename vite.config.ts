import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// Modes:
//   (default)  the real app, connected to Supabase through .env.local
//   demo       the click-through sample (ignores Supabase settings)
//   single     the sample packed into one HTML file for sharing
export default defineConfig(({ mode }) => {
  const sample = mode === 'demo' || mode === 'single'
  return {
    plugins: [react(), tailwindcss(), ...(mode === 'single' ? [viteSingleFile()] : [])],
    build: { outDir: mode === 'single' ? 'dist-single' : mode === 'demo' ? 'dist-demo' : 'dist' },
    define: sample
      ? { 'import.meta.env.VITE_SUPABASE_URL': '""', 'import.meta.env.VITE_SUPABASE_ANON_KEY': '""' }
      : {},
  }
})
