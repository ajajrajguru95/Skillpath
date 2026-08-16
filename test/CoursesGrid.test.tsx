import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import CoursesGrid from "../framer/CoursesGrid"
import { registeredControls } from "./stubs/framer"
import { setContainerWidth } from "./resize-observer"
import {
    countryFail,
    countryFailThenSucceed,
    countryRespond,
    coursesFail,
    coursesFailThenSucceed,
    coursesHang,
    coursesRespond,
    server,
} from "./server"
import { notionCourse, podcastCourse, threeCourses, youtubeCourse } from "./fixtures"

/**
 * These tests import the exact file that is pasted into Framer. `framer` is
 * aliased to a stub in vitest.config.ts, so there is no second copy of the
 * component's logic to drift out of sync.
 */

/** Defaults mirror the property controls, since Framer always supplies them. */
function renderGrid(overrides: Partial<Parameters<typeof CoursesGrid>[0]> = {}) {
    return render(
        <CoursesGrid heading="Our courses" fallbackCurrency="IN" maxCourses={12} {...overrides} />
    )
}

/** The component logs failures for developers; keep the test output readable. */
let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
    consoleError.mockRestore()
})

// ---------------------------------------------------------------------------

describe("price formatting", () => {
    it("renders paise as rupees, not the raw integer", async () => {
        server.use(coursesRespond([youtubeCourse]), countryRespond("IN"))
        renderGrid()

        // 199900 paise is Rs 1,999.00. Rendering Rs 1,99,900.00 is an automatic fail.
        expect(await screen.findByText("₹1,999.00")).toBeInTheDocument()
        expect(screen.queryByText("₹1,99,900.00")).not.toBeInTheDocument()
    })

    it("renders cents as dollars when the country is US", async () => {
        server.use(coursesRespond([youtubeCourse]), countryRespond("US"))
        renderGrid()

        expect(await screen.findByText("$39.99")).toBeInTheDocument()
        expect(screen.queryByText("$3,999.00")).not.toBeInTheDocument()
    })

    it("formats every course in the active currency", async () => {
        server.use(coursesRespond(threeCourses), countryRespond("IN"))
        renderGrid()

        expect(await screen.findByText("₹1,999.00")).toBeInTheDocument()
        expect(screen.getByText("₹1,799.00")).toBeInTheDocument()
        expect(screen.getByText("₹799.00")).toBeInTheDocument()
    })

    it("shows a placeholder instead of NaN when the active price is missing", async () => {
        const noUsdPrice = { ...youtubeCourse, priceUsdCents: null }
        server.use(coursesRespond([noUsdPrice]), countryRespond("US"))
        renderGrid()

        expect(await screen.findByText("Price unavailable")).toBeInTheDocument()
    })
})

describe("loading state", () => {
    it("renders skeletons on the first paint, before any response arrives", () => {
        server.use(coursesHang())
        const { container } = renderGrid()

        // Asserted synchronously - "nothing happens while it's loading" is an
        // explicit rejection criterion, so a delayed skeleton would not count.
        expect(container.querySelectorAll(".sp-shimmer").length).toBeGreaterThan(0)
        expect(container.querySelector("[aria-busy='true']")).toBeInTheDocument()
    })

    it("caps skeletons at the max-courses value when it is small", () => {
        server.use(coursesHang())
        const { container } = renderGrid({ maxCourses: 2 })

        // Two skeleton cards, each containing several shimmer bars.
        expect(container.querySelectorAll("[aria-hidden='true']").length).toBe(2)
    })

    it("clears aria-busy once the courses arrive", async () => {
        server.use(coursesRespond(threeCourses))
        const { container } = renderGrid()

        await screen.findByText(youtubeCourse.courseName)
        expect(container.querySelector("[aria-busy='true']")).not.toBeInTheDocument()
    })
})

