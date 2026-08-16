import { addPropertyControls, ControlType, useIsStaticRenderer } from "framer"
import { useCallback, useEffect, useId, useRef, useState } from "react"
import type { CSSProperties, RefObject } from "react"

/**
 * Skillpath - courses grid.
 *
 * Fetches live course data and the visitor's country, then renders a responsive
 * grid of course cards. The API fails roughly one request in three on purpose,
 * so the failure paths here are the point of the component, not an afterthought.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CountryCode = "IN" | "US"

/** The subset of the API payload this component actually renders. */
interface Course {
    courseName: string
    courseCode: string
    description: string
    mainCategory: string
    pricePaise: number | null
    priceUsdCents: number | null
    refundable: boolean
}

/** One state at a time. Booleans would allow "loading and empty" to coexist. */
type Status = "loading" | "error" | "empty" | "ready"

/** The two failures we can actually tell apart, and so give different advice for. */
type FailureKind = "request" | "timeout"

interface CoursesState {
    status: Status
    courses: Course[]
    country: CountryCode
    /** True when the country lookup failed and `country` is the designer's default. */
    usedFallbackCurrency: boolean
    failureKind: FailureKind | null
}

interface CoursesGridProps {
    heading: string
    fallbackCurrency: CountryCode
    maxCourses: number
    style?: CSSProperties
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const API_BASE = "https://syncsphere-hiv6.onrender.com"
const COURSES_URL = `${API_BASE}/assignment/course-data`
const COUNTRY_URL = `${API_BASE}/assignment/country-code`

/** Two retries after the first try. ~33% failure per call becomes ~4% per render. */
const RETRY_DELAYS_MS = [400, 900]

/** The host sleeps when idle, so a cold start can take a while. Warn, then give up. */
const SLOW_NOTICE_MS = 6000
const REQUEST_TIMEOUT_MS = 15000

/** Column breakpoints, measured against the component's own box. See STYLE_SHEET. */
const DESKTOP_MIN_WIDTH = 1024
const TABLET_MIN_WIDTH = 640

/**
 * The API returns 5-10 courses. At three columns that is 2, 2, 3, 3, 3 or 4 rows,
 * so three rows is the most likely outcome and 8 placeholders is the count that
 * matches it. Guessing 6 made the grid grow by a row on most loads.
 */
const DEFAULT_SKELETONS = 8

/**
 * Skeletons and loaded cards must occupy the same height or the page jumps when
 * data arrives. Both use this floor rather than trying to match bar-by-bar.
 * Measured against a rendered card: 40 padding + 36 gaps + 135 content.
 */
const CARD_MIN_HEIGHT = 211

const PRICE_UNAVAILABLE = "Price unavailable"

/**
 * Built once rather than per card. Both are safe at module scope - `Intl` needs
 * no DOM, so this survives Framer's static render.
 */
const PRICE_FORMATTERS: Record<CountryCode, Intl.NumberFormat> = {
    IN: new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }),
    US: new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }),
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Carries the HTTP status so the retry logic can reason about the response. */
class HttpError extends Error {
    status: number

    constructor(status: number) {
        super(`Request failed with status ${status}`)
        this.name = "HttpError"
        this.status = status
    }
}

/**
 * A property control is still external input: the panel serialises the enum by
 * its title, and nothing stops a future edit passing something else. Anything
 * unrecognised becomes IN rather than reaching the formatter lookup, where a
 * miss would throw and take the whole section down.
 */
function toCountryCode(value: unknown): CountryCode {
    return value === "US" ? "US" : "IN"
}

/**
 * Both price fields are in minor units: 199900 paise is Rs 1,999.00 and 3999
 * cents is $39.99. Dividing by 100 is the entire trick - formatting the raw
 * integer would render Rs 1,99,900.00, which is the documented way to fail.
 */
function formatPrice(course: Course, country: CountryCode): string {
    const minorUnits = country === "IN" ? course.pricePaise : course.priceUsdCents
    if (minorUnits === null || !Number.isFinite(minorUnits)) return PRICE_UNAVAILABLE
    return PRICE_FORMATTERS[country].format(minorUnits / 100)
}

