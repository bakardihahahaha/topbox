import type { z } from "zod";
import { badRequest } from "../services/errors.js";

export function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const r = schema.safeParse(value);
  if (!r.success) {
    const first = r.error.issues[0];
    throw badRequest(first ? `${first.path.join(".") || "body"}: ${first.message}` : "Invalid request.");
  }
  return r.data;
}
