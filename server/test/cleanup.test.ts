import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  CLEANUP_MAX_ATTEMPTS,
  StorageCleanupService,
  nextRetryDelayMs,
} from "../src/storage/cleanup.service";
import { MemoryStorageProvider } from "../src/storage/memory.storage";
import { STORAGE_PROVIDER } from "../src/storage/storage.types";
import { api, startTestApp } from "./app-request";
import { prisma } from "./helpers";

async function register(app: INestApplication) {
  const email = `job-${randomUUID()}@example.com`;
  const response = await api(app).post("/api/v1/auth/register").send({
    email,
    password: "password1",
  });
  const setCookie = response.headers["set-cookie"];
  const cookie = Array.isArray(setCookie) ? setCookie[0] : String(setCookie);
  return { cookie, userId: response.body.user.id as string };
}

describe("background cleanup", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await startTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("uses exponential backoff and a hard attempt cap", () => {
    expect(nextRetryDelayMs(0)).toBe(0);
    expect(nextRetryDelayMs(1)).toBe(30_000);
    expect(nextRetryDelayMs(2)).toBe(60_000);
    expect(nextRetryDelayMs(8)).toBe(15 * 60 * 1000);
  });

  it("does not retry exhausted or not-yet-due jobs", async () => {
    const owner = await register(app);
    const workspace = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "Jobs" });

    const exhausted = await prisma.storageCleanupJob.create({
      data: {
        objectKey: `workspaces/${workspace.body.workspace.id}/documents/${randomUUID()}/gone`,
        workspaceId: workspace.body.workspace.id,
        attempts: CLEANUP_MAX_ATTEMPTS,
        lastError: "still failing",
      },
    });
    const waiting = await prisma.storageCleanupJob.create({
      data: {
        objectKey: `workspaces/${workspace.body.workspace.id}/documents/${randomUUID()}/wait`,
        workspaceId: workspace.body.workspace.id,
        attempts: 2,
      },
    });

    const spy = vi.spyOn(MemoryStorageProvider.prototype, "delete");
    await app.get(StorageCleanupService).retryJobs();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();

    expect((await prisma.storageCleanupJob.findUnique({ where: { id: exhausted.id } }))?.completedAt).toBeNull();
    expect((await prisma.storageCleanupJob.findUnique({ where: { id: waiting.id } }))?.completedAt).toBeNull();
  });

  it("retries a failed delete idempotently until the object is gone", async () => {
    const owner = await register(app);
    const workspace = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "Retry" });
    const storage = app.get(STORAGE_PROVIDER) as MemoryStorageProvider;
    const key = `workspaces/${workspace.body.workspace.id}/documents/${randomUUID()}/retry`;
    await storage.upload(key, Buffer.from("x"), "text/plain");
    const job = await prisma.storageCleanupJob.create({
      data: { objectKey: key, workspaceId: workspace.body.workspace.id },
    });

    const cleanup = app.get(StorageCleanupService);
    await cleanup.retryJobs();
    expect((await prisma.storageCleanupJob.findUnique({ where: { id: job.id } }))?.completedAt).not.toBeNull();
    expect(await storage.exists(key)).toBe(false);

    await cleanup.retryJobs();
    expect(await storage.exists(key)).toBe(false);
  });

  it("queues object deletes when a workspace is removed", async () => {
    const owner = await register(app);
    const workspace = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "Sweep" });
    const upload = await api(app)
      .post(`/api/v1/workspaces/${workspace.body.workspace.id}/documents`)
      .set("Cookie", owner.cookie)
      .attach("file", Buffer.from("bye"), { filename: "bye.txt", contentType: "text/plain" });

    const removed = await api(app)
      .delete(`/api/v1/workspaces/${workspace.body.workspace.id}`)
      .set("Cookie", owner.cookie);
    expect(removed.status).toBe(204);

    const job = await prisma.storageCleanupJob.findFirst({
      where: { documentId: upload.body.document.id },
    });
    expect(job?.completedAt).not.toBeNull();
    const doc = await prisma.document.findUnique({ where: { id: upload.body.document.id } });
    expect(doc?.deletedAt).not.toBeNull();
  });
});
