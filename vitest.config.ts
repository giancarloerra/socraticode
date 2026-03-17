import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // ESM support
    pool: "forks",

    // Test file patterns
    include: ["tests/**/*.test.ts", "src/plugins/**/*.test.ts"],

    // Longer timeouts for Docker-based integration tests
    testTimeout: 120_000,
    hookTimeout: 120_000,

    // Run tests sequentially (Docker resources and Qdrant collections are shared)
    sequence: {
      concurrent: false,
    },
    fileParallelism: false,

    // Coverage configuration
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"], // Entry point with stdio transport
    },
  },
});
