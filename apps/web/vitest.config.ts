import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"]
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@dollarcast/shared": fileURLToPath(new URL("../../packages/shared/src/index.ts", import.meta.url)),
      "@dollarcast/ui": fileURLToPath(new URL("../../packages/ui/src/index.ts", import.meta.url))
    }
  }
});
