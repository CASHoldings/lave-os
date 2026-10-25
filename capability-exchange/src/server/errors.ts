/** Errors the service layer raises. Server actions turn these into user-facing messages. */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: "not_found" | "forbidden" | "unauthenticated" | "validation" | "conflict" | "rate_limited" | "unavailable",
    public readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
  }
}

/** Use for anything the viewer may not see: it is indistinguishable from a record that does not exist. */
export const notFound = (what = "That page") => new AppError(`${what} could not be found.`, "not_found");
export const forbidden = (message = "You do not have permission to do that.") => new AppError(message, "forbidden");
export const unauthenticated = () => new AppError("Please sign in to continue.", "unauthenticated");
export const conflict = (message: string) => new AppError(message, "conflict");
export const rateLimited = (message: string) => new AppError(message, "rate_limited");
export const unavailable = (message: string) => new AppError(message, "unavailable");

export function validationError(fieldErrors: Record<string, string>, message = "Please check the highlighted fields.") {
  return new AppError(message, "validation", fieldErrors);
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