describe("error state", () => {
    it("shows a recoverable message after every retry fails, never a raw error", async () => {
        server.use(coursesFail(500))
        renderGrid()

        expect(await screen.findByText("We couldn't load the courses")).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()

        // No status codes or stack traces leak to the visitor.
        expect(screen.queryByText(/500/)).not.toBeInTheDocument()
        expect(screen.queryByText(/HttpError/)).not.toBeInTheDocument()
    })

    it("treats an injected 404 the same as a 500", async () => {
        server.use(coursesFail(404))
        renderGrid()

        expect(await screen.findByText("We couldn't load the courses")).toBeInTheDocument()
    })

    it("keeps the heading visible so the section never blanks", async () => {
        server.use(coursesFail(500))
        renderGrid({ heading: "Our courses" })

        await screen.findByText("We couldn't load the courses")
        expect(screen.getByRole("heading", { name: "Our courses" })).toBeInTheDocument()
    })

    it("recovers when the retry button succeeds", async () => {
        const user = userEvent.setup()
        server.use(coursesFail(500))
        renderGrid()

        await screen.findByText("We couldn't load the courses")

        server.use(coursesRespond(threeCourses))
        await user.click(screen.getByRole("button", { name: "Retry" }))

        expect(await screen.findByText(youtubeCourse.courseName)).toBeInTheDocument()
        expect(screen.queryByText("We couldn't load the courses")).not.toBeInTheDocument()
    })

    it("succeeds without surfacing an error when an early attempt fails", async () => {
        // Two failures then a success - inside the three-attempt budget.
        server.use(coursesFailThenSucceed(2, threeCourses))
        renderGrid()

        expect(await screen.findByText(youtubeCourse.courseName)).toBeInTheDocument()
        expect(screen.queryByText("We couldn't load the courses")).not.toBeInTheDocument()
    })
})

describe("timeout", () => {
    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true })
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it("warns at six seconds, then fails with timeout-specific copy at fifteen", async () => {
        server.use(coursesHang())
        renderGrid()

        // act() so React flushes the state the timer callbacks queue.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(6000)
        })
        expect(screen.getByText(/waking up/)).toBeInTheDocument()

        await act(async () => {
            await vi.advanceTimersByTimeAsync(9500)
        })
        expect(screen.getByText("This is taking longer than expected")).toBeInTheDocument()
        // Distinct from the generic failure copy, because the advice differs.
        expect(screen.queryByText("We couldn't load the courses")).not.toBeInTheDocument()
    })
})

describe("empty state", () => {
    it("distinguishes an empty catalogue from a failure", async () => {
        server.use(coursesRespond([]))
        renderGrid()

        expect(await screen.findByText("No courses to show yet")).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument()
        expect(screen.queryByText("We couldn't load the courses")).not.toBeInTheDocument()
    })

    it("treats a payload of entirely unusable entries as empty, not broken", async () => {
        server.use(coursesRespond([null, {}, { courseName: "No price anywhere" }, 42]))
        renderGrid()

        expect(await screen.findByText("No courses to show yet")).toBeInTheDocument()
    })
})

describe("malformed payloads", () => {
    it("drops unusable entries but still renders the valid ones", async () => {
        server.use(coursesRespond([youtubeCourse, null, { courseName: "Priceless" }, notionCourse]))
        renderGrid()

        expect(await screen.findByText(youtubeCourse.courseName)).toBeInTheDocument()
        expect(screen.getByText(notionCourse.courseName)).toBeInTheDocument()
        expect(screen.queryByText("Priceless")).not.toBeInTheDocument()
    })

    it("survives an object where an array was promised", async () => {
        server.use(coursesRespond({ courses: threeCourses }))
        renderGrid()

        expect(await screen.findByText("No courses to show yet")).toBeInTheDocument()
    })

    it("removes duplicate course codes", async () => {
        server.use(coursesRespond([youtubeCourse, youtubeCourse]))
        renderGrid()

        await screen.findByText(youtubeCourse.courseName)
        expect(screen.getAllByText(youtubeCourse.courseName)).toHaveLength(1)
    })
})

