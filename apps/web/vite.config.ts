import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // 开发时把 WebSocket 转发到游戏服务端
    proxy: {
      "/socket.io": { target: "http://localhost:3001", ws: true },
    },
  },
});
