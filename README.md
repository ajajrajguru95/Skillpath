# Skillpath

Landing page for a fictional learning platform, built in Framer. The courses
section is a React code component that renders live data from an API which fails
roughly one request in three on purpose.

**Live:** https://personal-airport-225722.framer.app
**Component:** [`framer/CoursesGrid.tsx`](framer/CoursesGrid.tsx) - one file, pasted into Framer verbatim
**Tests:** [`test/`](test) - 49 tests against that exact file
**AI session:** [`transcript.html`](transcript.html) - the full Claude Code session, unedited

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
| `loading` | first paint | skeleton cards in the real grid, sharing the loaded card's `min-height` so nothing shifts when data arrives |
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

Columns are **CSS container queries**, keyed to the component's own width rather
than the viewport - in Framer this can be placed inside any container, and on the
canvas the "viewport" is the editor window.

`>=1024` → 3 columns, `>=640` → 2, else 1, always `minmax(0, 1fr)` so a long
unbroken word cannot widen a column into horizontal overflow. CSS Grid handles a
ragged final row by itself, so the varying card count needs no special case.

This started out as a `ResizeObserver`. That was wrong: it had to guess a column
count for the first paint and then correct it once measured, which cost **0.14
CLS** on every viewport under 1024px. A container query is right on the first
paint and needs no JavaScript at all.

Verified on the published page at 1440 / 900 / 560 / 412 - 3 / 2 / 1 / 1 columns,
no horizontal overflow at any width.

## Performance

Measured on the published page in a **logged-out browser context**, mobile
emulation, 4x CPU throttling, Slow 4G:

| Metric | Value | Threshold |
|---|---|---|
| LCP | 1555 ms | < 2500 ms |
| CLS | 0.01 | < 0.1 |
| TTFB | 20 ms | - |

Two things worth knowing when auditing this page:

- **Sign out first.** Framer injects its editor bar for a logged-in owner:
  React, ReactDOM, `react-dom-server`, and the editor chunks. A signed-in audit
  loads **273 requests**; a real visitor loads **23**. Any score taken while
  signed in is measuring Framer's editor, not this site.
- The remaining ~1.5s of render delay is Framer's own runtime bundle
  (`react`, `framer`, `motion` chunks, ~650 ms of main-thread time). On a Framer
  site that bundle is not under the component's control.

What is under its control and was fixed: the CLS above, and a `preconnect` to the
API host so the TLS handshake starts while Framer's runtime is still booting
rather than after hydration.

## Accessibility

- Lighthouse accessibility **94**.
- Contrast checked on all 15 distinct text styles - **zero failures**, lowest
  ratio 6.29:1 against a 4.5:1 requirement.
- Landmarks: `header` / `main` / `footer`, with the courses section named by its
  heading via `aria-labelledby`.
- `aria-busy` while loading, plus an `aria-live="polite"` region announcing each
  state change.
- Recovery actions are real `<button>` elements with visible `:focus-visible`
  rings; tab order follows reading order.
- `prefers-reduced-motion: reduce` disables the shimmer, the fade-in and the
  hover lift.

Two known failures, both outside the component:

- `html-has-lang` - Framer emits `<html dir="ltr">` with no `lang` and does not
  expose it to a code component or the canvas API.
- `errors-in-console` - the browser logs the API's deliberate 500s. The retry
  handles them and the visitor sees nothing, but Lighthouse still counts them, so
  Best Practices oscillates between 96 and 100 depending on whether the API fails
  during the run.

## Property controls

| Control | Type | Why a designer would ask for it |
|---|---|---|
| Heading | String | Change section copy without touching code |
| Fallback currency | Enum `IN` / `US` | Makes the judgement call above configurable instead of hardcoded |
| Max courses | Number, 1-24 | Trim the grid for a tighter layout |

The cap sits well above the 10 the API returns, and when it does truncate the
grid says "Showing 2 of 3 courses" rather than dropping the extras silently.

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

`test/environment.test.tsx` covers the harness itself, so reverting the
environment fails loudly rather than obscurely.

**What the tests do not cover:** jsdom performs no layout and does not evaluate
container queries, so the grid tests assert the CSS rules the component ships,
not the resulting layout. Actual columns were verified in a browser against the
published page at four widths.

CI runs typecheck and tests on Node 24 for every push and pull request.

## Verified output

```
Test Files  2 passed (2)
     Tests  49 passed (49)
tsc --noEmit: 0 errors
```

Observed on the live page during verification: `/assignment/course-data` returned
`404`, the retry returned `200`, and the visitor saw no error - the flaky-API
handling working against the real API rather than a mock.