/** Reads a field only if it is a non-empty string, so blanks fall back cleanly. */
function readString(source: Record<string, unknown>, key: string): string | null {
    const value = source[key]
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

/** Reads a field only if it is a real number. Rejects NaN, Infinity and numeric strings. */
function readMinorUnits(source: Record<string, unknown>, key: string): number | null {
    const value = source[key]
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * Turns one unknown payload entry into a Course, or null if it cannot be shown.
 * A card needs a name and at least one price; everything else has a safe default.
 */
function toCourse(value: unknown): Course | null {
    if (typeof value !== "object" || value === null) return null
    const source = value as Record<string, unknown>

    const courseName = readString(source, "courseName")
    const pricePaise = readMinorUnits(source, "pricePaise")
    const priceUsdCents = readMinorUnits(source, "priceUsdCents")

    if (courseName === null) return null
    if (pricePaise === null && priceUsdCents === null) return null

    return {
        courseName,
        courseCode: readString(source, "courseCode") ?? courseName,
        description: readString(source, "description") ?? "",
        mainCategory: readString(source, "mainCategory") ?? "",
        pricePaise,
        priceUsdCents,
        refundable: source.refundable === true,
    }
}

/**
 * The API is not ours, so nothing about the payload is assumed. A non-array, a
 * null entry or a course missing its price is dropped rather than crashing the
 * page. Duplicates are removed because the grid keys on course code.
 */
function normalizeCourses(payload: unknown): Course[] {
    if (!Array.isArray(payload)) return []

    const seen = new Set<string>()
    const courses: Course[] = []

    for (const entry of payload) {
        const course = toCourse(entry)
        if (course === null || seen.has(course.courseCode)) continue
        seen.add(course.courseCode)
        courses.push(course)
    }

    return courses
}

/**
 * Resolves which currency to price in. A failed lookup and an unrecognised code
 * are treated the same way: use the designer's default and admit that we did.
 */
function resolveCountry(
    payload: unknown,
    fallback: CountryCode
): { country: CountryCode; usedFallback: boolean } {
    if (typeof payload === "object" && payload !== null) {
        const code = (payload as { country_code?: unknown }).country_code
        if (code === "IN" || code === "US") return { country: code, usedFallback: false }
    }
    return { country: fallback, usedFallback: true }
}

function currencyLabel(country: CountryCode): string {
    return country === "IN" ? "Indian rupees" : "US dollars"
}

// ---------------------------------------------------------------------------
// Networking
// ---------------------------------------------------------------------------

/** Resolves after `ms`, or rejects immediately if the request is cancelled. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms)
        signal.addEventListener(
            "abort",
            () => {
                clearTimeout(timer)
                reject(signal.reason)
            },
            { once: true }
        )
    })
}

/**
 * GET only. Every other method on this API returns 405, and nothing here writes,
 * so the method is pinned explicitly rather than left to fetch's default.
 */
async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
    const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal,
    })
    if (!response.ok) throw new HttpError(response.status)
    return response.json()
}

/**
 * Retries every failure, including 404. Normally a 404 means "gone, stop asking",
 * but this API injects 404s and 500s at random on endpoints that do exist, so
 * treating one as permanent would throw away a request that works on retry.
 */
async function fetchWithRetry(url: string, signal: AbortSignal): Promise<unknown> {
    let lastError: unknown

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
        try {
            return await fetchJson(url, signal)
        } catch (error) {
            if (signal.aborted) throw error
            lastError = error

            const delay = RETRY_DELAYS_MS[attempt]
            if (delay === undefined) break
            await sleep(delay, signal)
        }
    }

    throw lastError
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Stable id so duplicate instances can find and drop each other's copies. */
const STYLE_ELEMENT_ID = "skillpath-courses-grid-styles"

/**
 * The stylesheet is rendered inside the component so the static HTML Framer
 * publishes already carries it - injecting from an effect would flash unstyled
 * skeletons on first paint. The cost is one copy per instance, so after mount
 * every copy beyond the first is removed. The rules are identical, so whichever
 * one survives is the same stylesheet.
 */
function useDedupedStyles(ref: RefObject<HTMLElement | null>): void {
    useEffect(() => {
        if (typeof document === "undefined") return
        const own = ref.current?.querySelector(`style#${STYLE_ELEMENT_ID}`)
        if (!own) return

        const all = document.querySelectorAll(`style#${STYLE_ELEMENT_ID}`)
        if (all.length > 1 && all[0] !== own) own.remove()
    }, [ref])
}

const INITIAL_STATE: CoursesState = {
    status: "loading",
    courses: [],
    country: "IN",
    usedFallbackCurrency: false,
    failureKind: null,
}

/**
 * Owns every request the component makes. Returns one state object plus the two
 * recovery actions the UI can offer.
 */
