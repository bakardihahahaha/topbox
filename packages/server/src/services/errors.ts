/** A deliberate, user-facing rejection — main.ts's error handler sends `{ error: code, message }`
 * with this status. Anything that is NOT an HttpError (and not a translated rate limit) is a bug
 * and goes out as a plain 500. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, "NOT_FOUND", `${what} not found.`);
export const conflict = (code: string, message: string) => new HttpError(409, code, message);
export const badRequest = (message: string) => new HttpError(400, "INVALID_REQUEST", message);
export const forbidden = (message = "Not allowed.") => new HttpError(403, "FORBIDDEN", message);
