import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"

export default defineConfig({
    resolve: {
        alias: {
            // The component imports from "framer", which only exists inside the Framer
            // runtime. Aliasing it to a local stub lets the tests import the exact file
            // that ships, rather than a copy of its logic.
            framer: fileURLToPath(new URL("./test/stubs/framer.ts", import.meta.url)),
        },
    },
    esbuild: {
        jsx: "automatic",
    },
    test: {
        globals: true,
        // jsdom, but with Node's AbortController restored. See the file for why.
        environment: "./test/jsdom-node-abort.ts",
        setupFiles: ["./test/setup.ts"],
        include: ["test/**/*.test.tsx"],
        restoreMocks: true,
        // The component retries twice (400ms + 900ms) before giving up, so the
        // failure-path assertions need longer than the 1s default.
        testTimeout: 15000,
    },
})
