import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { COUNTRY_URL, COURSES_URL, threeCourses } from "./fixtures"

/** Default happy path. Individual tests override with `server.use(...)`. */
export const server = setupServer(
    http.get(COURSES_URL, () => HttpResponse.json(threeCourses)),
    http.get(COUNTRY_URL, () => HttpResponse.json({ country_code: "IN" }))
)

// --- handler builders -------------------------------------------------------

/** Whatever HttpResponse.json accepts - derived so it tracks the msw version. */
type JsonPayload = Parameters<typeof HttpResponse.json>[0]

export function coursesRespond(body: JsonPayload) {
    return http.get(COURSES_URL, () => HttpResponse.json(body))
}

export function coursesFail(status: number) {
    return http.get(COURSES_URL, () => new HttpResponse(null, { status }))
}

/** Fails the first `times` requests, then serves `body`. Exercises the retry path. */
export function coursesFailThenSucceed(times: number, body: JsonPayload) {
    let calls = 0
    return http.get(COURSES_URL, () => {
        calls += 1
        if (calls <= times) return new HttpResponse(null, { status: 500 })
        return HttpResponse.json(body)
    })
}

/** Never settles, so the component's own timeout is what ends the request. */
export function coursesHang() {
    return http.get(COURSES_URL, () => new Promise<never>(() => {}))
}

export function countryRespond(code: unknown) {
    return http.get(COUNTRY_URL, () => HttpResponse.json({ country_code: code }))
}

export function countryFail(status = 500) {
    return http.get(COUNTRY_URL, () => new HttpResponse(null, { status }))
}

export function countryFailThenSucceed(times: number, code: string) {
    let calls = 0
    return http.get(COUNTRY_URL, () => {
        calls += 1
        if (calls <= times) return new HttpResponse(null, { status: 500 })
        return HttpResponse.json({ country_code: code })
    })
}
