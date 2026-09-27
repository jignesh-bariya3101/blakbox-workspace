import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOwner, createUser, createWorkspace, prisma } from "./helpers";

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";
}

function isCheckViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /check constraint|23514|byte_size_positive|download_count_nonnegative|attempts_nonnegative/i.test(
    message,
  );
}

describe("database constraints", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required for constraint tests");
    }
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rejects a duplicate email", async () => {
    const email = `dup-${randomUUID()}@example.com`;
    await createUser({ email });
    await expect(createUser({ email })).rejects.toSatisfy(isUniqueViolation);
  });

  it("rejects a second membership for the same user and workspace", async () => {
    const user = await createUser();
    const workspace = await createWorkspace();
    await createOwner(workspace.id, user.id);
    await expect(
      prisma.workspaceMember.create({
        data: { workspaceId: workspace.id, userId: user.id, role: "MEMBER" },
      }),
    ).rejects.toSatisfy(isUniqueViolation);
  });

  it("rejects a second OWNER in the same workspace", async () => {
    const owner = await createUser();
    const other = await createUser();
    const workspace = await createWorkspace();
    await createOwner(workspace.id, owner.id);
    await expect(
      prisma.workspaceMember.create({
        data: { workspaceId: workspace.id, userId: other.id, role: "OWNER" },
      }),
    ).rejects.toSatisfy(isUniqueViolation);
  });

  it("allows OWNER transfer by updating roles in one transaction", async () => {
    const owner = await createUser();
    const member = await createUser();
    const workspace = await createWorkspace();
    await createOwner(workspace.id, owner.id);
    await prisma.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: member.id, role: "MEMBER" },
    });

    await prisma.$transaction([
      prisma.workspaceMember.update({
        where: { workspaceId_userId: { workspaceId: workspace.id, userId: owner.id } },
        data: { role: "ADMIN" },
      }),
      prisma.workspaceMember.update({
        where: { workspaceId_userId: { workspaceId: workspace.id, userId: member.id } },
        data: { role: "OWNER" },
      }),
    ]);

    const roles = await prisma.workspaceMember.findMany({
      where: { workspaceId: workspace.id },
      select: { userId: true, role: true },
    });
    expect(roles).toEqual(
      expect.arrayContaining([
        { userId: owner.id, role: "ADMIN" },
        { userId: member.id, role: "OWNER" },
      ]),
    );
  });

  it("rejects two pending invitations for the same workspace email", async () => {
    const inviter = await createUser();
    const workspace = await createWorkspace();
    await createOwner(workspace.id, inviter.id);
    const email = `invitee-${randomUUID()}@example.com`;

    await prisma.workspaceInvitation.create({
      data: {
        workspaceId: workspace.id,
        email,
        tokenHash: `tok-${randomUUID()}`,
        status: "pending",
        expiresAt: new Date(Date.now() + 86_400_000),
        invitedById: inviter.id,
      },
    });

    await expect(
      prisma.workspaceInvitation.create({
        data: {
          workspaceId: workspace.id,
          email,
          tokenHash: `tok-${randomUUID()}`,
          status: "pending",
          expiresAt: new Date(Date.now() + 86_400_000),
          invitedById: inviter.id,
        },
      }),
    ).rejects.toSatisfy(isUniqueViolation);
  });

  it("allows a new pending invitation after the previous one is replaced", async () => {
    const inviter = await createUser();
    const workspace = await createWorkspace();
    await createOwner(workspace.id, inviter.id);
    const email = `invitee-${randomUUID()}@example.com`;

    const first = await prisma.workspaceInvitation.create({
      data: {
        workspaceId: workspace.id,
        email,
        tokenHash: `tok-${randomUUID()}`,
        status: "pending",
        expiresAt: new Date(Date.now() + 86_400_000),
        invitedById: inviter.id,
      },
    });

    await prisma.$transaction([
      prisma.workspaceInvitation.update({
        where: { id: first.id },
        data: { status: "replaced" },
      }),
      prisma.workspaceInvitation.create({
        data: {
          workspaceId: workspace.id,
          email,
          tokenHash: `tok-${randomUUID()}`,
          status: "pending",
          expiresAt: new Date(Date.now() + 86_400_000),
          invitedById: inviter.id,
        },
      }),
    ]);

    const pending = await prisma.workspaceInvitation.count({
      where: { workspaceId: workspace.id, email, status: "pending" },
    });
    expect(pending).toBe(1);
  });

  it("rejects a colliding share-link token hash", async () => {
    const user = await createUser();
    const workspace = await createWorkspace();
    await createOwner(workspace.id, user.id);
    const document = await prisma.document.create({
      data: {
        workspaceId: workspace.id,
        uploadedById: user.id,
        filename: "a.pdf",
        storageKey: `key-${randomUUID()}`,
        byteSize: 100,
        mimeType: "application/pdf",
        status: "ready",
      },
    });
    const tokenHash = `share-${randomUUID()}`;
    await prisma.shareLink.create({
      data: {
        documentId: document.id,
        createdById: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    await expect(
      prisma.shareLink.create({
        data: {
          documentId: document.id,
          createdById: user.id,
          tokenHash,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      }),
    ).rejects.toSatisfy(isUniqueViolation);
  });

  it("rejects a colliding invitation token hash", async () => {
    const inviter = await createUser();
    const workspace = await createWorkspace();
    await createOwner(workspace.id, inviter.id);
    const tokenHash = `inv-${randomUUID()}`;
    const base = {
      workspaceId: workspace.id,
      tokenHash,
      status: "pending" as const,
      expiresAt: new Date(Date.now() + 86_400_000),
      invitedById: inviter.id,
    };
    await prisma.workspaceInvitation.create({
      data: { ...base, email: `a-${randomUUID()}@example.com` },
    });
    await expect(
      prisma.workspaceInvitation.create({
        data: { ...base, email: `b-${randomUUID()}@example.com` },
      }),
    ).rejects.toSatisfy(isUniqueViolation);
  });

  it("rejects a document with byte_size <= 0", async () => {
    const user = await createUser();
    const workspace = await createWorkspace();
    await createOwner(workspace.id, user.id);
    await expect(
      prisma.document.create({
        data: {
          workspaceId: workspace.id,
          uploadedById: user.id,
          filename: "empty.pdf",
          storageKey: `key-${randomUUID()}`,
          byteSize: 0,
          mimeType: "application/pdf",
          status: "ready",
        },
      }),
    ).rejects.toSatisfy(isCheckViolation);
  });

  it("rejects deleting a workspace that still has members", async () => {
    const user = await createUser();
    const workspace = await createWorkspace();
    await createOwner(workspace.id, user.id);
    await expect(prisma.workspace.delete({ where: { id: workspace.id } })).rejects.toSatisfy(
      isForeignKeyViolation,
    );
  });

  it("rejects deleting a user who uploaded a document", async () => {
    const user = await createUser();
    const workspace = await createWorkspace();
    await createOwner(workspace.id, user.id);
    await prisma.document.create({
      data: {
        workspaceId: workspace.id,
        uploadedById: user.id,
        filename: "kept.pdf",
        storageKey: `key-${randomUUID()}`,
        byteSize: 10,
        mimeType: "application/pdf",
        status: "ready",
      },
    });
    await expect(prisma.user.delete({ where: { id: user.id } })).rejects.toSatisfy(
      isForeignKeyViolation,
    );
  });

  it("rejects deleting a document that still has a share link", async () => {
    const user = await createUser();
    const workspace = await createWorkspace();
    await createOwner(workspace.id, user.id);
    const document = await prisma.document.create({
      data: {
        workspaceId: workspace.id,
        uploadedById: user.id,
        filename: "shared.pdf",
        storageKey: `key-${randomUUID()}`,
        byteSize: 10,
        mimeType: "application/pdf",
        status: "ready",
      },
    });
    await prisma.shareLink.create({
      data: {
        documentId: document.id,
        createdById: user.id,
        tokenHash: `share-${randomUUID()}`,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    await expect(prisma.document.delete({ where: { id: document.id } })).rejects.toSatisfy(
      isForeignKeyViolation,
    );
  });

  it("does not attach a document to a missing workspace (no orphan)", async () => {
    const user = await createUser();
    await expect(
      prisma.document.create({
        data: {
          workspaceId: randomUUID(),
          uploadedById: user.id,
          filename: "orphan.pdf",
          storageKey: `key-${randomUUID()}`,
          byteSize: 10,
          mimeType: "application/pdf",
          status: "ready",
        },
      }),
    ).rejects.toSatisfy(isForeignKeyViolation);
  });

  it("allows two documents with the same filename in one workspace", async () => {
    const user = await createUser();
    const workspace = await createWorkspace();
    await createOwner(workspace.id, user.id);
    const filename = "notes.txt";
    await prisma.document.create({
      data: {
        workspaceId: workspace.id,
        uploadedById: user.id,
        filename,
        storageKey: `key-${randomUUID()}`,
        byteSize: 4,
        mimeType: "text/plain",
        status: "ready",
      },
    });
    await expect(
      prisma.document.create({
        data: {
          workspaceId: workspace.id,
          uploadedById: user.id,
          filename,
          storageKey: `key-${randomUUID()}`,
          byteSize: 4,
          mimeType: "text/plain",
          status: "ready",
        },
      }),
    ).resolves.toMatchObject({ filename });
  });

  it("keeps list/pagination indexes aligned with ORDER BY created_at, id", async () => {
    const indexes = await prisma.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE indexname IN (
        'documents_workspace_ready_alive',
        'audit_events_workspace_id_created_at_id_idx'
      )
    `;
    const byName = Object.fromEntries(indexes.map((row) => [row.indexname, row.indexdef]));
    expect(byName.documents_workspace_ready_alive).toMatch(/created_at DESC/);
    expect(byName.documents_workspace_ready_alive).toMatch(/id DESC/);
    expect(byName.audit_events_workspace_id_created_at_id_idx).toMatch(/created_at DESC/);
    expect(byName.audit_events_workspace_id_created_at_id_idx).toMatch(/id DESC/);
  });
});