function useCourseData(fallbackCurrency: CountryCode, enabled: boolean) {
    const [state, setState] = useState<CoursesState>(INITIAL_STATE)
    const [isSlow, setIsSlow] = useState(false)
    const [isRetryingCountry, setIsRetryingCountry] = useState(false)
    const [reloadToken, setReloadToken] = useState(0)

    const reload = useCallback(() => setReloadToken(token => token + 1), [])

    useEffect(() => {
        if (!enabled) return

        // `disposed` is set only by the cleanup, so an unmount stays silent while
        // a timeout - which also aborts - is still allowed to render its error.
        let disposed = false
        let timedOut = false

        const controller = new AbortController()
        const slowTimer = setTimeout(() => {
            if (!disposed) setIsSlow(true)
        }, SLOW_NOTICE_MS)
        const timeoutTimer = setTimeout(() => {
            timedOut = true
            controller.abort()
        }, REQUEST_TIMEOUT_MS)

        setState(current => ({ ...INITIAL_STATE, country: current.country }))
        setIsSlow(false)

        async function load() {
            // Both endpoints in parallel. allSettled never rejects, so a failed
            // country lookup can never take the course list down with it.
            const [coursesResult, countryResult] = await Promise.allSettled([
                fetchWithRetry(COURSES_URL, controller.signal),
                fetchWithRetry(COUNTRY_URL, controller.signal),
            ])

            clearTimeout(slowTimer)
            clearTimeout(timeoutTimer)
            if (disposed) return

            const { country, usedFallback } = resolveCountry(
                countryResult.status === "fulfilled" ? countryResult.value : undefined,
                fallbackCurrency
            )

            if (coursesResult.status === "rejected") {
                // Logged for a developer; the visitor never sees a status code.
                console.error("[Skillpath] course request failed", coursesResult.reason)
                setState({
                    status: "error",
                    courses: [],
                    country,
                    usedFallbackCurrency: usedFallback,
                    failureKind: timedOut ? "timeout" : "request",
                })
                return
            }

            const courses = normalizeCourses(coursesResult.value)
            setState({
                // A payload whose entries were all unusable is functionally empty,
                // not broken, so it gets the empty state rather than the error one.
                status: courses.length === 0 ? "empty" : "ready",
                courses,
                country,
                usedFallbackCurrency: usedFallback,
                failureKind: null,
            })
        }

        void load()

        return () => {
            disposed = true
            clearTimeout(slowTimer)
            clearTimeout(timeoutTimer)
            controller.abort()
        }
    }, [fallbackCurrency, enabled, reloadToken])

    /**
     * The country retry runs outside the main effect, so it needs its own
     * cancellation. Without this it was the one async path that could abort
     * nothing and setState after unmount.
     */
    const countryRetryRef = useRef<AbortController | null>(null)
    const unmountedRef = useRef(false)

    useEffect(() => {
        unmountedRef.current = false
        return () => {
            unmountedRef.current = true
            countryRetryRef.current?.abort()
        }
    }, [])

    /**
     * Re-runs only the country lookup. Deliberately user-initiated: silently
     * polling in the background could swap every price from rupees to dollars
     * mid-read, which is worse than showing a stale currency with a notice.
     */
    const retryCountry = useCallback(async () => {
        countryRetryRef.current?.abort()
        const controller = new AbortController()
        countryRetryRef.current = controller

        setIsRetryingCountry(true)
        try {
            const payload = await fetchWithRetry(COUNTRY_URL, controller.signal)
            if (unmountedRef.current) return
            const { country, usedFallback } = resolveCountry(payload, fallbackCurrency)
            setState(current => ({ ...current, country, usedFallbackCurrency: usedFallback }))
        } catch (error) {
            if (unmountedRef.current) return
            console.error("[Skillpath] country retry failed", error)
        } finally {
            if (!unmountedRef.current) setIsRetryingCountry(false)
            if (countryRetryRef.current === controller) countryRetryRef.current = null
        }
    }, [fallbackCurrency])

    return { state, isSlow, isRetryingCountry, reload, retryCountry }
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

/**
 * Keyframes, hover, focus rings and reduced-motion cannot be expressed as inline
 * styles, so the handful of rules that need them live here. Everything else is
 * inline so it stays next to the element it applies to.
 */
const STYLE_SHEET = `
.sp-root {
  position: relative;
  width: 100%;
  box-sizing: border-box;
  /* Named explicitly so the grid matches the page around it. Framer loads this
     family for the rest of the site; the stack after it is the fallback. */
  font-family: "Plus Jakarta Sans", ui-sans-serif, system-ui, -apple-system, sans-serif;
  /* Makes this element the reference for the @container queries below, so the
     columns respond to the component's own width wherever it is placed. */
  container-type: inline-size;
}
.sp-root *, .sp-root *::before, .sp-root *::after { box-sizing: border-box; }

/*
 * Columns are CSS, not JavaScript. Measuring with ResizeObserver meant the first
 * paint always used a guessed count and then snapped to the real one, which was
 * worth 0.14 CLS on any viewport under ${DESKTOP_MIN_WIDTH}px. A container query is
 * correct on the very first paint and still measures this component's own box
 * rather than the viewport.
 * minmax(0, 1fr) rather than 1fr so a long unbroken word cannot widen a column.
 */
.sp-grid {
  display: grid;
  gap: 20px;
  align-items: stretch;
  grid-template-columns: minmax(0, 1fr);
}
@container (min-width: ${TABLET_MIN_WIDTH}px) {
  .sp-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@container (min-width: ${DESKTOP_MIN_WIDTH}px) {
  .sp-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

.sp-clamp {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  /* Two lines reserved even when the text is one, so cards stay aligned. */
  min-height: 42px;
}

.sp-card {
  transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease;
  /* Requested for feel. Worth knowing: a pointer cursor on something that does
     not respond to a click is normally a usability smell. It is defensible only
     while the whole card is a hover target; if it stays non-interactive, the
     honest fix is to drop this rather than keep promising a click. */
  cursor: pointer;
}
.sp-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(15, 23, 41, 0.10);
  border-color: #D3D7E0;
}

.sp-fade { animation: sp-fade-in 180ms ease both; }
@keyframes sp-fade-in { from { opacity: 0; } to { opacity: 1; } }

.sp-shimmer {
  background: linear-gradient(90deg, #EDEFF3 25%, #F6F7F9 37%, #EDEFF3 63%);
  background-size: 400% 100%;
  animation: sp-shimmer 1.4s ease infinite;
}
@keyframes sp-shimmer { from { background-position: 100% 50%; } to { background-position: 0 50%; } }

.sp-button {
  font: inherit;
  cursor: pointer;
  border-radius: 8px;
  transition: background-color 160ms ease, border-color 160ms ease;
  /*
   * Optical centring. Plus Jakarta Sans reports ascent 21 and descent 6 per 16px,
   * so the ink centre sits (ascent - descent)/2 + (descender - capHeight)/2 below
   * the line-box centre - about 2px. Flexbox centres the box, not the letters, and
   * changing line-height does not move it, so the correction has to be padding.
   */
  padding-top: 8px;
  padding-bottom: 12px;
}
.sp-button:disabled { cursor: not-allowed; opacity: 0.6; }
.sp-button:focus-visible, .sp-link:focus-visible {
  outline: 2px solid #4F46E5;
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .sp-card, .sp-button { transition: none; }
  .sp-card:hover { transform: none; }
  .sp-fade, .sp-shimmer { animation: none; }
}
`

const COLORS = {
    text: "#0F1729",
    muted: "#565F73",
    border: "#E4E7EC",
    surface: "#FFFFFF",
    accent: "#4F46E5",
    accentSoft: "#EEF0FF",
    accentText: "#3730A3",
    successSoft: "#E7F4EC",
    successText: "#0B5F35",
    skeleton: "#EDEFF3",
} as const

const cardStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    height: "100%",
    // Shared by the skeleton and the loaded card so swapping one for the other
    // does not change the grid's height.
    minHeight: CARD_MIN_HEIGHT,
    padding: 20,
    borderRadius: 14,
    border: `1px solid ${COLORS.border}`,
    background: COLORS.surface,
}

