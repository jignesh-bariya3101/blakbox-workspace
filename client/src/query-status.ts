import { ApiRequestError } from "./api";

export type QueryStatusKind = "unauth" | "forbidden" | "notfound" | "error";

export function queryStatusKind(error: unknown): QueryStatusKind {
  if (error instanceof ApiRequestError) {
    if (error.status === 401) return "unauth";
    if (error.status === 403) return "forbidden";
    if (error.status === 404) return "notfound";
  }
  return "error";
}

export function queryErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function hasSession<T>(me: { isSuccess: boolean; data?: T }): me is { isSuccess: true; data: T } {
  return me.isSuccess && me.data !== undefined;
}