describe("country lookup failure", () => {
    it("still renders every course, priced in the fallback currency, and says so", async () => {
        server.use(coursesRespond([youtubeCourse]), countryFail())
        renderGrid({ fallbackCurrency: "IN" })

        expect(await screen.findByText(youtubeCourse.courseName)).toBeInTheDocument()
        expect(screen.getByText("₹1,999.00")).toBeInTheDocument()
        expect(screen.getByText(/couldn’t confirm your region/)).toBeInTheDocument()
    })

    it("honours a US fallback", async () => {
        server.use(coursesRespond([youtubeCourse]), countryFail())
        renderGrid({ fallbackCurrency: "US" })

        expect(await screen.findByText("$39.99")).toBeInTheDocument()
        expect(screen.getByText(/US dollars/)).toBeInTheDocument()
    })

    it("falls back when the country code is unrecognised rather than trusting it", async () => {
        server.use(coursesRespond([youtubeCourse]), countryRespond("ZZ"))
        renderGrid({ fallbackCurrency: "US" })

        expect(await screen.findByText("$39.99")).toBeInTheDocument()
        expect(screen.getByText(/couldn’t confirm your region/)).toBeInTheDocument()
    })

    it("survives a fallback currency the panel did not sanitise", async () => {
        server.use(coursesRespond([youtubeCourse]), countryFail())
        // Framer serialises the enum by its title; a bad value must not reach the
        // formatter lookup, where a miss would throw and blank the section.
        renderGrid({ fallbackCurrency: "India (INR)" as never })

        expect(await screen.findByText("₹1,999.00")).toBeInTheDocument()
    })

    it("shows no notice when the lookup succeeds", async () => {
        server.use(coursesRespond([youtubeCourse]), countryRespond("IN"))
        renderGrid()

        await screen.findByText(youtubeCourse.courseName)
        expect(screen.queryByText(/couldn’t confirm your region/)).not.toBeInTheDocument()
    })

    it("re-prices in place when the visitor retries the region check", async () => {
        const user = userEvent.setup()
        // Fails the three attempts of the initial load, succeeds on the retry.
        server.use(coursesRespond([youtubeCourse]), countryFailThenSucceed(3, "US"))
        renderGrid({ fallbackCurrency: "IN" })

        expect(await screen.findByText("₹1,999.00")).toBeInTheDocument()

        await user.click(screen.getByRole("button", { name: "Try again" }))

        expect(await screen.findByText("$39.99")).toBeInTheDocument()
        expect(screen.queryByText(/couldn’t confirm your region/)).not.toBeInTheDocument()
    })
})

describe("card content", () => {
    it("shows the name, description, category and price", async () => {
        server.use(coursesRespond([youtubeCourse]), countryRespond("IN"))
        renderGrid()

        const card = (await screen.findByText(youtubeCourse.courseName)).closest("article")
        expect(card).not.toBeNull()

        const scoped = within(card as HTMLElement)
        expect(scoped.getByText(youtubeCourse.description)).toBeInTheDocument()
        expect(scoped.getByText("Content Creation")).toBeInTheDocument()
        expect(scoped.getByText("₹1,999.00")).toBeInTheDocument()
    })

    it("clamps the description to two lines rather than truncating in JS", async () => {
        server.use(coursesRespond([youtubeCourse]))
        renderGrid()

        const description = await screen.findByText(youtubeCourse.description)
        // Full text stays in the DOM, so screen readers and search get all of it.
        expect(description).toHaveClass("sp-clamp")
        expect(description.textContent).toBe(youtubeCourse.description)
    })

    it("shows the refundable badge only when the field is true", async () => {
        server.use(coursesRespond([youtubeCourse, podcastCourse]))
        renderGrid()

        const refundableCard = (await screen.findByText(youtubeCourse.courseName)).closest("article")
        const nonRefundableCard = screen.getByText(podcastCourse.courseName).closest("article")

        expect(within(refundableCard as HTMLElement).getByText("Refundable")).toBeInTheDocument()
        expect(within(nonRefundableCard as HTMLElement).queryByText("Refundable")).not.toBeInTheDocument()
    })
})

describe("responsive grid", () => {
    /** Mounts once, then reports the column rule at any width the caller asks for. */
    async function mountGrid() {
        server.use(coursesRespond(threeCourses))
        const { container } = renderGrid()
        await screen.findByText(youtubeCourse.courseName)

        const grid = container.querySelector("[style*='grid-template-columns']") as HTMLElement

        return function columnsAt(width: number) {
            act(() => setContainerWidth(width))
            return grid.style.gridTemplateColumns
        }
    }

    it("uses three columns on desktop", async () => {
        const columnsAt = await mountGrid()
        expect(columnsAt(1440)).toBe("repeat(3, minmax(0, 1fr))")
    })

    it("uses two columns on tablet", async () => {
        const columnsAt = await mountGrid()
        expect(columnsAt(800)).toBe("repeat(2, minmax(0, 1fr))")
    })

    it("uses one column on mobile", async () => {
        const columnsAt = await mountGrid()
        expect(columnsAt(375)).toBe("repeat(1, minmax(0, 1fr))")
    })

    it("does not break at the breakpoint boundaries", async () => {
        const columnsAt = await mountGrid()
        expect(columnsAt(1024)).toBe("repeat(3, minmax(0, 1fr))")
        expect(columnsAt(1023)).toBe("repeat(2, minmax(0, 1fr))")
        expect(columnsAt(640)).toBe("repeat(2, minmax(0, 1fr))")
        expect(columnsAt(639)).toBe("repeat(1, minmax(0, 1fr))")
        // Nothing collapses to zero columns at a degenerate width.
        expect(columnsAt(0)).toBe("repeat(1, minmax(0, 1fr))")
    })

    it("renders a ragged final row without padding it out", async () => {
        // Five courses across three columns leaves two on the last row.
        const five = threeCourses.concat([
            { ...youtubeCourse, courseCode: "extra-1", courseName: "Extra One" },
            { ...youtubeCourse, courseCode: "extra-2", courseName: "Extra Two" },
        ])
        server.use(coursesRespond(five))
        const { container } = renderGrid()

        await screen.findByText("Extra Two")
        expect(container.querySelectorAll("article")).toHaveLength(5)
    })
})

