import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, startTestApp } from "./app-request";
import { prisma } from "./helpers";

async function register(app: INestApplication) {
  const email = `mem-${randomUUID()}@example.com`;
  const response = await api(app).post("/api/v1/auth/register").send({
    email,
    password: "password1",
  });
  const setCookie = response.headers["set-cookie"];
  const cookie = Array.isArray(setCookie) ? setCookie[0] : String(setCookie);
  return { email, cookie, userId: response.body.user.id as string };
}

async function addMember(workspaceId: string, userId: string, role: "ADMIN" | "MEMBER") {
  return prisma.workspaceMember.create({
    data: { workspaceId, userId, role },
  });
}

describe("membership", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await startTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("lists members only for people in the workspace", async () => {
    const owner = await register(app);
    const outsider = await register(app);
    const member = await register(app);
    const workspace = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "People" });
    await addMember(workspace.body.workspace.id, member.userId, "MEMBER");

    const listed = await api(app)
      .get(`/api/v1/workspaces/${workspace.body.workspace.id}/members`)
      .set("Cookie", member.cookie);
    expect(listed.status).toBe(200);
    expect(listed.body.members).toHaveLength(2);

    const hidden = await api(app)
      .get(`/api/v1/workspaces/${workspace.body.workspace.id}/members`)
      .set("Cookie", outsider.cookie);
    expect(hidden.status).toBe(404);
  });

  it("lets a member leave and blocks the owner from leaving", async () => {
    const owner = await register(app);
    const member = await register(app);
    const workspace = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "Leave" });
    await addMember(workspace.body.workspace.id, member.userId, "MEMBER");

    const ownerLeave = await api(app)
      .delete(`/api/v1/workspaces/${workspace.body.workspace.id}/members/${owner.userId}`)
      .set("Cookie", owner.cookie);
    expect(ownerLeave.status).toBe(403);

    const left = await api(app)
      .delete(`/api/v1/workspaces/${workspace.body.workspace.id}/members/${member.userId}`)
      .set("Cookie", member.cookie);
    expect(left.status).toBe(204);

    const after = await api(app)
      .get(`/api/v1/workspaces/${workspace.body.workspace.id}`)
      .set("Cookie", member.cookie);
    expect(after.status).toBe(404);
  });

  it("forbids removing the owner or changing the owner role", async () => {
    const owner = await register(app);
    const admin = await register(app);
    const workspace = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "Crown" });
    await addMember(workspace.body.workspace.id, admin.userId, "ADMIN");

    const removeOwner = await api(app)
      .delete(`/api/v1/workspaces/${workspace.body.workspace.id}/members/${owner.userId}`)
      .set("Cookie", admin.cookie);
    const demoteOwner = await api(app)
      .patch(`/api/v1/workspaces/${workspace.body.workspace.id}/members/${owner.userId}`)
      .set("Cookie", owner.cookie)
      .send({ role: "ADMIN" });
    const makeOwner = await api(app)
      .patch(`/api/v1/workspaces/${workspace.body.workspace.id}/members/${admin.userId}`)
      .set("Cookie", owner.cookie)
      .send({ role: "OWNER" });

    expect(removeOwner.status).toBe(403);
    expect(demoteOwner.status).toBe(403);
    expect(makeOwner.status).toBe(400);
  });

  it("enforces who can remove whom and who can change roles", async () => {
    const owner = await register(app);
    const admin = await register(app);
    const otherAdmin = await register(app);
    const member = await register(app);
    const workspace = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "Ranks" });
    await addMember(workspace.body.workspace.id, admin.userId, "ADMIN");
    await addMember(workspace.body.workspace.id, otherAdmin.userId, "ADMIN");
    await addMember(workspace.body.workspace.id, member.userId, "MEMBER");

    const adminKicksAdmin = await api(app)
      .delete(`/api/v1/workspaces/${workspace.body.workspace.id}/members/${otherAdmin.userId}`)
      .set("Cookie", admin.cookie);
    const memberKicks = await api(app)
      .delete(`/api/v1/workspaces/${workspace.body.workspace.id}/members/${admin.userId}`)
      .set("Cookie", member.cookie);
    const adminChangesRole = await api(app)
      .patch(`/api/v1/workspaces/${workspace.body.workspace.id}/members/${member.userId}`)
      .set("Cookie", admin.cookie)
      .send({ role: "ADMIN" });
    const selfRole = await api(app)
      .patch(`/api/v1/workspaces/${workspace.body.workspace.id}/members/${owner.userId}`)
      .set("Cookie", owner.cookie)
      .send({ role: "ADMIN" });
    const ownerPromotes = await api(app)
      .patch(`/api/v1/workspaces/${workspace.body.workspace.id}/members/${member.userId}`)
      .set("Cookie", owner.cookie)
      .send({ role: "ADMIN" });

    expect(adminKicksAdmin.status).toBe(403);
    expect(memberKicks.status).toBe(403);
    expect(adminChangesRole.status).toBe(403);
    expect(selfRole.status).toBe(403);
    expect(ownerPromotes.status).toBe(204);
  });

  it("transfers ownership and keeps exactly one owner", async () => {
    const owner = await register(app);
    const member = await register(app);
    const stranger = await register(app);
    const workspace = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "Handoff" });
    await addMember(workspace.body.workspace.id, member.userId, "MEMBER");

    const badTarget = await api(app)
      .post(`/api/v1/workspaces/${workspace.body.workspace.id}/transfer`)
      .set("Cookie", owner.cookie)
      .send({ userId: stranger.userId });
    expect(badTarget.status).toBe(400);

    const transferred = await api(app)
      .post(`/api/v1/workspaces/${workspace.body.workspace.id}/transfer`)
      .set("Cookie", owner.cookie)
      .send({ userId: member.userId });
    expect(transferred.status).toBe(204);

    const owners = await prisma.workspaceMember.findMany({
      where: { workspaceId: workspace.body.workspace.id, role: "OWNER" },
    });
    expect(owners).toHaveLength(1);
    expect(owners[0]?.userId).toBe(member.userId);

    const oldOwner = await api(app)
      .get(`/api/v1/workspaces/${workspace.body.workspace.id}`)
      .set("Cookie", owner.cookie);
    expect(oldOwner.body.workspace.role).toBe("ADMIN");
  });

  it("applies concurrent role changes without creating a second owner", async () => {
    const owner = await register(app);
    const member = await register(app);
    const workspace = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "Race" });
    await addMember(workspace.body.workspace.id, member.userId, "MEMBER");

    const [a, b] = await Promise.all([
      api(app)
        .patch(`/api/v1/workspaces/${workspace.body.workspace.id}/members/${member.userId}`)
        .set("Cookie", owner.cookie)
        .send({ role: "ADMIN" }),
      api(app)
        .patch(`/api/v1/workspaces/${workspace.body.workspace.id}/members/${member.userId}`)
        .set("Cookie", owner.cookie)
        .send({ role: "MEMBER" }),
    ]);
    expect([a.status, b.status].every((status) => status === 204)).toBe(true);
    expect(
      await prisma.workspaceMember.count({
        where: { workspaceId: workspace.body.workspace.id, role: "OWNER" },
      }),
    ).toBe(1);
  });

  it("stops access immediately and keeps the removed member's documents", async () => {
    const owner = await register(app);
    const member = await register(app);
    const workspace = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "Keep" });
    await addMember(workspace.body.workspace.id, member.userId, "MEMBER");
    const upload = await api(app)
      .post(`/api/v1/workspaces/${workspace.body.workspace.id}/documents`)
      .set("Cookie", member.cookie)
      .attach("file", Buffer.from("keep me"), {
        filename: "keep.txt",
        contentType: "text/plain",
      });
    const share = await api(app)
      .post(`/api/v1/documents/${upload.body.document.id}/share-links`)
      .set("Cookie", member.cookie)
      .send({});

    const removed = await api(app)
      .delete(`/api/v1/workspaces/${workspace.body.workspace.id}/members/${member.userId}`)
      .set("Cookie", owner.cookie);
    expect(removed.status).toBe(204);

    const oldUrl = await api(app)
      .get(`/api/v1/workspaces/${workspace.body.workspace.id}/documents`)
      .set("Cookie", member.cookie);
    const stillThere = await api(app)
      .get(`/api/v1/documents/${upload.body.document.id}`)
      .set("Cookie", owner.cookie);
    const link = await prisma.shareLink.findUnique({ where: { id: share.body.shareLink.id } });

    expect(oldUrl.status).toBe(404);
    expect(stillThere.status).toBe(200);
    expect(stillThere.body.document.filename).toBe("keep.txt");
    expect(link?.revokedAt).not.toBeNull();
    expect(
      await prisma.user.findUnique({ where: { id: member.userId } }),
    ).not.toBeNull();
  });
});
