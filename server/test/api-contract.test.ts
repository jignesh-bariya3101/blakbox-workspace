import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES } from "../src/storage/storage.types";
import { api, startTestApp } from "./app-request";
import { prisma } from "./helpers";

async function register(app: INestApplication, email = `api-${randomUUID()}@example.com`) {
  const response = await api(app).post("/api/v1/auth/register").send({
    email,
    password: "password1",
  });
  const setCookie = response.headers["set-cookie"];
  const cookie = Array.isArray(setCookie) ? setCookie[0] : String(setCookie);
  return { email, cookie, userId: response.body.user.id as string };
}

describe("API contract", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await startTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("versions application routes under /api/v1 and keeps health unversioned", async () => {
    const version = await api(app).get("/api/v1");
    expect(version.status).toBe(200);
    expect(version.body).toEqual({ name: "blakbox", version: "1" });
    expect(version.headers["x-request-id"]).toEqual(expect.any(String));

    const health = await api(app).get("/health");
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ status: "ok" });
  });

  it("returns the documented error envelope and does not leak internals", async () => {
    const missing = await api(app).get("/api/v1/workspaces");
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe("unauthorized");
    expect(missing.body.requestId).toEqual(expect.any(String));
    expect(JSON.stringify(missing.body)).not.toMatch(/prisma|stack|passwordHash/i);
  });

  it("keeps auth and workspace payloads free of internal fields", async () => {
    const owner = await register(app);
    expect(owner.email).toBeTruthy();
    const me = await api(app).get("/api/v1/auth/me").set("Cookie", owner.cookie);
    expect(me.status).toBe(200);
    expect(Object.keys(me.body.user).sort()).toEqual(["email", "id"]);

    const created = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "Contract", deletedAt: "2099-01-01", role: "MEMBER" });
    expect(created.status).toBe(201);
    expect(created.body.workspace.role).toBe("OWNER");
    expect(created.body.workspace.deletedAt).toBeUndefined();
    expect(created.body.workspace.updatedAt).toBeUndefined();

    const listed = await api(app).get("/api/v1/workspaces").set("Cookie", owner.cookie);
    expect(listed.body.workspaces[0].deletedAt).toBeUndefined();
  });

  it("uses 400/403/404/409 for validation, permission, missing, and conflict", async () => {
    const owner = await register(app);
    const member = await register(app);
    const workspace = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "Codes" });
    const workspaceId = workspace.body.workspace.id as string;
    await prisma.workspaceMember.create({
      data: { workspaceId, userId: member.userId, role: "MEMBER" },
    });

    const invalid = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "" });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("validation_error");

    const forbidden = await api(app)
      .post(`/api/v1/workspaces/${workspaceId}/invitations`)
      .set("Cookie", member.cookie)
      .send({ email: `x-${randomUUID()}@example.com` });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe("forbidden");

    const missing = await api(app)
      .get(`/api/v1/workspaces/${randomUUID()}`)
      .set("Cookie", owner.cookie);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("not_found");

    const conflict = await api(app)
      .post(`/api/v1/workspaces/${workspaceId}/invitations`)
      .set("Cookie", owner.cookie)
      .send({ email: member.email });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("conflict");
  });

  it("ignores mass-assignment fields on PATCH and rejects oversized uploads with 413", async () => {
    const owner = await register(app);
    const workspace = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "Patch" });
    const upload = await api(app)
      .post(`/api/v1/workspaces/${workspace.body.workspace.id}/documents`)
      .set("Cookie", owner.cookie)
      .attach("file", Buffer.from("hello"), { filename: "notes.txt", contentType: "text/plain" });

    const renamed = await api(app)
      .patch(`/api/v1/documents/${upload.body.document.id}`)
      .set("Cookie", owner.cookie)
      .send({
        filename: "renamed.txt",
        storageKey: "workspaces/evil",
        workspaceId: randomUUID(),
        uploadedById: randomUUID(),
      });
    expect(renamed.status).toBe(200);
    expect(renamed.body.document.filename).toBe("renamed.txt");
    expect(renamed.body.document.storageKey).toBeUndefined();
    expect(renamed.body.document.workspaceId).toBe(workspace.body.workspace.id);

    const oversized = await api(app)
      .post(`/api/v1/workspaces/${workspace.body.workspace.id}/documents`)
      .set("Cookie", owner.cookie)
      .attach("file", Buffer.alloc(MAX_UPLOAD_BYTES + 1), {
        filename: "huge.txt",
        contentType: "text/plain",
      });
    expect(oversized.status).toBe(413);
    expect(oversized.body.error.code).toBe("payload_too_large");
    expect(oversized.body.requestId).toEqual(expect.any(String));
    expect(JSON.stringify(oversized.body)).not.toMatch(/prisma|stack/i);
  });
});
