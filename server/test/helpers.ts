import { randomUUID } from "node:crypto";
import { PrismaClient, type Prisma } from "@prisma/client";

export const prisma = new PrismaClient();

export async function createUser(overrides: Partial<Prisma.UserCreateInput> = {}) {
  return prisma.user.create({
    data: {
      email: overrides.email ?? `user-${randomUUID()}@example.com`,
      passwordHash: overrides.passwordHash ?? "hash",
    },
  });
}

export async function createWorkspace(name = "Acme") {
  return prisma.workspace.create({
    data: { name },
  });
}

export async function createOwner(workspaceId: string, userId: string) {
  return prisma.workspaceMember.create({
    data: { workspaceId, userId, role: "OWNER" },
  });
}
