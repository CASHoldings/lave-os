/**
 * Operational logging. Only event names, identifiers and error classes are logged:
 * never request bodies, profile content, emails, names, tokens or secrets.
 */
type Fields = Record<string, string | number | boolean | null | undefined>;

export function logEvent(event: string, fields: Fields = {}) {
  if (process.env.NODE_ENV === "test") return;
  console.info(JSON.stringify({ level: "info", event, ...fields, at: new Date().toISOString() }));
}

export function logError(event: string, error: unknown, fields: Fields = {}) {
  if (process.env.NODE_ENV === "test") return;
  const errorClass = error instanceof Error ? error.constructor.name : typeof error;
  // Error messages from drivers can echo values, so only the class and code are logged.
  const code = (error as { code?: unknown })?.code;
  console.error(JSON.stringify({ level: "error", event, errorClass, code: typeof code === "string" ? code : undefined, ...fields, at: new Date().toISOString() }));
}
