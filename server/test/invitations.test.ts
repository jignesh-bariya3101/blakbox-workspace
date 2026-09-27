import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateOpaqueToken } from "../src/common/tokens";
import { api, startTestApp } from "./app-request";
import { prisma } from "./helpers";

async function register(app: INestApplication, email = `inv-${randomUUID()}@example.com`) {
  const response = await api(app).post("/api/v1/auth/register").send({
    email,
    password: "password1",
  });
  const setCookie = response.headers["set-cookie"];
  const cookie = Array.isArray(setCookie) ? setCookie[0] : String(setCookie);
  return { email, cookie, userId: response.body.user.id as string };
}

describe("invitations", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await startTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("lets an existing user accept a valid invite", async () => {
    const owner = await register(app);
    const invitee = await register(app);
    const workspace = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "Invitees" });
    const created = await api(app)
      .post(`/api/v1/workspaces/${workspace.body.workspace.id}/invitations`)
      .set("Cookie", owner.cookie)
      .send({ email: invitee.email });

    expect(created.status).toBe(201);
    expect(created.body.invitation.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(created.body)).not.toMatch(/tokenHash/);

    const leaked = await api(app)
      .get(`/api/v1/invitations/lookup?token=${created.body.invitation.token}`)
      .set("Cookie", invitee.cookie);
    expect(leaked.status).toBe(404);

    const preview = await api(app)
      .post("/api/v1/invitations/lookup")
      .set("Cookie", invitee.cookie)
      .send({ token: created.body.invitation.token });
    expect(preview.status).toBe(200);
    expect(preview.body.invitation.email).toBe(invitee.email);
    expect(JSON.stringify(preview.body)).not.toMatch(/tokenHash/);

    const accepted = await api(app)
      .post("/api/v1/invitations/accept")
      .set("Cookie", invitee.cookie)
      .send({ token: created.body.invitation.token });
    expect(accepted.status).toBe(201);
    expect(accepted.body.workspace.id).toBe(workspace.body.workspace.id);

    const opened = await api(app)
      .get(`/api/v1/workspaces/${workspace.body.workspace.id}`)
      .set("Cookie", invitee.cookie);
    expect(opened.status).toBe(200);
  });

  it("requires register then accept for users without accounts", async () => {
    const owner = await register(app);
    const email = `new-${randomUUID()}@example.com`;
    const workspace = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "Newcomers" });
    const created = await api(app)
      .post(`/api/v1/workspaces/${workspace.body.workspace.id}/invitations`)
      .set("Cookie", owner.cookie)
      .send({ email });

    const registered = await register(app, email);
    const accepted = await api(app)
      .post("/api/v1/invitations/accept")
      .set("Cookie", registered.cookie)
      .send({ token: created.body.invitation.token });
    expect(accepted.status).toBe(201);
  });

  it("rejects wrong email, replaced tokens, expired, revoked, and deleted workspaces", async () => {
    const owner = await register(app);
    const invitee = await register(app);
    const stranger = await register(app);
    const workspace = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "Secrets" });

    const first = await api(app)
      .post(`/api/v1/workspaces/${workspace.body.workspace.id}/invitations`)
      .set("Cookie", owner.cookie)
      .send({ email: invitee.email });
    const second = await api(app)
      .post(`/api/v1/workspaces/${workspace.body.workspace.id}/invitations`)
      .set("Cookie", owner.cookie)
      .send({ email: invitee.email });

    const wrong = await api(app)
      .post("/api/v1/invitations/accept")
      .set("Cookie", stranger.cookie)
      .send({ token: second.body.invitation.token });
    const replaced = await api(app)
      .post("/api/v1/invitations/accept")
      .set("Cookie", invitee.cookie)
      .send({ token: first.body.invitation.token });
    const invalid = await api(app)
      .post("/api/v1/invitations/accept")
      .set("Cookie", invitee.cookie)
      .send({ token: generateOpaqueToken() });

    expect(wrong.status).toBe(404);
    expect(replaced.status).toBe(404);
    expect(invalid.status).toBe(404);
    expect(wrong.body.error.message).toBe(invalid.body.error.message);
    expect(JSON.stringify(wrong.body)).not.toContain(second.body.invitation.token);

    await prisma.workspaceInvitation.update({
      where: { id: second.body.invitation.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await api(app)
      .post("/api/v1/invitations/accept")
      .set("Cookie", invitee.cookie)
      .send({ token: second.body.invitation.token });
    expect(expired.status).toBe(404);

    const live = await api(app)
      .post(`/api/v1/workspaces/${workspace.body.workspace.id}/invitations`)
      .set("Cookie", owner.cookie)
      .send({ email: invitee.email });
    await api(app)
      .delete(`/api/v1/workspaces/${workspace.body.workspace.id}/invitations/${live.body.invitation.id}`)
      .set("Cookie", owner.cookie);
    const revoked = await api(app)
      .post("/api/v1/invitations/accept")
      .set("Cookie", invitee.cookie)
      .send({ token: live.body.invitation.token });
    expect(revoked.status).toBe(404);

    const doomed = await api(app)
      .post(`/api/v1/workspaces/${workspace.body.workspace.id}/invitations`)
      .set("Cookie", owner.cookie)
      .send({ email: stranger.email });
    await api(app)
      .delete(`/api/v1/workspaces/${workspace.body.workspace.id}`)
      .set("Cookie", owner.cookie);
    const deletedWs = await api(app)
      .post("/api/v1/invitations/accept")
      .set("Cookie", stranger.cookie)
      .send({ token: doomed.body.invitation.token });
    expect(deletedWs.status).toBe(404);
  });

  it("rejects already-member create/accept and a second accept", async () => {
    const owner = await register(app);
    const member = await register(app);
    const workspace = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "Full" });
    await prisma.workspaceMember.create({
      data: { workspaceId: workspace.body.workspace.id, userId: member.userId, role: "MEMBER" },
    });

    const createAgain = await api(app)
      .post(`/api/v1/workspaces/${workspace.body.workspace.id}/invitations`)
      .set("Cookie", owner.cookie)
      .send({ email: member.email });
    expect(createAgain.status).toBe(409);

    const invitee = await register(app);
    const created = await api(app)
      .post(`/api/v1/workspaces/${workspace.body.workspace.id}/invitations`)
      .set("Cookie", owner.cookie)
      .send({ email: invitee.email });
    const first = await api(app)
      .post("/api/v1/invitations/accept")
      .set("Cookie", invitee.cookie)
      .send({ token: created.body.invitation.token });
    const second = await api(app)
      .post("/api/v1/invitations/accept")
      .set("Cookie", invitee.cookie)
      .send({ token: created.body.invitation.token });
    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
  });

  it("allows only one concurrent accept to create membership", async () => {
    const owner = await register(app);
    const invitee = await register(app);
    const workspace = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "Race" });
    const created = await api(app)
      .post(`/api/v1/workspaces/${workspace.body.workspace.id}/invitations`)
      .set("Cookie", owner.cookie)
      .send({ email: invitee.email });

    const [a, b] = await Promise.all([
      api(app)
        .post("/api/v1/invitations/accept")
        .set("Cookie", invitee.cookie)
        .send({ token: created.body.invitation.token }),
      api(app)
        .post("/api/v1/invitations/accept")
        .set("Cookie", invitee.cookie)
        .send({ token: created.body.invitation.token }),
    ]);

    const statuses = [a.status, b.status];
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.every((status) => status === 201 || status === 409)).toBe(true);
    expect(
      await prisma.workspaceMember.count({
        where: { workspaceId: workspace.body.workspace.id, userId: invitee.userId },
      }),
    ).toBe(1);
  });

  it("does not re-check a demoted inviter, but revoked invites from a removed inviter fail", async () => {
    const owner = await register(app);
    const admin = await register(app);
    const invitee = await register(app);
    const workspace = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "Staff" });
    await prisma.workspaceMember.create({
      data: { workspaceId: workspace.body.workspace.id, userId: admin.userId, role: "ADMIN" },
    });

    const created = await api(app)
      .post(`/api/v1/workspaces/${workspace.body.workspace.id}/invitations`)
      .set("Cookie", admin.cookie)
      .send({ email: invitee.email });
    await api(app)
      .patch(`/api/v1/workspaces/${workspace.body.workspace.id}/members/${admin.userId}`)
      .set("Cookie", owner.cookie)
      .send({ role: "MEMBER" });
    const afterDemote = await api(app)
      .post("/api/v1/invitations/accept")
      .set("Cookie", invitee.cookie)
      .send({ token: created.body.invitation.token });
    expect(afterDemote.status).toBe(201);

    const other = await register(app);
    const later = await api(app)
      .post(`/api/v1/workspaces/${workspace.body.workspace.id}/invitations`)
      .set("Cookie", owner.cookie)
      .send({ email: other.email });
    await prisma.workspaceInvitation.update({
      where: { id: later.body.invitation.id },
      data: { invitedById: admin.userId },
    });
    await api(app)
      .delete(`/api/v1/workspaces/${workspace.body.workspace.id}/members/${admin.userId}`)
      .set("Cookie", owner.cookie);
    const afterRemove = await api(app)
      .post("/api/v1/invitations/accept")
      .set("Cookie", other.cookie)
      .send({ token: later.body.invitation.token });
    expect(afterRemove.status).toBe(404);
  });
});
