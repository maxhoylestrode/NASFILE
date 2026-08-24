import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // In dev, the frontend runs on its own port (Vite) and the backend
    // on 3000. Proxy API calls so the browser only ever talks to one
    // origin — matches how it'll actually run in production, where
    // Express serves the built frontend and the API from the same
    // origin. MinIO calls (presigned URLs) are never proxied here; they
    // go straight to MINIO_PUBLIC_URL regardless of dev/prod.
    proxy: {
      '/auth': 'http://localhost:3000',
      '/invites': 'http://localhost:3000',
      '/folders': 'http://localhost:3000',
      '/files': 'http://localhost:3000',
      '/healthz': 'http://localhost:3000',
    },
  },
})
