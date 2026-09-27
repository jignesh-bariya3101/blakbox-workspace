import { describe, expect, it } from "vitest";
import { isAllowedCorsOrigin, loadConfig } from "../src/config";

const valid = {
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/blakbox_dev",
  MINIO_ENDPOINT: "http://127.0.0.1:9000",
  MINIO_ACCESS_KEY: "minioadmin",
  MINIO_SECRET_KEY: "minioadmin",
  MINIO_BUCKET: "blakbox",
};

describe("loadConfig", () => {
  it("fails fast when required values are missing", () => {
    expect(() => loadConfig({})).toThrow(/Invalid configuration/);
  });

  it("accepts a valid environment", () => {
    const config = loadConfig(valid);
    expect(config.PORT).toBe(3000);
    expect(config.MINIO_BUCKET).toBe("blakbox");
    expect(config.TRUST_PROXY).toBe("false");
    expect(config.cookieSecure).toBe(false);
    expect(config.corsOrigins).toContain("http://127.0.0.1:5173");
    expect(isAllowedCorsOrigin("http://127.0.0.1:51753", config)).toBe(true);
    expect(isAllowedCorsOrigin("https://evil.example", config)).toBe(false);
  });

  it("does not allow random loopback ports in production", () => {
    const config = loadConfig({ ...valid, NODE_ENV: "production", COOKIE_SECURE: "false" });
    expect(isAllowedCorsOrigin("http://127.0.0.1:5173", config)).toBe(true);
    expect(isAllowedCorsOrigin("http://127.0.0.1:51753", config)).toBe(false);
  });

  it("defaults Secure cookies in production unless COOKIE_SECURE overrides", () => {
    expect(loadConfig({ ...valid, NODE_ENV: "production" }).cookieSecure).toBe(true);
    expect(loadConfig({ ...valid, NODE_ENV: "production", COOKIE_SECURE: "false" }).cookieSecure).toBe(
      false,
    );
  });
});
