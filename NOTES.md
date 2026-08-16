# Note

**Where I got stuck.** The 404s. Retrying one feels wrong, since it normally
means stop asking. I retry anyway because the brief says the failures are
injected, so a 404 here isn't real. Three attempts with backoff takes a ~33%
failure rate to roughly 4%.

**The judgement call.** When the country lookup fails but courses load, I render
every card in a designer-set fallback currency, with one notice and a Try again
button. I rejected a silent background retry: flipping every price from rupees to
dollars mid-read is worse than a stale currency someone has been told about.

**What I'd fix with two more days.** The host cold-starts, so I show a "waking up"
line at 6s and give up at 15s - caching the last good response would beat both.
My grid tests assert breakpoint logic, not real layout, because jsdom does no
layout; I checked layout in a browser instead. Framer emits no `lang` on `<html>`,
costing an accessibility point I could not reach from a code component.

**AI.** Claude Code wrote the first fetch and the card markup. I rewrote the state
into one status discriminant and added the abort, timeout and retry handling.
