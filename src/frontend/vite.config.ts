import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Listen on the Wi-Fi too, so phones/laptops at home can open http://<Mac's LAN IP>:5173.
    // The backend stays on 127.0.0.1; only this proxy reaches it.
    host: true,
    allowedHosts: ['.trycloudflare.com', '.ngrok-free.app', '.ngrok-free.dev', '.ngrok.io', '.lhr.life', '.loca.lt'],
    proxy: {
      // xfwd: append the real client address to X-Forwarded-For, which the backend's
      // is_local_request checks — every proxied request otherwise looks like 127.0.0.1.
      '/api': { target: 'http://localhost:8000', xfwd: true },
    },
  },
})
