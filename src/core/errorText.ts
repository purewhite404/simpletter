/** What to show the user for something thrown (the Rust side's errors are Japanese messages already). */
export const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err))
