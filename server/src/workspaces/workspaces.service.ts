import { Inject, Injectable, Logger } from "@nestjs/common";
import type { WorkspaceRole } from "@prisma/client";
import { AuthzService } from "../authz/authz.service";
import { Permission } from "../authz/permissions";
import { ForbiddenError, NotFoundError, ValidationError } from "../common/errors";
import { AuditAction } from "../audit/audit.actions";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { StorageCleanupService } from "../storage/cleanup.service";
import { STORAGE_PROVIDER, type StorageProvider } from "../storage/storage.types";

@Injectable()
export class WorkspacesService {
  private readonly logger = new Logger(WorkspacesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly cleanup: StorageCleanupService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async create(userId: string, name: string) {
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 80) {
      throw new ValidationError("Workspace name must be 1–80 characters");
    }

    return this.prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({ data: { name: trimmed } });
      await tx.workspaceMember.create({
        data: { workspaceId: workspace.id, userId, role: "OWNER" },
      });
      await this.audit.write(
        {
          workspaceId: workspace.id,
          actorUserId: userId,
          action: AuditAction.workspaceCreated,
          resourceType: "workspace",
          resourceId: workspace.id,
          metadata: { name: trimmed },
        },
        tx,
      );
      return workspace;
    });
  }

  async listForUser(userId: string) {
    const rows = await this.prisma.workspaceMember.findMany({
      where: { userId, workspace: { deletedAt: null } },
      select: { workspace: true },
      orderBy: { workspace: { createdAt: "desc" } },
    });
    return rows.map((row) => row.workspace);
  }

  async get(userId: string, workspaceId: string) {
    const { workspace, membership } = await this.authz.requireMembership(userId, workspaceId);
    return { ...workspace, role: membership.role };
  }

  async remove(userId: string, workspaceId: string) {
    await this.authz.requireWorkspacePermission(userId, workspaceId, Permission.workspaceDelete);
    const jobs = await this.prisma.$transaction(async (tx) => {
      const documents = await tx.document.findMany({
        where: { workspaceId },
        select: { id: true, storageKey: true },
      });
      await tx.workspace.update({
        where: { id: workspaceId },
        data: { deletedAt: new Date() },
      });
      await tx.workspaceInvitation.updateMany({
        where: { workspaceId, status: "pending" },
        data: { status: "revoked" },
      });
      await tx.document.updateMany({
        where: { workspaceId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      await tx.shareLink.updateMany({
        where: { document: { workspaceId }, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const created: { id: string; objectKey: string }[] = [];
      for (const document of documents) {
        const job = await tx.storageCleanupJob.create({
          data: {
            objectKey: document.storageKey,
            workspaceId,
            documentId: document.id,
          },
        });
        created.push({ id: job.id, objectKey: job.objectKey });
      }
      await this.audit.write(
        {
          workspaceId,
          actorUserId: userId,
          action: AuditAction.workspaceDeleted,
          resourceType: "workspace",
          resourceId: workspaceId,
          metadata: { documents: documents.length },
        },
        tx,
      );
      return created;
    });

    for (const job of jobs) {
      try {
        await this.storage.delete(job.objectKey);
        await this.cleanup.markDone(job.id);
      } catch {
        this.logger.warn(`workspace storage delete queued for retry: ${job.id}`);
      }
    }
  }

  async transfer(userId: string, workspaceId: string, targetUserId: string) {
    this.authz.assertUuid(targetUserId);
    await this.authz.requireWorkspacePermission(
      userId,
      workspaceId,
      Permission.workspaceTransfer,
    );
    if (targetUserId === userId) {
      throw new ValidationError("Cannot transfer ownership to yourself");
    }

    const target = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
    });
    if (!target) {
      throw new ValidationError("Transfer target must already be a member");
    }

    await this.prisma.$transaction(async (tx) => {
      const owner = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
      });
      const next = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
      });
      if (!owner || owner.role !== "OWNER" || !next) {
        throw new ValidationError("Transfer target must already be a member");
      }
      await tx.workspaceMember.update({
        where: { id: owner.id },
        data: { role: "ADMIN" },
      });
      await tx.workspaceMember.update({
        where: { id: next.id },
        data: { role: "OWNER" },
      });
      await this.audit.write(
        {
          workspaceId,
          actorUserId: userId,
          action: AuditAction.workspaceTransferred,
          resourceType: "workspace",
          resourceId: workspaceId,
          metadata: { fromUserId: userId, toUserId: targetUserId },
        },
        tx,
      );
    });
  }

  async listMembers(userId: string, workspaceId: string) {
    await this.authz.requireMembership(userId, workspaceId);
    return this.prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: { select: { id: true, email: true } } },
      orderBy: { createdAt: "asc" },
    });
  }

  async removeMember(actorId: string, workspaceId: string, targetUserId: string) {
    this.authz.assertUuid(targetUserId);
    const { membership: actor } = await this.authz.requireMembership(actorId, workspaceId);
    const target = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
    });
    if (!target) {
      throw new NotFoundError();
    }

    if (actorId === targetUserId) {
      this.authz.requirePermission(actor.role, Permission.memberLeave);
    } else if (target.role === "OWNER") {
      throw new ForbiddenError();
    } else if (target.role === "ADMIN") {
      this.authz.requirePermission(actor.role, Permission.memberRemoveAdmin);
    } else {
      this.authz.requirePermission(actor.role, Permission.memberRemoveMember);
    }

    const left = actorId === targetUserId;
    await this.prisma.$transaction(async (tx) => {
      await tx.workspaceMember.delete({ where: { id: target.id } });
      await tx.shareLink.updateMany({
        where: { createdById: targetUserId, document: { workspaceId }, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.workspaceInvitation.updateMany({
        where: { invitedById: targetUserId, workspaceId, status: "pending" },
        data: { status: "revoked" },
      });
      await this.audit.write(
        {
          workspaceId,
          actorUserId: actorId,
          action: left ? AuditAction.memberLeft : AuditAction.memberRemoved,
          resourceType: "member",
          resourceId: targetUserId,
          metadata: { role: target.role },
        },
        tx,
      );
    });
  }

  async changeRole(actorId: string, workspaceId: string, targetUserId: string, role: WorkspaceRole) {
    this.authz.assertUuid(targetUserId);
    if (role === "OWNER") {
      throw new ValidationError("Use ownership transfer to make someone the owner");
    }
    await this.authz.requireWorkspacePermission(
      actorId,
      workspaceId,
      Permission.memberChangeRole,
    );
    if (actorId === targetUserId) {
      throw new ForbiddenError();
    }

    await this.prisma.$transaction(async (tx) => {
      const target = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
      });
      if (!target) {
        throw new NotFoundError();
      }
      if (target.role === "OWNER") {
        throw new ForbiddenError();
      }
      await tx.workspaceMember.update({
        where: { id: target.id },
        data: { role },
      });
      await this.audit.write(
        {
          workspaceId,
          actorUserId: actorId,
          action: AuditAction.memberRoleChanged,
          resourceType: "member",
          resourceId: targetUserId,
          metadata: { from: target.role, to: role },
        },
        tx,
      );
    });
  }
}
