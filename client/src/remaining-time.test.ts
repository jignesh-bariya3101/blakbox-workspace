import { describe, expect, it } from "vitest";
import { formatRemaining } from "./remaining-time";

describe("formatRemaining", () => {
  it("counts down from an expiry timestamp", () => {
    const now = Date.parse("2026-09-27T12:00:00.000Z");
    expect(formatRemaining("2026-09-27T12:00:09.000Z", now)).toBe("9s left");
    expect(formatRemaining("2026-09-27T13:10:05.000Z", now)).toBe("1h 10m 5s left");
    expect(formatRemaining("2026-09-29T14:00:00.000Z", now)).toBe("2d 2h 0m left");
  });

  it("marks the past as expired", () => {
    expect(formatRemaining("2020-01-01T00:00:00.000Z", Date.parse("2026-01-01T00:00:00.000Z"))).toBe(
      "Expired",
    );
  });
});
