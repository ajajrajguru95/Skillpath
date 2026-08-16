import { builtinEnvironments } from "vitest/environments"
import type { Environment } from "vitest/environments"

/**
 * jsdom, but keeping Node's AbortController.
 *
 * Why this exists: the global `fetch` under test is Node's, and MSW's interceptor
 * builds a Node `Request` from whatever init we pass it. Node brand-checks the
 * signal with `instanceof AbortSignal` against its own class, so a jsdom signal
 * is rejected with:
 *
 *   TypeError: RequestInit: Expected signal ("AbortSignal {}") to be an instance
 *   of AbortSignal.
 *
 * A browser has a single realm, so this mismatch cannot happen in production -
 * it is purely an artifact of running DOM code on Node. Rather than weaken the
 * component (dropping the signal would mean dropping cancellation), the test
 * environment is corrected: jsdom sets everything up as usual, then the two
 * abort globals are put back to Node's.
 *
 * Captured at module load, which runs before jsdom copies its own globals over.
 */
const nodeAbortController = globalThis.AbortController
const nodeAbortSignal = globalThis.AbortSignal

const jsdomEnvironment = builtinEnvironments.jsdom

const environment: Environment = {
    name: "jsdom-node-abort",
    transformMode: "web",

    async setup(global, options) {
        const { teardown } = await jsdomEnvironment.setup(global, options)

        const jsdomAbortController = global.AbortController
        const jsdomAbortSignal = global.AbortSignal

        global.AbortController = nodeAbortController
        global.AbortSignal = nodeAbortSignal

        return {
            teardown(current: typeof global) {
                // Restore jsdom's before handing back, so teardown sees the state
                // it created.
                current.AbortController = jsdomAbortController
                current.AbortSignal = jsdomAbortSignal
                return teardown(current)
            },
        }
    },
}

export default environment
