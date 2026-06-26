import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
    plugins: [vue()],
    resolve: {
        tsconfigPaths: true,
    },
    server: {
        proxy: {
            "/api": {
                target:
                    process.env.VITE_API_BASE_URL ?? "http://localhost:8080",
                changeOrigin: true,
            },
        },
    },
});
