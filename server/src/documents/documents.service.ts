import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { AuditAction } from "../audit/audit.actions";
import { AuditService } from "../audit/audit.service";
import { AuthzService } from "../authz/authz.service";
import { Permission } from "../authz/permissions";
import { NotFoundError } from "../common/errors";
import { PrismaService } from "../prisma/prisma.service";
import { StorageCleanupService } from "../storage/cleanup.service";
import { sanitizeRenamedFilename, validateUpload } from "../storage/file-validation";
import { buildObjectKey } from "../storage/object-keys";
import { STORAGE_PROVIDER, type StorageProvider } from "../storage/storage.types";

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthzService,
    private readonly cleanup: StorageCleanupService,
    private readonly audit: AuditService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async list(userId: string, workspaceId: string, options: { limit?: number; cursor?: string } = {}) {
    await this.authz.requireWorkspacePermission(userId, workspaceId, Permission.documentView);
    const limit = options.limit ?? 20;
    const where: Prisma.DocumentWhereInput = { workspaceId, deletedAt: null, status: "ready" };

    if (options.cursor) {
      const cursor = await this.prisma.document.findFirst({
        where: { id: options.cursor, workspaceId, deletedAt: null, status: "ready" },
      });
      if (!cursor) {
        return { documents: [], nextCursor: null };
      }
      where.OR = [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      ];
    }

    const rows = await this.prisma.document.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: {
        id: true,
        filename: true,
        byteSize: true,
        mimeType: true,
        uploadedById: true,
        createdAt: true,
      },
    });

    const hasMore = rows.length > limit;
    const documents = hasMore ? rows.slice(0, limit) : rows;
    return {
      documents,
      nextCursor: hasMore ? documents[documents.length - 1]?.id ?? null : null,
    };
  }

  async get(userId: string, documentId: string) {
    const { document, membership } = await this.authz.requireDocumentInCallerWorkspace(
      userId,
      documentId,
    );
    this.authz.requirePermission(membership.role, Permission.documentView);
    return {
      id: document.id,
      workspaceId: document.workspaceId,
      filename: document.filename,
      byteSize: document.byteSize,
      mimeType: document.mimeType,
      uploadedById: document.uploadedById,
      createdAt: document.createdAt,
    };
  }

  async upload(
    userId: string,
    workspaceId: string,
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ) {
    await this.authz.requireWorkspacePermission(userId, workspaceId, Permission.documentUpload);
    const validated = validateUpload(file.originalname, file.mimetype, file.size, file.buffer);

    const documentId = randomUUID();
    const storageKey = buildObjectKey(workspaceId, documentId);
    const pending = await this.prisma.document.create({
      data: {
        id: documentId,
        workspaceId,
        uploadedById: userId,
        filename: validated.filename,
        storageKey,
        byteSize: validated.byteSize,
        mimeType: validated.mimeType,
        status: "pending",
      },
    });

    try {
      await this.storage.upload(storageKey, file.buffer, validated.mimeType);
    } catch (error) {
      this.logger.error("storage upload failed");
      await this.discardUnlistedUpload(pending);
      throw error;
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const ready = await tx.document.update({
          where: { id: pending.id },
          data: { status: "ready" },
        });
        await this.audit.write(
          {
            workspaceId,
            actorUserId: userId,
            action: AuditAction.documentUploaded,
            resourceType: "document",
            resourceId: ready.id,
            metadata: { filename: ready.filename, byteSize: ready.byteSize },
          },
          tx,
        );
        return ready;
      });
    } catch (error) {
      try {
        await this.storage.delete(storageKey);
      } catch {
        await this.cleanup.enqueue(storageKey, workspaceId);
      }
      throw error;
    }
  }

  private async discardUnlistedUpload(pending: {
    id: string;
    workspaceId: string;
    storageKey: string;
  }) {
    try {
      await this.storage.delete(pending.storageKey);
    } catch {
      await this.cleanup.enqueue(pending.storageKey, pending.workspaceId);
    }
    await this.prisma.document.delete({ where: { id: pending.id } }).catch(() => undefined);
  }

  async download(userId: string, documentId: string) {
    const { document, membership } = await this.authz.requireDocumentInCallerWorkspace(
      userId,
      documentId,
    );
    this.authz.requirePermission(membership.role, Permission.documentDownload);
    await this.audit.tryWrite({
      workspaceId: document.workspaceId,
      actorUserId: userId,
      action: AuditAction.documentDownloaded,
      resourceType: "document",
      resourceId: document.id,
    });
    try {
      const stream = await this.storage.download(document.storageKey);
      return { document, stream };
    } catch (error) {
      if (error instanceof NotFoundError) {
        this.logger.error(`ready document ${document.id} is missing its object`);
        throw new Error("Stored object is missing");
      }
      throw error;
    }
  }

  async remove(userId: string, documentId: string) {
    const { document, membership } = await this.authz.requireDocumentInCallerWorkspace(
      userId,
      documentId,
    );
    this.authz.requireOwnOr(
      userId,
      document.uploadedById,
      membership.role,
      Permission.documentDeleteOwn,
      Permission.documentDeleteAny,
    );

    const job = await this.prisma.$transaction(async (tx) => {
      await tx.document.update({
        where: { id: document.id },
        data: { deletedAt: new Date() },
      });
      await tx.shareLink.updateMany({
        where: { documentId: document.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const created = await tx.storageCleanupJob.create({
        data: {
          objectKey: document.storageKey,
          workspaceId: document.workspaceId,
          documentId: document.id,
        },
      });
      await this.audit.write(
        {
          workspaceId: document.workspaceId,
          actorUserId: userId,
          action: AuditAction.documentDeleted,
          resourceType: "document",
          resourceId: document.id,
          metadata: { filename: document.filename },
        },
        tx,
      );
      return created;
    });

    try {
      await this.storage.delete(document.storageKey);
      await this.cleanup.markDone(job.id);
    } catch {
      this.logger.warn(`storage delete queued for retry: ${job.id}`);
    }
  }

  async rename(userId: string, documentId: string, filename: string) {
    const { document, membership } = await this.authz.requireDocumentInCallerWorkspace(
      userId,
      documentId,
    );
    this.authz.requireOwnOr(
      userId,
      document.uploadedById,
      membership.role,
      Permission.documentRenameOwn,
      Permission.documentRenameAny,
    );

    const nextName = sanitizeRenamedFilename(filename, document.mimeType);
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.document.update({
        where: { id: document.id },
        data: { filename: nextName },
      });
      await this.audit.write(
        {
          workspaceId: document.workspaceId,
          actorUserId: userId,
          action: AuditAction.documentRenamed,
          resourceType: "document",
          resourceId: document.id,
          metadata: { from: document.filename, to: nextName },
        },
        tx,
      );
      return row;
    });
    return {
      id: updated.id,
      workspaceId: updated.workspaceId,
      filename: updated.filename,
      byteSize: updated.byteSize,
      mimeType: updated.mimeType,
      uploadedById: updated.uploadedById,
      createdAt: updated.createdAt,
    };
  }
}
