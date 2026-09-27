import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SESSION_COOKIE_NAME } from "../src/auth/auth.constants";
import { hashToken } from "../src/common/tokens";
import { PrismaService } from "../src/prisma/prisma.service";
import { api, startTestApp } from "./app-request";

function uniqueEmail() {
  return `auth-${randomUUID()}@example.com`;
}

function sessionCookie(response: { headers: Record<string, unknown>; status: number }) {
  expect([200, 201]).toContain(response.status);
  const setCookie = response.headers["set-cookie"];
  const lines = !setCookie ? [] : Array.isArray(setCookie) ? setCookie.map(String) : [String(setCookie)];
  const serialized = lines.join(";");
  expect(serialized.toLowerCase()).toContain("httponly");
  expect(serialized.toLowerCase()).toContain("samesite=lax");
  const match = serialized.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
  expect(match?.[1]).toBeTruthy();
  return `${SESSION_COOKIE_NAME}=${match?.[1]}`;
}

describe("authentication", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await startTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it("registers a valid user and sets a session cookie", async () => {
    const email = uniqueEmail();
    const response = await api(app).post("/api/v1/auth/register").send({
      email,
      password: "password1",
    });

    expect(response.status).toBe(201);
    expect(response.body.user.email).toBe(email);
    expect(response.body.user.passwordHash).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toMatch(/password/i);
    expect(sessionCookie(response)).toContain(SESSION_COOKIE_NAME);
  });

  it("does not reveal that an email is already registered", async () => {
    const email = uniqueEmail();
    await api(app).post("/api/v1/auth/register").send({ email, password: "password1" });

    const response = await api(app).post("/api/v1/auth/register").send({
      email,
      password: "password1",
    });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe("Unable to create an account");
    expect(response.body.error.message.toLowerCase()).not.toContain("exists");
    expect(response.body.error.message.toLowerCase()).not.toContain(email);
  });

  it("rejects invalid registration input", async () => {
    const response = await api(app)
      .post("/api/v1/auth/register")
      .send({ email: "not-an-email", password: "short" });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("validation_error");
  });

  it("logs in with valid credentials", async () => {
    const email = uniqueEmail();
    await api(app).post("/api/v1/auth/register").send({ email, password: "password1" });

    const response = await api(app)
      .post("/api/v1/auth/login")
      .send({ email: email.toUpperCase(), password: "password1" });

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe(email);
    sessionCookie(response);
  });

  it("uses the same error for unknown email and bad password", async () => {
    const email = uniqueEmail();
    await api(app).post("/api/v1/auth/register").send({ email, password: "password1" });

    const unknown = await api(app)
      .post("/api/v1/auth/login")
      .send({ email: uniqueEmail(), password: "password1" });
    const badPassword = await api(app)
      .post("/api/v1/auth/login")
      .send({ email, password: "wrong-password" });

    expect(unknown.status).toBe(401);
    expect(badPassword.status).toBe(401);
    expect(unknown.body.error.message).toBe(badPassword.body.error.message);
    expect(unknown.body.error.message).toBe("Invalid email or password");
  });

  it("rejects a protected route without a session", async () => {
    const response = await api(app).get("/api/v1/auth/me");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("unauthorized");
  });

  it("returns the current user for a valid session", async () => {
    const email = uniqueEmail();
    const registered = await api(app)
      .post("/api/v1/auth/register")
      .send({ email, password: "password1" });

    const response = await api(app)
      .get("/api/v1/auth/me")
      .set("Cookie", sessionCookie(registered));

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe(email);
  });

  it("revokes the current session on logout", async () => {
    const registered = await api(app)
      .post("/api/v1/auth/register")
      .send({ email: uniqueEmail(), password: "password1" });
    const cookie = sessionCookie(registered);

    const logout = await api(app).post("/api/v1/auth/logout").set("Cookie", cookie);
    expect(logout.status).toBe(204);

    const me = await api(app).get("/api/v1/auth/me").set("Cookie", cookie);
    expect(me.status).toBe(401);
  });

  it("accepts logout with an empty JSON body", async () => {
    const registered = await api(app)
      .post("/api/v1/auth/register")
      .send({ email: uniqueEmail(), password: "password1" });
    const cookie = sessionCookie(registered);

    const logout = await api(app)
      .post("/api/v1/auth/logout")
      .set("Cookie", cookie)
      .set("Content-Type", "application/json")
      .send("");
    expect(logout.status).toBe(204);
  });

  it("rejects a revoked or unknown session token", async () => {
    const registered = await api(app)
      .post("/api/v1/auth/register")
      .send({ email: uniqueEmail(), password: "password1" });
    const cookie = sessionCookie(registered);
    const rawToken = cookie.split("=")[1] ?? "";

    await prisma.session.update({
      where: { tokenHash: hashToken(rawToken) },
      data: { revokedAt: new Date() },
    });

    const revoked = await api(app).get("/api/v1/auth/me").set("Cookie", cookie);
    expect(revoked.status).toBe(401);

    const forged = await api(app)
      .get("/api/v1/auth/me")
      .set("Cookie", `${SESSION_COOKIE_NAME}=not-a-real-token`);
    expect(forged.status).toBe(401);
  });

  it("stores a password hash and a hashed session token", async () => {
    const email = uniqueEmail();
    const password = "password1";
    const registered = await api(app).post("/api/v1/auth/register").send({ email, password });
    const rawToken = sessionCookie(registered).split("=")[1] ?? "";

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.passwordHash).not.toBe(password);
    expect(user.passwordHash.startsWith("$argon2")).toBe(true);

    const session = await prisma.session.findUniqueOrThrow({
      where: { tokenHash: hashToken(rawToken) },
    });
    expect(session.tokenHash).not.toBe(rawToken);
  });
});
