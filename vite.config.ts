import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import { consoleApi } from './server/plugin'

export default defineConfig({
  plugins: [react(), consoleApi()],
  server: { port: 5178, host: '127.0.0.1' },
  preview: { port: 5178, host: '127.0.0.1' },
})
