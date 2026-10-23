import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/auth': env.ACCOUNT_SERVICE_URL || 'http://localhost:8100',
        '/v1/accounts': env.ACCOUNT_SERVICE_URL || 'http://localhost:8100',
        '/v1/transactions': env.TRANSACTION_SERVICE_URL || 'http://localhost:8101',
      },
    },
  }
})