describe("property controls", () => {
    it("registers heading, fallback currency and max courses", () => {
        const controls = registeredControls.get(CoursesGrid) as Record<string, { type: string }>

        expect(Object.keys(controls).sort()).toEqual([
            "fallbackCurrency",
            "heading",
            "maxCourses",
        ])
        // Framer needs a default on every control or the canvas renders blank.
        for (const control of Object.values(controls)) {
            expect(control).toHaveProperty("defaultValue")
        }
    })

    it("renders the heading from its control", async () => {
        server.use(coursesRespond(threeCourses))
        renderGrid({ heading: "Learn something that sticks" })

        expect(
            screen.getByRole("heading", { name: "Learn something that sticks" })
        ).toBeInTheDocument()
    })

    it("limits the grid to the max-courses value", async () => {
        server.use(coursesRespond(threeCourses))
        const { container } = renderGrid({ maxCourses: 2 })

        await screen.findByText(youtubeCourse.courseName)
        expect(container.querySelectorAll("article")).toHaveLength(2)
    })
})

describe("request discipline", () => {
    it("only ever issues GET requests", async () => {
        const methods: string[] = []
        const record = ({ request }: { request: Request }) => {
            methods.push(request.method)
        }
        server.events.on("request:start", record)

        try {
            server.use(coursesRespond(threeCourses))
            renderGrid()
            await screen.findByText(youtubeCourse.courseName)

            expect(methods.length).toBeGreaterThan(0)
            // Anything other than GET returns 405 on this API.
            expect(new Set(methods)).toEqual(new Set(["GET"]))
        } finally {
            server.events.removeListener("request:start", record)
        }
    })

    it("requests both endpoints in parallel rather than in sequence", async () => {
        const started: string[] = []
        const record = ({ request }: { request: Request }) => {
            started.push(new URL(request.url).pathname)
        }
        server.events.on("request:start", record)

        try {
            server.use(coursesRespond(threeCourses))
            renderGrid()
            await screen.findByText(youtubeCourse.courseName)

            // Both are in flight before either resolves, so a slow country lookup
            // cannot delay the course list.
            expect(started.slice(0, 2).sort()).toEqual([
                "/assignment/country-code",
                "/assignment/course-data",
            ])
        } finally {
            server.events.removeListener("request:start", record)
        }
    })

    it("aborts in-flight requests on unmount without updating state", async () => {
        server.use(coursesHang())
        const { unmount } = renderGrid()

        unmount()
        await new Promise(resolve => setTimeout(resolve, 50))

        // The disposed guard runs before any setState or logging.
        expect(consoleError).not.toHaveBeenCalled()
    })
})

describe("accessibility", () => {
    it("names the section with its heading", async () => {
        server.use(coursesRespond(threeCourses))
        renderGrid({ heading: "Our courses" })

        expect(await screen.findByRole("region", { name: "Our courses" })).toBeInTheDocument()
    })

    it("announces each state through a live region", async () => {
        server.use(coursesRespond(threeCourses))
        const { container } = renderGrid()

        const live = container.querySelector("[aria-live='polite']") as HTMLElement
        expect(live).toHaveTextContent("Loading courses")

        await screen.findByText(youtubeCourse.courseName)
        expect(live).toHaveTextContent("3 courses loaded")
    })

    it("uses real buttons for the recovery actions", async () => {
        server.use(coursesFail(500))
        renderGrid()

        const retry = await screen.findByRole("button", { name: "Retry" })
        expect(retry.tagName).toBe("BUTTON")
        expect(retry).toHaveAttribute("type", "button")
    })
})
