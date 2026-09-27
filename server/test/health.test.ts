import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, startTestApp } from "./app-request";

describe("foundation http", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await startTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns liveness on /health with a request id", async () => {
    const response = await api(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
    expect(response.headers["x-request-id"]).toEqual(expect.any(String));
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
  });

  it("honors an incoming request id", async () => {
    const response = await api(app).get("/health").set("x-request-id", "req-test-1");
    expect(response.headers["x-request-id"]).toBe("req-test-1");
    expect(response.body).toEqual({ status: "ok" });
  });

  it("exposes the API version prefix", async () => {
    const response = await api(app).get("/api/v1");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ name: "blakbox", version: "1" });
  });

  it("returns a safe 404 error body", async () => {
    const response = await api(app).get("/does-not-exist");
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBeDefined();
    expect(response.body.requestId).toEqual(expect.any(String));
    expect(JSON.stringify(response.body)).not.toMatch(/prisma|stack/i);
  });

  it("reports database readiness", async () => {
    const response = await api(app).get("/ready");
    expect(response.body.checks.database).toBe(true);
    expect([200, 503]).toContain(response.status);
  });
});