const primaryButtonStyle: CSSProperties = {
    // Horizontal only. Vertical padding lives in .sp-button so the optical
    // centring correction there is not overridden by this inline style.
    paddingLeft: 18,
    paddingRight: 18,
    border: "none",
    background: COLORS.accent,
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: 600,
}

// ---------------------------------------------------------------------------
// Presentational pieces
// ---------------------------------------------------------------------------

function Pill({ label, tone }: { label: string; tone: "category" | "refundable" }) {
    const isCategory = tone === "category"
    return (
        <span
            style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "4px 10px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: 0.1,
                background: isCategory ? COLORS.accentSoft : COLORS.successSoft,
                color: isCategory ? COLORS.accentText : COLORS.successText,
            }}
        >
            {label}
        </span>
    )
}

function CourseCard({ course, country }: { course: Course; country: CountryCode }) {
    return (
        <article className="sp-card sp-fade" style={cardStyle}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {course.mainCategory !== "" && <Pill label={course.mainCategory} tone="category" />}
                {/* Only rendered when true - an absent badge reads as "not refundable". */}
                {course.refundable && <Pill label="Refundable" tone="refundable" />}
            </div>

            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600, lineHeight: 1.35, color: COLORS.text }}>
                {course.courseName}
            </h3>

            <p className="sp-clamp" style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: COLORS.muted }}>
                {course.description}
            </p>

            {/* marginTop:auto pins the price to the bottom so prices line up across a row. */}
            <p style={{ margin: 0, marginTop: "auto", paddingTop: 4, fontSize: 20, fontWeight: 700, color: COLORS.text }}>
                {formatPrice(course, country)}
            </p>
        </article>
    )
}

