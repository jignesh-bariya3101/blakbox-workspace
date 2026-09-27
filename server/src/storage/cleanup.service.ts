import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { STORAGE_PROVIDER, type StorageProvider } from "./storage.types";

export const STALE_PENDING_MS = 15 * 60 * 1000;
export const CLEANUP_INTERVAL_MS = 60_000;
export const CLEANUP_MAX_ATTEMPTS = 8;
export const CLEANUP_BACKOFF_MS = 30_000;
export const CLEANUP_MAX_BACKOFF_MS = 15 * 60 * 1000;
export const CLEANUP_BATCH = 25;

export function nextRetryDelayMs(attempts: number) {
  if (attempts <= 0) {
    return 0;
  }
  return Math.min(CLEANUP_BACKOFF_MS * 2 ** (attempts - 1), CLEANUP_MAX_BACKOFF_MS);
}

@Injectable()
export class StorageCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StorageCleanupService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === "test") {
      return;
    }
    this.timer = setInterval(() => {
      void this.reconcile();
    }, CLEANUP_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async enqueue(objectKey: string, workspaceId?: string, documentId?: string) {
    return this.prisma.storageCleanupJob.create({
      data: { objectKey, workspaceId, documentId },
    });
  }

  async markDone(jobId: string) {
    await this.prisma.storageCleanupJob.update({
      where: { id: jobId },
      data: { completedAt: new Date() },
    });
  }

  async reconcile() {
    await this.cleanupStalePending();
    await this.retryJobs();
  }

  async cleanupStalePending() {
    const stale = await this.prisma.document.findMany({
      where: {
        status: "pending",
        deletedAt: null,
        createdAt: { lt: new Date(Date.now() - STALE_PENDING_MS) },
      },
      select: { id: true, storageKey: true, workspaceId: true },
      orderBy: { createdAt: "asc" },
      take: CLEANUP_BATCH,
    });

    for (const document of stale) {
      try {
        await this.storage.delete(document.storageKey);
      } catch {
        this.logger.warn(`pending object delete failed for ${document.id}`);
        await this.enqueue(document.storageKey, document.workspaceId);
      }
      await this.prisma.document.delete({ where: { id: document.id } }).catch(() => undefined);
    }
  }

  async retryJobs() {
    const jobs = await this.prisma.storageCleanupJob.findMany({
      where: {
        completedAt: null,
        attempts: { lt: CLEANUP_MAX_ATTEMPTS },
      },
      orderBy: { createdAt: "asc" },
      take: CLEANUP_BATCH,
    });

    for (const job of jobs) {
      const dueAt = job.createdAt.getTime() + nextRetryDelayMs(job.attempts);
      if (Date.now() < dueAt) {
        continue;
      }

      try {
        await this.storage.delete(job.objectKey);
        await this.markDone(job.id);
      } catch (error) {
        const attempts = job.attempts + 1;
        const lastError = error instanceof Error ? error.message.slice(0, 500) : "delete failed";
        await this.prisma.storageCleanupJob.update({
          where: { id: job.id },
          data: { attempts: { increment: 1 }, lastError },
        });
        if (attempts >= CLEANUP_MAX_ATTEMPTS) {
          this.logger.error(`cleanup job ${job.id} exhausted ${CLEANUP_MAX_ATTEMPTS} attempts`);
        } else {
          this.logger.warn(`cleanup job ${job.id} failed attempt ${attempts}: ${lastError}`);
        }
      }
    }
  }
}
