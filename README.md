# Skillpath

Landing page for a fictional learning platform, built in Framer. The courses
section is a React code component that renders live data from an API which fails
roughly one request in three on purpose.

**Live:** https://personal-airport-225722.framer.app
**Component:** [`framer/CoursesGrid.tsx`](framer/CoursesGrid.tsx) - one file, pasted into Framer verbatim
**Tests:** [`test/`](test) - 45 tests against that exact file

```bash
npm ci
npm test          # vitest
npm run typecheck # tsc --noEmit
```

---

## The currency logic

`/assignment/country-code` returns `IN` or `US` and decides which price to show.
Both price fields are **minor units**:

| Field | Raw value | Rendered |
|---|---|---|
| `pricePaise` | `199900` | `₹1,999.00` |
| `priceUsdCents` | `3999` | `$39.99` |

Formatting the raw integer would print `₹1,99,900.00` for a `₹1,999` course.
`formatPrice` divides by 100 and hands the result to a cached `Intl.NumberFormat`.
Two tests assert the correct string *and* the absence of the wrong one.

## When the country call fails but the courses load

The endpoints fail independently, so this happens often. The component renders
**every course** in the fallback currency the designer picked, shows one notice
above the grid, and offers a **Try again** button that re-runs only the country
lookup.

A silent background retry was rejected deliberately: flipping every price from
rupees to dollars while somebody is reading the page is worse than a stale
currency they have been told about. Blanking the section was also rejected - a
successful course fetch should not be thrown away because a second request failed.

## Four states

| State | Reached when | Shows |
|---|---|---|
| `loading` | first paint | skeleton cards in the real grid, so nothing shifts when data arrives |
| `error` | three attempts failed, or 15s timeout | plain message + Retry. No status codes on screen |
| `empty` | `200` with zero usable courses | its own copy + Refresh, never the error styling |
| `ready` | courses parsed | the grid |

Modelled as a single `status` discriminant rather than several booleans, so
"loading and empty" cannot be represented and the render is one exhaustive switch.

A payload whose entries are all unusable counts as **empty**, not broken. Nothing
failed; there is simply nothing to show.

## Reliability

- **Three attempts**, 400ms then 900ms backoff. Takes a ~33% per-call failure
  rate down to roughly 4%.
- **404 is retried** alongside 5xx. Normally a 404 means stop asking, but this
  API injects them on endpoints that do exist, so treating one as permanent
  throws away a request that succeeds on retry.
- **`Promise.allSettled`** so neither endpoint can take the other down.
- **One `AbortController` per run**, aborted on unmount and on manual retry. A
  15s timer aborts and produces timeout-specific copy, because the host is on a
  free tier and cold-starts.
- **`method: "GET"` pinned explicitly.** Every other method returns 405.

## Responsive

`ResizeObserver` measures the component's **own root**, not the viewport - in
Framer this can be placed inside any container, and on the canvas the "viewport"
is the editor window.

`>=1024` → 3 columns, `>=640` → 2, else 1, applied as
`repeat(n, minmax(0, 1fr))`. `minmax(0, 1fr)` rather than `1fr` stops a long
unbroken word widening a column into horizontal overflow. CSS Grid handles a
ragged final row by itself, so the varying card count needs no special case.

Verified on the published page at 1440 / 900 / 560 / 412 - 3 / 2 / 1 / 1 columns,
no horizontal overflow at any width.

## Property controls

| Control | Type | Why a designer would ask for it |
|---|---|---|
| Heading | String | Change section copy without touching code |
| Fallback currency | Enum `IN` / `US` | Makes the judgement call above configurable instead of hardcoded |
| Max courses | Number | Trim the grid for a tighter layout |

`toCountryCode` treats the currency control as untrusted input. Framer passes the
option value, but a bad value reaching the formatter lookup would throw and blank
the section, so anything unrecognised becomes `IN`.

## Card fields

Name, description clamped to two lines in CSS (the full text stays in the DOM for
screen readers and search), price, and **category** - the fourth field, because
someone scanning a grid first asks "is this my topic?". A **Refundable** badge
renders only when the field is true; its absence reads as "not refundable".

---

## How this is tested

A Framer code component must be a single file with one default export and may
only import `react` / `react-dom` / `framer` / `framer-motion`. It cannot import
tested helper modules from this repo.

Rather than split the logic and bundle it back (the panel would then read
generated output) or keep a second copy for tests (guaranteed to drift), the
tests import the shipped file directly and `framer` is aliased to a stub. Three
obstacles to that, each solved in [`test/`](test):

| File | Problem |
|---|---|
| `test/stubs/framer.ts` | The `framer` module only exists in the Framer runtime |
| `test/jsdom-node-abort.ts` | jsdom's `AbortController` is rejected by Node's fetch and MSW's interceptor, so any aborted request throws. A browser has one realm; this is a test-only artifact |
| `test/resize-observer.ts` | jsdom has no `ResizeObserver` |

`test/environment.test.tsx` covers the harness itself, so reverting the
environment fails loudly rather than obscurely.

**What the tests do not cover:** jsdom performs no layout, so the grid tests
assert the breakpoint decision, not real rendering. Actual layout was verified in
a browser against the published page.

CI runs typecheck and tests on Node 24 for every push and pull request.

## Verified output

```
Test Files  2 passed (2)
     Tests  45 passed (45)
tsc --noEmit: 0 errors
```

Observed on the live page during verification: `/assignment/course-data` returned
`404`, the retry returned `200`, and the visitor saw no error - the flaky-API
handling working against the real API rather than a mock.
