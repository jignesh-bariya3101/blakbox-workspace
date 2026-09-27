import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MemoryStorageProvider } from "../src/storage/memory.storage";
import { api, startTestApp } from "./app-request";
import { prisma } from "./helpers";

async function register(app: INestApplication) {
  const email = `docs-${randomUUID()}@example.com`;
  const response = await api(app).post("/api/v1/auth/register").send({
    email,
    password: "password1",
  });
  const setCookie = response.headers["set-cookie"];
  const cookie = Array.isArray(setCookie) ? setCookie[0] : String(setCookie);
  return { cookie, userId: response.body.user.id as string };
}

async function uploadText(
  app: INestApplication,
  cookie: string,
  workspaceId: string,
  filename: string,
  body = "hello",
) {
  return api(app)
    .post(`/api/v1/workspaces/${workspaceId}/documents`)
    .set("Cookie", cookie)
    .attach("file", Buffer.from(body), { filename, contentType: "text/plain" });
}

describe("documents", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await startTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("uploads metadata without exposing storage internals", async () => {
    const owner = await register(app);
    const workspace = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "Docs" });

    const upload = await uploadText(app, owner.cookie, workspace.body.workspace.id, "notes.txt");
    expect(upload.status).toBe(201);
    expect(upload.body.document.filename).toBe("notes.txt");
    expect(upload.body.document.storageKey).toBeUndefined();
    expect(upload.body.document.status).toBeUndefined();
    expect(JSON.stringify(upload.body)).not.toMatch(/workspaces\//);
  });

  it("lists only ready documents and paginates", async () => {
    const owner = await register(app);
    const workspace = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "Pages" });
    const workspaceId = workspace.body.workspace.id as string;

    await prisma.document.create({
      data: {
        workspaceId,
        uploadedById: owner.userId,
        filename: "pending.txt",
        storageKey: `pending-${randomUUID()}`,
        byteSize: 4,
        mimeType: "text/plain",
        status: "pending",
      },
    });

    await uploadText(app, owner.cookie, workspaceId, "a.txt", "a");
    await uploadText(app, owner.cookie, workspaceId, "b.txt", "b");
    await uploadText(app, owner.cookie, workspaceId, "c.txt", "c");

    const first = await api(app)
      .get(`/api/v1/workspaces/${workspaceId}/documents`)
      .query({ limit: 2 })
      .set("Cookie", owner.cookie);
    expect(first.status).toBe(200);
    expect(first.body.documents).toHaveLength(2);
    expect(first.body.documents.map((doc: { filename: string }) => doc.filename)).not.toContain(
      "pending.txt",
    );
    expect(first.body.nextCursor).toEqual(expect.any(String));

    const second = await api(app)
      .get(`/api/v1/workspaces/${workspaceId}/documents`)
      .query({ limit: 2, cursor: first.body.nextCursor })
      .set("Cookie", owner.cookie);
    expect(second.body.documents).toHaveLength(1);
    expect(second.body.nextCursor).toBeNull();
  });

  it("returns document details for members", async () => {
    const owner = await register(app);
    const workspace = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "Detail" });
    const upload = await uploadText(app, owner.cookie, workspace.body.workspace.id, "readme.txt");

    const detail = await api(app)
      .get(`/api/v1/documents/${upload.body.document.id}`)
      .set("Cookie", owner.cookie);
    expect(detail.status).toBe(200);
    expect(detail.body.document.filename).toBe("readme.txt");
    expect(detail.body.document.storageKey).toBeUndefined();
  });

  it("downloads the stored bytes", async () => {
    const owner = await register(app);
    const workspace = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "Bytes" });
    const upload = await uploadText(
      app,
      owner.cookie,
      workspace.body.workspace.id,
      "data.txt",
      "payload",
    );

    const download = await api(app)
      .get(`/api/v1/documents/${upload.body.document.id}/download`)
      .set("Cookie", owner.cookie)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    expect(download.status).toBe(200);
    expect(download.body.toString()).toBe("payload");
  });

  it("renames the display filename without changing the object key", async () => {
    const owner = await register(app);
    const workspace = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "Rename" });
    const upload = await uploadText(app, owner.cookie, workspace.body.workspace.id, "old.txt");
    const before = await prisma.document.findUnique({
      where: { id: upload.body.document.id },
    });

    const renamed = await api(app)
      .patch(`/api/v1/documents/${upload.body.document.id}`)
      .set("Cookie", owner.cookie)
      .send({ filename: "new-name.txt" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.document.filename).toBe("new-name.txt");

    const after = await prisma.document.findUnique({
      where: { id: upload.body.document.id },
    });
    expect(after?.storageKey).toBe(before?.storageKey);
  });

  it("soft-deletes a document, hides it, and revokes share links", async () => {
    const owner = await register(app);
    const workspace = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "Gone" });
    const upload = await uploadText(app, owner.cookie, workspace.body.workspace.id, "gone.txt");
    const share = await api(app)
      .post(`/api/v1/documents/${upload.body.document.id}/share-links`)
      .set("Cookie", owner.cookie);
    expect(share.status).toBe(201);

    const removed = await api(app)
      .delete(`/api/v1/documents/${upload.body.document.id}`)
      .set("Cookie", owner.cookie);
    expect(removed.status).toBe(204);

    const detail = await api(app)
      .get(`/api/v1/documents/${upload.body.document.id}`)
      .set("Cookie", owner.cookie);
    const download = await api(app)
      .get(`/api/v1/documents/${upload.body.document.id}/download`)
      .set("Cookie", owner.cookie);
    const list = await api(app)
      .get(`/api/v1/workspaces/${workspace.body.workspace.id}/documents`)
      .set("Cookie", owner.cookie);

    expect(detail.status).toBe(404);
    expect(download.status).toBe(404);
    expect(list.body.documents).toHaveLength(0);

    const row = await prisma.document.findUnique({ where: { id: upload.body.document.id } });
    expect(row?.deletedAt).not.toBeNull();
    expect(row?.status).toBe("ready");
    const link = await prisma.shareLink.findUnique({ where: { id: share.body.shareLink.id } });
    expect(link?.revokedAt).not.toBeNull();
  });

  it("returns 404 for unauthorized and cross-workspace document access", async () => {
    const outsider = await register(app);
    const owner = await register(app);
    const workspace = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "Hidden" });
    const upload = await uploadText(app, owner.cookie, workspace.body.workspace.id, "hidden.txt");

    const list = await api(app)
      .get(`/api/v1/workspaces/${workspace.body.workspace.id}/documents`)
      .set("Cookie", outsider.cookie);
    const get = await api(app)
      .get(`/api/v1/documents/${upload.body.document.id}`)
      .set("Cookie", outsider.cookie);
    const download = await api(app)
      .get(`/api/v1/documents/${upload.body.document.id}/download`)
      .set("Cookie", outsider.cookie);
    const rename = await api(app)
      .patch(`/api/v1/documents/${upload.body.document.id}`)
      .set("Cookie", outsider.cookie)
      .send({ filename: "stolen.txt" });

    expect(list.status).toBe(404);
    expect(get.status).toBe(404);
    expect(download.status).toBe(404);
    expect(rename.status).toBe(404);
  });

  it("returns 403 when a member renames someone else's document", async () => {
    const owner = await register(app);
    const member = await register(app);
    const workspace = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "Shared" });
    await prisma.workspaceMember.create({
      data: { workspaceId: workspace.body.workspace.id, userId: member.userId, role: "MEMBER" },
    });
    const upload = await uploadText(app, owner.cookie, workspace.body.workspace.id, "owner.txt");

    const rename = await api(app)
      .patch(`/api/v1/documents/${upload.body.document.id}`)
      .set("Cookie", member.cookie)
      .send({ filename: "mine.txt" });
    expect(rename.status).toBe(403);
  });

  it("leaves the document unlisted when storage upload fails", async () => {
    const owner = await register(app);
    const workspace = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "Fail" });
    const spy = vi
      .spyOn(MemoryStorageProvider.prototype, "upload")
      .mockRejectedValueOnce(new Error("minio down"));

    const upload = await uploadText(app, owner.cookie, workspace.body.workspace.id, "fail.txt");
    spy.mockRestore();

    expect(upload.status).toBe(500);
    const list = await api(app)
      .get(`/api/v1/workspaces/${workspace.body.workspace.id}/documents`)
      .set("Cookie", owner.cookie);
    expect(list.body.documents).toHaveLength(0);
    expect(
      await prisma.document.count({
        where: { workspaceId: workspace.body.workspace.id },
      }),
    ).toBe(0);
  });

  it("enqueues object cleanup when upload and the immediate delete both fail", async () => {
    const owner = await register(app);
    const workspace = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "Orphan" });
    const uploadSpy = vi
      .spyOn(MemoryStorageProvider.prototype, "upload")
      .mockRejectedValueOnce(new Error("put failed"));
    const deleteSpy = vi
      .spyOn(MemoryStorageProvider.prototype, "delete")
      .mockRejectedValueOnce(new Error("delete failed"));

    const upload = await uploadText(app, owner.cookie, workspace.body.workspace.id, "orphan.txt");
    uploadSpy.mockRestore();
    deleteSpy.mockRestore();

    expect(upload.status).toBe(500);
    expect(
      await prisma.document.count({
        where: { workspaceId: workspace.body.workspace.id },
      }),
    ).toBe(0);
    const job = await prisma.storageCleanupJob.findFirst({
      where: { workspaceId: workspace.body.workspace.id, completedAt: null },
    });
    expect(job?.objectKey).toMatch(/^workspaces\//);
    expect(job?.documentId).toBeNull();
    if (job) {
      await prisma.storageCleanupJob.update({
        where: { id: job.id },
        data: { completedAt: new Date() },
      });
    }
  });
});
