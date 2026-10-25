import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "tests/helpers/empty.ts"),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    testTimeout: 30000,
    hookTimeout: 60000,
    env: { NODE_ENV: "test", APP_MODE: "standard" },
  },
});
