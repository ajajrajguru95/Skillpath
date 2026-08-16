import { describe, expect, it } from "vitest"
import { COURSES_URL } from "./fixtures"

/**
 * Guards the test harness itself.
 *
 * The component cancels in-flight requests with an AbortController. Under plain
 * jsdom that breaks: jsdom installs its own AbortController while `fetch` and
 * MSW's interceptor use Node's, and Node rejects a foreign signal with
 * "Expected signal ... to be an instance of AbortSignal". The custom environment
 * in jsdom-node-abort.ts restores Node's classes. If someone switches the config
 * back to plain jsdom, these fail rather than the whole suite failing obscurely.
 */
describe("test environment", () => {
    it("accepts an AbortSignal on fetch", async () => {
        const controller = new AbortController()
        const response = await fetch(COURSES_URL, { method: "GET", signal: controller.signal })

        expect(response.ok).toBe(true)
    })

    it("actually cancels a request when aborted", async () => {
        const controller = new AbortController()
        const pending = fetch(COURSES_URL, { method: "GET", signal: controller.signal })
        controller.abort()

        await expect(pending).rejects.toThrow()
    })

    it("provides a DOM, since the component renders one", () => {
        expect(typeof document).toBe("object")
        expect(document.createElement("div")).toBeInstanceOf(HTMLElement)
    })

    it("installs the ResizeObserver stub the column logic depends on", () => {
        expect(typeof ResizeObserver).toBe("function")
    })
})
