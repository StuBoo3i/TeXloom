import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/TeXloom/',
  root: 'client',
  plugins: [
    react(),
    {
      name: 'pages-entry',
      transformIndexHtml: {
        order: 'pre',
        handler(html) {
          return html.replace('src="/src/main.tsx"', 'src="/src/landing-site.tsx"')
        },
      },
    },
  ],
  build: { outDir: '../dist-pages', emptyOutDir: true },
})
