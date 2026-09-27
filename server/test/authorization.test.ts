import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, startTestApp } from "./app-request";
import { prisma } from "./helpers";

async function register(app: INestApplication) {
  const email = `authz-${randomUUID()}@example.com`;
  const response = await api(app).post("/api/v1/auth/register").send({
    email,
    password: "password1",
  });
  const setCookie = response.headers["set-cookie"];
  const cookie = Array.isArray(setCookie) ? setCookie[0] : String(setCookie);
  return { email, cookie, userId: response.body.user.id as string };
}

async function seedDocument(workspaceId: string, uploadedById: string) {
  return prisma.document.create({
    data: {
      workspaceId,
      uploadedById,
      filename: "secret.pdf",
      storageKey: `key-${randomUUID()}`,
      byteSize: 12,
      mimeType: "application/pdf",
      status: "ready",
    },
  });
}

describe("authorization attack cases", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await startTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("1. User A cannot read User B's document in another workspace", async () => {
    const a = await register(app);
    const b = await register(app);
    const workspaceB = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", b.cookie)
      .send({ name: "B Corp" });
    const doc = await seedDocument(workspaceB.body.workspace.id, b.userId);

    const response = await api(app).get(`/api/v1/documents/${doc.id}`).set("Cookie", a.cookie);
    expect(response.status).toBe(404);
  });

  it("2. User A cannot download User B's document in another workspace", async () => {
    const a = await register(app);
    const b = await register(app);
    const workspaceB = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", b.cookie)
      .send({ name: "B Files" });
    const doc = await seedDocument(workspaceB.body.workspace.id, b.userId);

    const response = await api(app)
      .get(`/api/v1/documents/${doc.id}/download`)
      .set("Cookie", a.cookie);
    expect(response.status).toBe(404);
  });

  it("3. User A cannot delete User B's document (cross-workspace or as a member)", async () => {
    const a = await register(app);
    const b = await register(app);
    const workspaceB = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", b.cookie)
      .send({ name: "B Vault" });
    const foreign = await seedDocument(workspaceB.body.workspace.id, b.userId);
    const cross = await api(app).delete(`/api/v1/documents/${foreign.id}`).set("Cookie", a.cookie);
    expect(cross.status).toBe(404);

    const shared = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", b.cookie)
      .send({ name: "Shared" });
    await prisma.workspaceMember.create({
      data: { workspaceId: shared.body.workspace.id, userId: a.userId, role: "MEMBER" },
    });
    const ownByB = await seedDocument(shared.body.workspace.id, b.userId);
    const forbidden = await api(app).delete(`/api/v1/documents/${ownByB.id}`).set("Cookie", a.cookie);
    expect(forbidden.status).toBe(403);
  });

  it("4. User A cannot create a share link for User B's document", async () => {
    const a = await register(app);
    const b = await register(app);
    const workspaceB = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", b.cookie)
      .send({ name: "B Share" });
    const doc = await seedDocument(workspaceB.body.workspace.id, b.userId);

    const response = await api(app)
      .post(`/api/v1/documents/${doc.id}/share-links`)
      .set("Cookie", a.cookie);
    expect(response.status).toBe(404);
  });

  it("lists only documents from the caller's workspace", async () => {
    const a = await register(app);
    const b = await register(app);
    const workspaceA = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", a.cookie)
      .send({ name: "A Files" });
    const workspaceB = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", b.cookie)
      .send({ name: "B Files" });
    await seedDocument(workspaceA.body.workspace.id, a.userId);
    const docB = await seedDocument(workspaceB.body.workspace.id, b.userId);

    const listA = await api(app)
      .get(`/api/v1/workspaces/${workspaceA.body.workspace.id}/documents`)
      .set("Cookie", a.cookie);
    const listBAsA = await api(app)
      .get(`/api/v1/workspaces/${workspaceB.body.workspace.id}/documents`)
      .set("Cookie", a.cookie);

    expect(listA.status).toBe(200);
    expect(listA.body.documents).toHaveLength(1);
    expect(listA.body.documents.map((row: { id: string }) => row.id)).not.toContain(docB.id);
    expect(listBAsA.status).toBe(404);
  });

  it("5. User A cannot open another workspace", async () => {
    const a = await register(app);
    const b = await register(app);
    const workspaceB = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", b.cookie)
      .send({ name: "Private" });

    const response = await api(app)
      .get(`/api/v1/workspaces/${workspaceB.body.workspace.id}`)
      .set("Cookie", a.cookie);
    expect(response.status).toBe(404);
  });

  it("6. A removed member cannot use old workspace URLs", async () => {
    const owner = await register(app);
    const member = await register(app);
    const workspace = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "Kick" });
    await prisma.workspaceMember.create({
      data: { workspaceId: workspace.body.workspace.id, userId: member.userId, role: "MEMBER" },
    });

    const before = await api(app)
      .get(`/api/v1/workspaces/${workspace.body.workspace.id}`)
      .set("Cookie", member.cookie);
    expect(before.status).toBe(200);

    const removed = await api(app)
      .delete(`/api/v1/workspaces/${workspace.body.workspace.id}/members/${member.userId}`)
      .set("Cookie", owner.cookie);
    expect(removed.status).toBe(204);

    const after = await api(app)
      .get(`/api/v1/workspaces/${workspace.body.workspace.id}`)
      .set("Cookie", member.cookie);
    expect(after.status).toBe(404);
  });

  it("7. A member cannot perform an owner-only operation", async () => {
    const owner = await register(app);
    const member = await register(app);
    const workspace = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "Owned" });
    await prisma.workspaceMember.create({
      data: { workspaceId: workspace.body.workspace.id, userId: member.userId, role: "MEMBER" },
    });

    const response = await api(app)
      .delete(`/api/v1/workspaces/${workspace.body.workspace.id}`)
      .set("Cookie", member.cookie);
    expect(response.status).toBe(403);
  });

  it("8. A member cannot perform an admin-only operation", async () => {
    const owner = await register(app);
    const member = await register(app);
    const workspace = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "Staff" });
    await prisma.workspaceMember.create({
      data: { workspaceId: workspace.body.workspace.id, userId: member.userId, role: "MEMBER" },
    });

    const response = await api(app)
      .post(`/api/v1/workspaces/${workspace.body.workspace.id}/invitations`)
      .set("Cookie", member.cookie)
      .send({ email: `invitee-${randomUUID()}@example.com` });
    expect(response.status).toBe(403);
  });

  it("9. A forged document ID is not found", async () => {
    const user = await register(app);
    const response = await api(app)
      .get(`/api/v1/documents/${randomUUID()}`)
      .set("Cookie", user.cookie);
    expect(response.status).toBe(404);
  });

  it("10. A forged workspace ID is not found", async () => {
    const user = await register(app);
    const response = await api(app)
      .get(`/api/v1/workspaces/${randomUUID()}`)
      .set("Cookie", user.cookie);
    expect(response.status).toBe(404);
  });
});
