/**
 * Test-only stand-in for the `framer` module.
 *
 * `framer` is provided by the Framer runtime and cannot be installed from npm, so
 * vitest aliases it here. This exists purely so the tests can import the real
 * `framer/CoursesGrid.tsx` instead of a duplicated copy of its logic.
 *
 * The shapes below mirror only what the component actually uses.
 */

/** Records what the component registered, so a test can assert on the controls. */
export const registeredControls = new Map<unknown, unknown>()

export function addPropertyControls(component: unknown, controls: unknown): void {
    registeredControls.set(component, controls)
}

export const ControlType = {
    String: "string",
    Number: "number",
    Boolean: "boolean",
    Enum: "enum",
    Color: "color",
} as const

/**
 * In Framer this returns true while rendering a static canvas thumbnail. Tests
 * exercise the live path, so it is always false here.
 */
export function useIsStaticRenderer(): boolean {
    return false
}
