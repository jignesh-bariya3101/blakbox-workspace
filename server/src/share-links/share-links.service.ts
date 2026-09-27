import { Inject, Injectable, Logger } from "@nestjs/common";
import { AuditAction } from "../audit/audit.actions";
import { AuditService } from "../audit/audit.service";
import { AuthzService } from "../authz/authz.service";
import { Permission } from "../authz/permissions";
import { generateOpaqueToken, hashToken } from "../common/tokens";
import { NotFoundError, ValidationError } from "../common/errors";
import { PrismaService } from "../prisma/prisma.service";
import { isOpaqueTokenFormat } from "../common/tokens";
import { STORAGE_PROVIDER, type StorageProvider } from "../storage/storage.types";

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TTL_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class ShareLinksService {
  private readonly logger = new Logger(ShareLinksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  resolveExpiresAt(input?: string) {
    const now = Date.now();
    if (!input) {
      return new Date(now + DEFAULT_TTL_MS);
    }
    const expiresAt = new Date(input);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now) {
      throw new ValidationError("Expiration must be in the future");
    }
    const max = now + MAX_TTL_MS;
    return new Date(Math.min(expiresAt.getTime(), max));
  }

  async create(userId: string, documentId: string, expiresAtInput?: string) {
    const { document, membership } = await this.authz.requireDocumentInCallerWorkspace(
      userId,
      documentId,
    );
    this.authz.requirePermission(membership.role, Permission.shareLinkCreate);

    const rawToken = generateOpaqueToken();
    const expiresAt = this.resolveExpiresAt(expiresAtInput);
    const link = await this.prisma.$transaction(async (tx) => {
      const created = await tx.shareLink.create({
        data: {
          documentId: document.id,
          createdById: userId,
          tokenHash: hashToken(rawToken),
          expiresAt,
        },
      });
      await this.audit.write(
        {
          workspaceId: document.workspaceId,
          actorUserId: userId,
          action: AuditAction.shareLinkCreated,
          resourceType: "share_link",
          resourceId: created.id,
          metadata: { documentId: document.id },
        },
        tx,
      );
      return created;
    });
    return { id: link.id, token: rawToken, expiresAt: link.expiresAt };
  }

  async list(userId: string, documentId: string) {
    const { document, membership } = await this.authz.requireDocumentInCallerWorkspace(
      userId,
      documentId,
    );
    this.authz.requirePermission(membership.role, Permission.documentView);

    const links = await this.prisma.shareLink.findMany({
      where: { documentId: document.id, revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, expiresAt: true, createdAt: true, createdById: true },
    });

    return links.map((link) => ({
      id: link.id,
      expiresAt: link.expiresAt,
      createdAt: link.createdAt,
      mine: link.createdById === userId,
    }));
  }

  async revoke(userId: string, shareLinkId: string) {
    this.authz.assertUuid(shareLinkId);
    const link = await this.prisma.shareLink.findUnique({
      where: { id: shareLinkId },
      include: { document: true },
    });
    if (!link) {
      throw new NotFoundError();
    }

    const { membership } = await this.authz.requireMembership(userId, link.document.workspaceId);
    this.authz.requireOwnOr(
      userId,
      link.createdById,
      membership.role,
      Permission.shareLinkRevokeOwn,
      Permission.shareLinkRevokeAny,
    );

    if (link.revokedAt) {
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.shareLink.update({
        where: { id: link.id },
        data: { revokedAt: new Date() },
      });
      await this.audit.write(
        {
          workspaceId: link.document.workspaceId,
          actorUserId: userId,
          action: AuditAction.shareLinkRevoked,
          resourceType: "share_link",
          resourceId: link.id,
        },
        tx,
      );
    });
  }

  async publicDownload(token: string) {
    if (!isOpaqueTokenFormat(token)) {
      throw new NotFoundError();
    }

    const link = await this.prisma.shareLink.findUnique({
      where: { tokenHash: hashToken(token) },
      select: {
        id: true,
        revokedAt: true,
        expiresAt: true,
        document: {
          select: {
            id: true,
            workspaceId: true,
            filename: true,
            storageKey: true,
            mimeType: true,
            status: true,
            deletedAt: true,
            workspace: { select: { deletedAt: true } },
          },
        },
      },
    });

    const document = link?.document;
    const workspace = document?.workspace;
    const allowed =
      link &&
      !link.revokedAt &&
      link.expiresAt.getTime() > Date.now() &&
      document &&
      document.status === "ready" &&
      !document.deletedAt &&
      workspace &&
      !workspace.deletedAt;

    if (!allowed || !link || !document) {
      throw new NotFoundError();
    }

    try {
      const stream = await this.storage.download(document.storageKey);
      await this.prisma.shareLink.update({
        where: { id: link.id },
        data: { downloadCount: { increment: 1 } },
      });
      await this.audit.tryWrite({
        workspaceId: document.workspaceId,
        actorUserId: null,
        action: AuditAction.shareLinkDownloaded,
        resourceType: "share_link",
        resourceId: link.id,
      });
      return { filename: document.filename, mimeType: document.mimeType, stream };
    } catch (error) {
      if (error instanceof NotFoundError) {
        this.logger.error(`share link object missing for document ${document.id}`);
        throw new Error("Stored object is missing");
      }
      throw error;
    }
  }
}