function SkeletonCard() {
    return (
        <div style={cardStyle} aria-hidden="true">
            <div className="sp-shimmer" style={{ width: 92, height: 22, borderRadius: 999 }} />
            <div className="sp-shimmer" style={{ width: "75%", height: 18, borderRadius: 6 }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 42 }}>
                <div className="sp-shimmer" style={{ width: "100%", height: 12, borderRadius: 6 }} />
                <div className="sp-shimmer" style={{ width: "85%", height: 12, borderRadius: 6 }} />
            </div>
            <div className="sp-shimmer" style={{ width: 96, height: 24, borderRadius: 6, marginTop: "auto" }} />
        </div>
    )
}

/** Shared shell for the error and empty states so they sit where the grid would. */
function StateMessage({
    title,
    body,
    actionLabel,
    onAction,
    busy,
}: {
    title: string
    body: string
    actionLabel: string
    onAction: () => void
    busy: boolean
}) {
    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 10,
                padding: "48px 24px",
                textAlign: "center",
                borderRadius: 14,
                border: `1px dashed ${COLORS.border}`,
                background: COLORS.surface,
            }}
        >
            <p style={{ margin: 0, fontSize: 16, fontWeight: 600, color: COLORS.text }}>{title}</p>
            <p style={{ margin: 0, maxWidth: 420, fontSize: 14, lineHeight: 1.55, color: COLORS.muted }}>{body}</p>
            <button
                type="button"
                className="sp-button"
                style={{ ...primaryButtonStyle, marginTop: 8 }}
                onClick={onAction}
                disabled={busy}
            >
                {busy ? "Loading..." : actionLabel}
            </button>
        </div>
    )
}

/** Sits once above the grid, never repeated per card. */
function CurrencyNotice({
    country,
    onRetry,
    busy,
}: {
    country: CountryCode
    onRetry: () => void
    busy: boolean
}) {
    return (
        <div
            style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 10,
                padding: "10px 14px",
                marginBottom: 20,
                borderRadius: 10,
                border: `1px solid ${COLORS.border}`,
                background: "#FAFBFC",
                fontSize: 13,
                color: COLORS.muted,
            }}
        >
            <span>
                We couldn&rsquo;t confirm your region, so prices are shown in {currencyLabel(country)}.
            </span>
            <button
                type="button"
                className="sp-button"
                style={{
                    // Smaller control, so it overrides .sp-button's vertical padding
                    // but keeps the same 2px optical offset between top and bottom.
                    padding: "3px 12px 7px",
                    border: `1px solid ${COLORS.border}`,
                    background: COLORS.surface,
                    color: COLORS.text,
                    fontSize: 13,
                    fontWeight: 600,
                }}
                onClick={onRetry}
                disabled={busy}
            >
                {busy ? "Checking..." : "Try again"}
            </button>
        </div>
    )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * @framerSupportedLayoutWidth any
 * @framerSupportedLayoutHeight auto
 * @framerIntrinsicWidth 1200
 * @framerIntrinsicHeight 520
 */
