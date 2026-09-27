import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { AuthzService } from "../authz/authz.service";
import { Permission } from "../authz/permissions";
import { currentRequestId } from "../common/request-id";
import { PrismaService } from "../prisma/prisma.service";

type Db = Prisma.TransactionClient | PrismaService;

export type AuditWrite = {
  workspaceId: string;
  actorUserId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
};

const SECRET_KEY = /token|password|secret|authorization|cookie|hash/i;

function safeMetadata(metadata: Record<string, unknown> = {}) {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SECRET_KEY.test(key)) {
      continue;
    }
    clean[key] = value;
  }
  return clean;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthzService,
  ) {}

  async write(event: AuditWrite, db: Db = this.prisma) {
    await db.auditEvent.create({
      data: {
        workspaceId: event.workspaceId,
        actorUserId: event.actorUserId ?? null,
        action: event.action,
        resourceType: event.resourceType,
        resourceId: event.resourceId ?? null,
        requestId: currentRequestId(),
        metadata: safeMetadata(event.metadata) as Prisma.InputJsonValue,
      },
    });
  }

  async tryWrite(event: AuditWrite) {
    try {
      await this.write(event);
    } catch {
      this.logger.warn(`audit write skipped for ${event.action}`);
    }
  }

  async list(userId: string, workspaceId: string, options: { limit?: number; cursor?: string } = {}) {
    await this.authz.requireWorkspacePermission(userId, workspaceId, Permission.auditView);
    const limit = options.limit ?? 20;
    const where: Prisma.AuditEventWhereInput = { workspaceId };

    if (options.cursor) {
      this.authz.assertUuid(options.cursor);
      const cursor = await this.prisma.auditEvent.findFirst({
        where: { id: options.cursor, workspaceId },
      });
      if (!cursor) {
        return { events: [], nextCursor: null };
      }
      where.OR = [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      ];
    }

    const rows = await this.prisma.auditEvent.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: {
        id: true,
        actorUserId: true,
        action: true,
        resourceType: true,
        resourceId: true,
        requestId: true,
        metadata: true,
        createdAt: true,
      },
    });

    const hasMore = rows.length > limit;
    const events = hasMore ? rows.slice(0, limit) : rows;
    return {
      events,
      nextCursor: hasMore ? events[events.length - 1]?.id ?? null : null,
    };
  }
}
