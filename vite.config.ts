import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/auth': env.GATEWAY_URL || 'http://localhost:8080',
        '/v1': env.GATEWAY_URL || 'http://localhost:8080',
      },
    },
  }
})
