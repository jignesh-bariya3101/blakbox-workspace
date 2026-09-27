import { describe, expect, it } from "vitest";
import { ApiRequestError } from "./api";
import { hasSession, queryErrorMessage, queryStatusKind } from "./query-status";

describe("query status", () => {
  it("maps API status codes to the pages the UI should show", () => {
    expect(queryStatusKind(new ApiRequestError(401, "unauthorized", "no"))).toBe("unauth");
    expect(queryStatusKind(new ApiRequestError(403, "forbidden", "no"))).toBe("forbidden");
    expect(queryStatusKind(new ApiRequestError(404, "not_found", "no"))).toBe("notfound");
    expect(queryStatusKind(new ApiRequestError(500, "internal_error", "no"))).toBe("error");
    expect(queryStatusKind(new Error("network"))).toBe("error");
  });

  it("does not treat leftover query data as a live session after an error", () => {
    expect(hasSession({ isSuccess: false, data: { user: { id: "1", email: "a@b.c" } } })).toBe(false);
    expect(hasSession({ isSuccess: true, data: { user: { id: "1", email: "a@b.c" } } })).toBe(true);
  });

  it("prefers the API error message when one exists", () => {
    expect(queryErrorMessage(new ApiRequestError(400, "validation_error", "Invalid request"), "x")).toBe(
      "Invalid request",
    );
    expect(queryErrorMessage({}, "Could not load")).toBe("Could not load");
  });
});
