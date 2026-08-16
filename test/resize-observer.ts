/**
 * jsdom has no ResizeObserver, and the component measures its own box to decide
 * the column count. This stub installs one and lets a test drive the width.
 */

type Callback = (entries: Array<{ contentRect: { width: number } }>) => void

const observers = new Set<Callback>()

class StubResizeObserver {
    private callback: Callback

    constructor(callback: Callback) {
        this.callback = callback
        observers.add(callback)
    }

    observe() {
        // Real ResizeObserver fires once on observe. The component reads the width
        // from the entry, so nothing useful can be reported until a test sets one.
    }

    unobserve() {}

    disconnect() {
        observers.delete(this.callback)
    }
}

export function installResizeObserver() {
    globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver
}

export function resetResizeObservers() {
    observers.clear()
}

/** Reports `width` to every mounted observer, as a real resize would. */
export function setContainerWidth(width: number) {
    for (const callback of observers) {
        callback([{ contentRect: { width } }])
    }
}
