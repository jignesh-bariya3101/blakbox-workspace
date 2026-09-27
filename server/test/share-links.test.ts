import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { generateOpaqueToken } from "../src/common/tokens";
import { MemoryStorageProvider } from "../src/storage/memory.storage";
import { api, startTestApp } from "./app-request";
import { prisma } from "./helpers";

async function register(app: INestApplication) {
  const email = `share-${randomUUID()}@example.com`;
  const response = await api(app).post("/api/v1/auth/register").send({
    email,
    password: "password1",
  });
  const setCookie = response.headers["set-cookie"];
  const cookie = Array.isArray(setCookie) ? setCookie[0] : String(setCookie);
  return { cookie, userId: response.body.user.id as string };
}

async function uploadText(app: INestApplication, cookie: string, workspaceId: string) {
  return api(app)
    .post(`/api/v1/workspaces/${workspaceId}/documents`)
    .set("Cookie", cookie)
    .attach("file", Buffer.from("shared-bytes"), {
      filename: "shared.txt",
      contentType: "text/plain",
    });
}

function download(app: INestApplication, token: string) {
  return api(app)
    .get(`/api/v1/share/${token}/download`)
    .buffer(true)
    .parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      res.on("end", () => callback(null, Buffer.concat(chunks)));
    });
}

describe("share links", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await startTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates a hashed token and streams a valid public download", async () => {
    const owner = await register(app);
    const workspace = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "Share" });
    const upload = await uploadText(app, owner.cookie, workspace.body.workspace.id);
    const created = await api(app)
      .post(`/api/v1/documents/${upload.body.document.id}/share-links`)
      .set("Cookie", owner.cookie)
      .send({});

    expect(created.status).toBe(201);
    expect(created.body.shareLink.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.body.shareLink.tokenHash).toBeUndefined();
    expect(JSON.stringify(created.body)).not.toMatch(/storageKey|MINIO|bucket/i);

    const stored = await prisma.shareLink.findUnique({
      where: { id: created.body.shareLink.id },
    });
    expect(stored?.tokenHash).not.toBe(created.body.shareLink.token);
    expect(stored?.tokenHash).toHaveLength(64);

    const first = await download(app, created.body.shareLink.token);
    const second = await download(app, created.body.shareLink.token);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.toString()).toBe("shared-bytes");
    expect(JSON.stringify(first.headers)).not.toMatch(/storageKey|workspaces\//);

    const after = await prisma.shareLink.findUnique({
      where: { id: created.body.shareLink.id },
    });
    expect(after?.downloadCount).toBe(2);
  });

  it("returns the same public not-found for invalid, expired, revoked, and deleted documents", async () => {
    const owner = await register(app);
    const workspace = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "Dead" });
    const upload = await uploadText(app, owner.cookie, workspace.body.workspace.id);
    const created = await api(app)
      .post(`/api/v1/documents/${upload.body.document.id}/share-links`)
      .set("Cookie", owner.cookie)
      .send({});

    const invalid = await api(app).get(`/api/v1/share/${generateOpaqueToken()}/download`);
    const malformed = await api(app).get(`/api/v1/share/${randomUUID()}/download`);
    expect(invalid.status).toBe(404);
    expect(malformed.status).toBe(404);
    expect(invalid.body.error.code).toBe("not_found");
    expect(malformed.body.error.message).toBe(invalid.body.error.message);
    expect(JSON.stringify(invalid.body)).not.toMatch(created.body.shareLink.token);

    await prisma.shareLink.update({
      where: { id: created.body.shareLink.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await api(app).get(`/api/v1/share/${created.body.shareLink.token}/download`);
    expect(expired.status).toBe(404);
    expect(expired.body.error.message).toBe(invalid.body.error.message);

    const live = await api(app)
      .post(`/api/v1/documents/${upload.body.document.id}/share-links`)
      .set("Cookie", owner.cookie)
      .send({});
    await api(app)
      .delete(`/api/v1/share-links/${live.body.shareLink.id}`)
      .set("Cookie", owner.cookie);
    const revoked = await api(app).get(`/api/v1/share/${live.body.shareLink.token}/download`);
    expect(revoked.status).toBe(404);

    const doomed = await api(app)
      .post(`/api/v1/documents/${upload.body.document.id}/share-links`)
      .set("Cookie", owner.cookie)
      .send({});
    await api(app).delete(`/api/v1/documents/${upload.body.document.id}`).set("Cookie", owner.cookie);
    const deleted = await api(app).get(`/api/v1/share/${doomed.body.shareLink.token}/download`);
    expect(deleted.status).toBe(404);
  });

  it("rejects unauthorized creation and revocation", async () => {
    const outsider = await register(app);
    const owner = await register(app);
    const member = await register(app);
    const workspace = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "Authz" });
    await prisma.workspaceMember.create({
      data: { workspaceId: workspace.body.workspace.id, userId: member.userId, role: "MEMBER" },
    });
    const upload = await uploadText(app, owner.cookie, workspace.body.workspace.id);
    const created = await api(app)
      .post(`/api/v1/documents/${upload.body.document.id}/share-links`)
      .set("Cookie", owner.cookie)
      .send({});

    const createDenied = await api(app)
      .post(`/api/v1/documents/${upload.body.document.id}/share-links`)
      .set("Cookie", outsider.cookie)
      .send({});
    const revokeDenied = await api(app)
      .delete(`/api/v1/share-links/${created.body.shareLink.id}`)
      .set("Cookie", outsider.cookie);
    const memberRevoke = await api(app)
      .delete(`/api/v1/share-links/${created.body.shareLink.id}`)
      .set("Cookie", member.cookie);

    expect(createDenied.status).toBe(404);
    expect(revokeDenied.status).toBe(404);
    expect(memberRevoke.status).toBe(403);
  });

  it("fails share links when the workspace is deleted", async () => {
    const owner = await register(app);
    const workspace = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "Closed" });
    const upload = await uploadText(app, owner.cookie, workspace.body.workspace.id);
    const created = await api(app)
      .post(`/api/v1/documents/${upload.body.document.id}/share-links`)
      .set("Cookie", owner.cookie)
      .send({});

    await prisma.workspace.update({
      where: { id: workspace.body.workspace.id },
      data: { deletedAt: new Date() },
    });

    const response = await api(app).get(`/api/v1/share/${created.body.shareLink.token}/download`);
    expect(response.status).toBe(404);
  });

  it("does not increment download count when the object cannot be streamed", async () => {
    const owner = await register(app);
    const workspace = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "Count" });
    const upload = await uploadText(app, owner.cookie, workspace.body.workspace.id);
    const created = await api(app)
      .post(`/api/v1/documents/${upload.body.document.id}/share-links`)
      .set("Cookie", owner.cookie)
      .send({});

    const spy = vi
      .spyOn(MemoryStorageProvider.prototype, "download")
      .mockRejectedValueOnce(new Error("timeout"));
    const failed = await api(app).get(`/api/v1/share/${created.body.shareLink.token}/download`);
    spy.mockRestore();

    expect(failed.status).toBe(500);
    const row = await prisma.shareLink.findUnique({ where: { id: created.body.shareLink.id } });
    expect(row?.downloadCount).toBe(0);
  });
});
