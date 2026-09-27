import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuditAction } from "../audit/audit.actions";
import { AuditService } from "../audit/audit.service";
import { AuthzService } from "../authz/authz.service";
import { Permission } from "../authz/permissions";
import { ConflictError, NotFoundError, ValidationError } from "../common/errors";
import { generateOpaqueToken, hashToken, isOpaqueTokenFormat } from "../common/tokens";
import { PrismaService } from "../prisma/prisma.service";
import { normalizeEmail } from "../users/normalize";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
  ) {}

  async invite(actorId: string, workspaceId: string, email: string) {
    await this.authz.requireWorkspacePermission(actorId, workspaceId, Permission.memberInvite);
    const normalized = normalizeEmail(email);
    if (!normalized.includes("@")) {
      throw new ValidationError("Invalid request");
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email: normalized },
      select: { id: true },
    });
    if (existingUser) {
      const alreadyMember = await this.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: existingUser.id } },
        select: { userId: true },
      });
      if (alreadyMember) {
        throw new ConflictError("That person is already a member");
      }
    }

    try {
      return await this.createPendingInvite(actorId, workspaceId, normalized);
    } catch (error) {
      if (isUniqueViolation(error)) {
        return this.createPendingInvite(actorId, workspaceId, normalized);
      }
      throw error;
    }
  }

  private async createPendingInvite(actorId: string, workspaceId: string, email: string) {
    const rawToken = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    const invitation = await this.prisma.$transaction(async (tx) => {
      await tx.workspaceInvitation.updateMany({
        where: { workspaceId, email, status: "pending" },
        data: { status: "replaced" },
      });
      const created = await tx.workspaceInvitation.create({
        data: {
          workspaceId,
          email,
          tokenHash: hashToken(rawToken),
          status: "pending",
          expiresAt,
          invitedById: actorId,
        },
      });
      await this.audit.write(
        {
          workspaceId,
          actorUserId: actorId,
          action: AuditAction.memberInvited,
          resourceType: "invitation",
          resourceId: created.id,
          metadata: { email },
        },
        tx,
      );
      return created;
    });
    return { id: invitation.id, email, token: rawToken, expiresAt: invitation.expiresAt };
  }

  async list(actorId: string, workspaceId: string) {
    await this.authz.requireWorkspacePermission(actorId, workspaceId, Permission.memberInviteRevoke);
    return this.prisma.workspaceInvitation.findMany({
      where: { workspaceId, status: "pending" },
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, expiresAt: true, createdAt: true },
    });
  }

  async revoke(actorId: string, workspaceId: string, invitationId: string) {
    this.authz.assertUuid(invitationId);
    await this.authz.requireWorkspacePermission(actorId, workspaceId, Permission.memberInviteRevoke);

    const invitation = await this.prisma.workspaceInvitation.findFirst({
      where: { id: invitationId, workspaceId },
    });
    if (!invitation) {
      throw new NotFoundError();
    }
    if (invitation.status !== "pending") {
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.workspaceInvitation.update({
        where: { id: invitation.id },
        data: { status: "revoked" },
      });
      await this.audit.write(
        {
          workspaceId,
          actorUserId: actorId,
          action: AuditAction.memberInviteRevoked,
          resourceType: "invitation",
          resourceId: invitation.id,
          metadata: { email: invitation.email },
        },
        tx,
      );
    });
  }

  async lookup(user: { id: string; email: string }, token: string) {
    const invitation = await this.loadUsableInvite(token, user.email);
    if (invitation.status !== "pending") {
      throw new NotFoundError();
    }
    return {
      email: invitation.email,
      expiresAt: invitation.expiresAt,
      workspaceName: invitation.workspace.name,
    };
  }

  async accept(user: { id: string; email: string }, token: string) {
    const invitation = await this.loadUsableInvite(token, user.email);

    const existing = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId: user.id } },
    });
    if (existing) {
      throw new ConflictError("You are already a member of this workspace");
    }
    if (invitation.status !== "pending") {
      throw new ConflictError("This invitation has already been used");
    }

    try {
      const membership = await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.workspaceInvitation.updateMany({
          where: { id: invitation.id, status: "pending" },
          data: { status: "accepted", acceptedById: user.id },
        });
        if (claimed.count !== 1) {
          throw new ConflictError("This invitation has already been used");
        }
        const membership = await tx.workspaceMember.create({
          data: { workspaceId: invitation.workspaceId, userId: user.id, role: "MEMBER" },
        });
        await this.audit.write(
          {
            workspaceId: invitation.workspaceId,
            actorUserId: user.id,
            action: AuditAction.memberInviteAccepted,
            resourceType: "invitation",
            resourceId: invitation.id,
          },
          tx,
        );
        return membership;
      });
      return {
        workspace: { id: invitation.workspaceId, name: invitation.workspace.name, role: membership.role },
      };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError("You are already a member of this workspace");
      }
      throw error;
    }
  }

  private async loadUsableInvite(token: string, email: string) {
    if (!isOpaqueTokenFormat(token)) {
      throw new NotFoundError();
    }

    const invitation = await this.prisma.workspaceInvitation.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { workspace: { select: { name: true, deletedAt: true } } },
    });
    if (
      !invitation ||
      invitation.expiresAt.getTime() <= Date.now() ||
      invitation.workspace.deletedAt ||
      invitation.email !== normalizeEmail(email) ||
      invitation.status === "revoked" ||
      invitation.status === "replaced"
    ) {
      throw new NotFoundError();
    }
    return invitation;
  }
}