export default function CoursesGrid(props: CoursesGridProps) {
    const {
        heading = "Courses built to be finished",
        fallbackCurrency = "IN",
        // Kept in step with the control's defaultValue below.
        maxCourses = 24,
        style,
    } = props

    const headingId = useId()
    const rootRef = useRef<HTMLElement | null>(null)
    useDedupedStyles(rootRef)

    // Framer renders published pages statically before hydrating. Skipping the
    // fetch there means the first paint is skeletons rather than an empty box.
    const isStatic = useIsStaticRenderer()
    const { state, isSlow, isRetryingCountry, reload, retryCountry } = useCourseData(
        toCountryCode(fallbackCurrency),
        !isStatic
    )

    const limit = Math.max(1, maxCourses)
    const status: Status = isStatic ? "loading" : state.status
    const visibleCourses = state.courses.slice(0, limit)
    const hiddenCount = state.courses.length - visibleCourses.length
    const skeletonCount = Math.min(limit, DEFAULT_SKELETONS)

    return (
        <section
            ref={rootRef}
            className="sp-root"
            aria-labelledby={headingId}
            style={{ padding: 0, ...style }}
        >
            <style id={STYLE_ELEMENT_ID}>{STYLE_SHEET}</style>

            {/*
              * Ships in the static HTML, so the browser can open the TLS
              * connection while Framer's runtime is still booting instead of
              * waiting until the fetch fires after hydration.
              */}
            <link rel="preconnect" href={API_BASE} crossOrigin="anonymous" />

            <header style={{ marginBottom: 24 }}>
                <h2 id={headingId} style={{ margin: 0, fontSize: 28, fontWeight: 700, lineHeight: 1.25, color: COLORS.text }}>
                    {heading}
                </h2>
                {status === "loading" && isSlow && (
                    <p style={{ margin: "8px 0 0", fontSize: 14, color: COLORS.muted }}>
                        Still loading - the course service is waking up.
                    </p>
                )}
            </header>

            {/* Announces state changes without stealing focus. */}
            <div
                aria-live="polite"
                style={{
                    position: "absolute",
                    width: 1,
                    height: 1,
                    margin: -1,
                    padding: 0,
                    overflow: "hidden",
                    clip: "rect(0 0 0 0)",
                    whiteSpace: "nowrap",
                    border: 0,
                }}
            >
                {status === "loading" && "Loading courses"}
                {status === "ready" && `${visibleCourses.length} courses loaded`}
                {status === "empty" && "No courses available"}
                {status === "error" && "Courses could not be loaded"}
            </div>

            {status === "ready" && state.usedFallbackCurrency && (
                <CurrencyNotice country={state.country} onRetry={retryCountry} busy={isRetryingCountry} />
            )}

            {status === "loading" && (
                <div className="sp-grid" aria-busy="true">
                    {Array.from({ length: skeletonCount }, (_, index) => (
                        <SkeletonCard key={index} />
                    ))}
                </div>
            )}

            {status === "error" && (
                <StateMessage
                    title={
                        state.failureKind === "timeout"
                            ? "This is taking longer than expected"
                            : "We couldn't load the courses"
                    }
                    body={
                        state.failureKind === "timeout"
                            ? "The course service didn't respond in time. It may still be starting up - give it a moment and try again."
                            : "Something went wrong reaching the course service. Your connection is fine on our end, so a retry usually works."
                    }
                    actionLabel="Retry"
                    onAction={reload}
                    busy={false}
                />
            )}

            {status === "empty" && (
                <StateMessage
                    title="No courses to show yet"
                    body="The catalogue came back empty. New courses are added regularly, so it's worth checking again shortly."
                    actionLabel="Refresh"
                    onAction={reload}
                    busy={false}
                />
            )}

            {status === "ready" && (
                <>
                    <div className="sp-grid">
                        {visibleCourses.map(course => (
                            <CourseCard key={course.courseCode} course={course} country={state.country} />
                        ))}
                    </div>
                    {/* Never drop courses silently just because the control is low. */}
                    {hiddenCount > 0 && (
                        <p style={{ margin: "20px 0 0", fontSize: 14, color: COLORS.muted, textAlign: "center" }}>
                            Showing {visibleCourses.length} of {state.courses.length} courses.
                        </p>
                    )}
                </>
            )}
        </section>
    )
}

addPropertyControls(CoursesGrid, {
    heading: {
        type: ControlType.String,
        title: "Heading",
        defaultValue: "Courses built to be finished",
    },
    fallbackCurrency: {
        type: ControlType.Enum,
        title: "Fallback currency",
        options: ["IN", "US"],
        optionTitles: ["India (INR)", "United States (USD)"],
        defaultValue: "IN",
        description: "Used only when the region lookup fails.",
    },
    maxCourses: {
        type: ControlType.Number,
        title: "Max courses",
        min: 1,
        // Headroom over the 10 the API currently returns. If it ever returns
        // more than this, the grid says "Showing 10 of 14" rather than dropping
        // the extras without telling anyone.
        max: 24,
        step: 1,
        defaultValue: 24,
        displayStepper: false,
        description: "The API returns 5 to 10 courses. Lower this to trim the grid.",
    },
})
