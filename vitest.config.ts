import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // Live tests call a real API; the default 5s is not enough for a cold request.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
