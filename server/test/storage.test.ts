import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { StorageCleanupService } from "../src/storage/cleanup.service";
import { MemoryStorageProvider } from "../src/storage/memory.storage";
import { STORAGE_PROVIDER } from "../src/storage/storage.types";
import { api, startTestApp } from "./app-request";
import { prisma } from "./helpers";

async function register(app: INestApplication) {
  const email = `storage-${randomUUID()}@example.com`;
  const response = await api(app).post("/api/v1/auth/register").send({
    email,
    password: "password1",
  });
  const setCookie = response.headers["set-cookie"];
  const cookie = Array.isArray(setCookie) ? setCookie[0] : String(setCookie);
  return { cookie, userId: response.body.user.id as string };
}

describe("storage", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await startTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("uploads bytes to object storage and streams them back", async () => {
    const owner = await register(app);
    const workspace = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "Files" });

    const upload = await api(app)
      .post(`/api/v1/workspaces/${workspace.body.workspace.id}/documents`)
      .set("Cookie", owner.cookie)
      .attach("file", Buffer.from("hello vault"), {
        filename: "notes.txt",
        contentType: "text/plain",
      });

    expect(upload.status).toBe(201);
    expect(upload.body.document.filename).toBe("notes.txt");
    expect(upload.body.document.storageKey).toBeUndefined();
    expect(JSON.stringify(upload.body)).not.toMatch(/MINIO|secret|accessKey/i);

    const stored = await prisma.document.findUnique({
      where: { id: upload.body.document.id },
    });
    expect(stored?.storageKey).toMatch(/^workspaces\//);
    expect(stored?.status).toBe("ready");

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
    expect(download.headers["content-type"]).toMatch(/text\/plain/);
    expect(download.body.toString()).toBe("hello vault");
  });

  it("does not call storage when authorization fails", async () => {
    const outsider = await register(app);
    const owner = await register(app);
    const workspace = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "Private" });
    const upload = await api(app)
      .post(`/api/v1/workspaces/${workspace.body.workspace.id}/documents`)
      .set("Cookie", owner.cookie)
      .attach("file", Buffer.from("secret"), {
        filename: "secret.txt",
        contentType: "text/plain",
      });

    const uploadSpy = vi.spyOn(MemoryStorageProvider.prototype, "upload");
    const downloadSpy = vi.spyOn(MemoryStorageProvider.prototype, "download");
    const deleteSpy = vi.spyOn(MemoryStorageProvider.prototype, "delete");

    const forbiddenUpload = await api(app)
      .post(`/api/v1/workspaces/${workspace.body.workspace.id}/documents`)
      .set("Cookie", outsider.cookie)
      .attach("file", Buffer.from("nope"), {
        filename: "nope.txt",
        contentType: "text/plain",
      });
    const forbiddenDownload = await api(app)
      .get(`/api/v1/documents/${upload.body.document.id}/download`)
      .set("Cookie", outsider.cookie);
    const forbiddenDelete = await api(app)
      .delete(`/api/v1/documents/${upload.body.document.id}`)
      .set("Cookie", outsider.cookie);

    expect(forbiddenUpload.status).toBe(404);
    expect(forbiddenDownload.status).toBe(404);
    expect(forbiddenDelete.status).toBe(404);
    expect(uploadSpy).not.toHaveBeenCalled();
    expect(downloadSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();

    uploadSpy.mockRestore();
    downloadSpy.mockRestore();
    deleteSpy.mockRestore();
  });

  it("rejects oversized and spoofed uploads without keeping an object", async () => {
    const owner = await register(app);
    const workspace = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "Checks" });

    const spoofed = await api(app)
      .post(`/api/v1/workspaces/${workspace.body.workspace.id}/documents`)
      .set("Cookie", owner.cookie)
      .attach("file", Buffer.from("%PDF-1.4"), {
        filename: "photo.png",
        contentType: "application/pdf",
      });
    expect(spoofed.status).toBe(400);

    const oversized = await api(app)
      .post(`/api/v1/workspaces/${workspace.body.workspace.id}/documents`)
      .set("Cookie", owner.cookie)
      .attach("file", Buffer.alloc(25 * 1024 * 1024 + 1), {
        filename: "big.pdf",
        contentType: "application/pdf",
      });
    expect(oversized.status).toBe(413);
    expect(oversized.body.error.code).toBe("payload_too_large");

    const leftover = await prisma.document.count({
      where: { workspaceId: workspace.body.workspace.id },
    });
    expect(leftover).toBe(0);
  });

  it("deletes metadata first and retries storage cleanup", async () => {
    const owner = await register(app);
    const workspace = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "Cleanup" });
    const upload = await api(app)
      .post(`/api/v1/workspaces/${workspace.body.workspace.id}/documents`)
      .set("Cookie", owner.cookie)
      .attach("file", Buffer.from("later"), {
        filename: "later.txt",
        contentType: "text/plain",
      });

    const deleteSpy = vi
      .spyOn(MemoryStorageProvider.prototype, "delete")
      .mockRejectedValueOnce(new Error("minio down"));

    const removed = await api(app)
      .delete(`/api/v1/documents/${upload.body.document.id}`)
      .set("Cookie", owner.cookie);
    expect(removed.status).toBe(204);

    const row = await prisma.document.findUnique({
      where: { id: upload.body.document.id },
    });
    expect(row?.deletedAt).not.toBeNull();

    const openJob = await prisma.storageCleanupJob.findFirst({
      where: { documentId: upload.body.document.id, completedAt: null },
    });
    expect(openJob).not.toBeNull();

    deleteSpy.mockRestore();
    const cleanup = app.get(StorageCleanupService);
    await cleanup.retryJobs();
    const done = await prisma.storageCleanupJob.findUnique({ where: { id: openJob!.id } });
    expect(done?.completedAt).not.toBeNull();
  });

  it("removes stale pending rows and their objects", async () => {
    const owner = await register(app);
    const workspace = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "Stale" });

    const storage = app.get(STORAGE_PROVIDER) as MemoryStorageProvider;
    const key = `workspaces/${workspace.body.workspace.id}/documents/${randomUUID()}/deadbeefdeadbeefdeadbeefdeadbeef`;
    await storage.upload(key, Buffer.from("orphan"), "text/plain");

    const pending = await prisma.document.create({
      data: {
        workspaceId: workspace.body.workspace.id,
        uploadedById: owner.userId,
        filename: "stuck.txt",
        storageKey: key,
        byteSize: 6,
        mimeType: "text/plain",
        status: "pending",
        createdAt: new Date(Date.now() - 20 * 60 * 1000),
      },
    });

    await app.get(StorageCleanupService).cleanupStalePending();

    expect(await prisma.document.findUnique({ where: { id: pending.id } })).toBeNull();
    expect(await storage.exists(key)).toBe(false);
  });

  it("removes a stale pending row even when object delete must be retried", async () => {
    const owner = await register(app);
    const workspace = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "Stuck" });
    const key = `workspaces/${workspace.body.workspace.id}/documents/${randomUUID()}/deadbeefdeadbeefdeadbeefdeadbeef`;
    const pending = await prisma.document.create({
      data: {
        workspaceId: workspace.body.workspace.id,
        uploadedById: owner.userId,
        filename: "retry.txt",
        storageKey: key,
        byteSize: 4,
        mimeType: "text/plain",
        status: "pending",
        createdAt: new Date(Date.now() - 20 * 60 * 1000),
      },
    });

    const deleteSpy = vi
      .spyOn(MemoryStorageProvider.prototype, "delete")
      .mockRejectedValueOnce(new Error("minio timeout"));
    await app.get(StorageCleanupService).cleanupStalePending();
    deleteSpy.mockRestore();

    expect(await prisma.document.findUnique({ where: { id: pending.id } })).toBeNull();
    const job = await prisma.storageCleanupJob.findFirst({
      where: { objectKey: key, completedAt: null },
    });
    expect(job).not.toBeNull();
    expect(job?.documentId).toBeNull();
    if (job) {
      await prisma.storageCleanupJob.update({
        where: { id: job.id },
        data: { completedAt: new Date() },
      });
    }
  });
});
