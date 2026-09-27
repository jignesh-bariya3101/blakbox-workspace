import { Injectable } from "@nestjs/common";
import type { WorkspaceRole } from "@prisma/client";
import { ForbiddenError, NotFoundError } from "../common/errors";
import { PrismaService } from "../prisma/prisma.service";
import { can, type Permission } from "./permissions";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class AuthzService {
  constructor(private readonly prisma: PrismaService) {}

  assertUuid(id: string): string {
    if (!UUID.test(id)) {
      throw new NotFoundError();
    }
    return id;
  }

  requirePermission(role: WorkspaceRole, permission: Permission) {
    if (!can(role, permission)) {
      throw new ForbiddenError();
    }
  }

  async requireMembership(userId: string, workspaceId: string) {
    this.assertUuid(workspaceId);
    const workspace = await this.prisma.workspace.findFirst({
      where: { id: workspaceId, deletedAt: null },
    });
    if (!workspace) {
      throw new NotFoundError();
    }

    const membership = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (!membership) {
      throw new NotFoundError();
    }

    return { workspace, membership };
  }

  async requireWorkspacePermission(userId: string, workspaceId: string, permission: Permission) {
    const { workspace, membership } = await this.requireMembership(userId, workspaceId);
    this.requirePermission(membership.role, permission);
    return { workspace, membership };
  }

  async requireDocumentInCallerWorkspace(userId: string, documentId: string) {
    this.assertUuid(documentId);
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, deletedAt: null, status: "ready" },
    });
    if (!document) {
      throw new NotFoundError();
    }

    const access = await this.requireMembership(userId, document.workspaceId);
    return { document, ...access };
  }

  requireOwnOr(
    userId: string,
    ownerUserId: string,
    role: WorkspaceRole,
    own: Permission,
    others: Permission,
  ) {
    this.requirePermission(role, userId === ownerUserId ? own : others);
  }
}
