import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

const token = "A".repeat(43);

describe("safeNext", () => {
  it("allows only a same-origin invite path with an opaque token", () => {
    expect(safeNext(`next=${encodeURIComponent(`/invite/${token}`)}`)).toBe(`/invite/${token}`);
  });

  it("rejects open redirects and path traversal after login", () => {
    expect(safeNext(`next=${encodeURIComponent("https://evil.example/invite/" + token)}`)).toBe("/");
    expect(safeNext(`next=${encodeURIComponent(`/invite/${token}/../workspaces/x`)}`)).toBe("/");
    expect(safeNext(`next=${encodeURIComponent("/invite/../workspaces/x")}`)).toBe("/");
    expect(safeNext(`next=${encodeURIComponent(`/invite/${token}?extra=1`)}`)).toBe("/");
    expect(safeNext("next=/login")).toBe("/");
    expect(safeNext("")).toBe("/");
  });
});
