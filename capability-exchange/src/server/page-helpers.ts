import "server-only";
import { notFound, redirect } from "next/navigation";
import { isAppError } from "./errors";

/** In pages, a service's not-found or forbidden error becomes the standard not-found page. */
export async function notFoundOnAppError<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isAppError(e)) {
      if (e.code === "unauthenticated") redirect("/sign-in");
      if (e.code === "not_found" || e.code === "forbidden") notFound();
    }
    throw e;
  }
}
