import "@testing-library/jest-dom/vitest"
import { afterAll, afterEach, beforeAll } from "vitest"
import { cleanup, configure } from "@testing-library/react"
import { server } from "./server"

// Two retries at 400ms and 900ms mean a full failure takes ~1.3s, past the 1s
// default that findBy* waits.
configure({ asyncUtilTimeout: 6000 })

// `error` so an unhandled request fails the test loudly instead of reaching the
// real API. Every request the component makes must be declared in a handler.
beforeAll(() => server.listen({ onUnhandledRequest: "error" }))

afterEach(() => {
    server.resetHandlers()
    cleanup()
})

afterAll(() => server.close())
