import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuditAction } from "../src/audit/audit.actions";
import { api, startTestApp } from "./app-request";
import { prisma } from "./helpers";

async function register(app: INestApplication) {
  const email = `audit-${randomUUID()}@example.com`;
  const response = await api(app).post("/api/v1/auth/register").send({
    email,
    password: "password1",
  });
  const setCookie = response.headers["set-cookie"];
  const cookie = Array.isArray(setCookie) ? setCookie[0] : String(setCookie);
  return { email, cookie, userId: response.body.user.id as string };
}

describe("audit", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await startTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("records workspace and document events without secrets", async () => {
    const owner = await register(app);
    const workspace = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .set("x-request-id", "audit-req-1")
      .send({ name: "Ledger" });
    const upload = await api(app)
      .post(`/api/v1/workspaces/${workspace.body.workspace.id}/documents`)
      .set("Cookie", owner.cookie)
      .attach("file", Buffer.from("bytes"), { filename: "notes.txt", contentType: "text/plain" });
    const share = await api(app)
      .post(`/api/v1/documents/${upload.body.document.id}/share-links`)
      .set("Cookie", owner.cookie)
      .send({});

    const listed = await api(app)
      .get(`/api/v1/workspaces/${workspace.body.workspace.id}/audit`)
      .set("Cookie", owner.cookie);
    expect(listed.status).toBe(200);
    const actions = listed.body.events.map((event: { action: string }) => event.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        AuditAction.workspaceCreated,
        AuditAction.documentUploaded,
        AuditAction.shareLinkCreated,
      ]),
    );
    expect(JSON.stringify(listed.body)).not.toMatch(/password|tokenHash|MINIO|workspaces\//i);
    expect(JSON.stringify(listed.body)).not.toContain(share.body.shareLink.token);
    expect(listed.body.events.some((event: { requestId: string }) => event.requestId === "audit-req-1")).toBe(
      true,
    );
  });

  it("is not an authorization bypass", async () => {
    const owner = await register(app);
    const member = await register(app);
    const outsider = await register(app);
    const workspace = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "Private Ledger" });
    await prisma.workspaceMember.create({
      data: { workspaceId: workspace.body.workspace.id, userId: member.userId, role: "MEMBER" },
    });

    const asMember = await api(app)
      .get(`/api/v1/workspaces/${workspace.body.workspace.id}/audit`)
      .set("Cookie", member.cookie);
    const asOutsider = await api(app)
      .get(`/api/v1/workspaces/${workspace.body.workspace.id}/audit`)
      .set("Cookie", outsider.cookie);
    const otherWorkspace = await api(app)
      .get(`/api/v1/workspaces/${randomUUID()}/audit`)
      .set("Cookie", owner.cookie);

    expect(asMember.status).toBe(403);
    expect(asOutsider.status).toBe(404);
    expect(otherWorkspace.status).toBe(404);
  });

  it("does not audit a failed public share download", async () => {
    const owner = await register(app);
    const workspace = await api(app)
      .post("/api/v1/workspaces")
      .set("Cookie", owner.cookie)
      .send({ name: "Quiet" });
    const before = await prisma.auditEvent.count({
      where: { workspaceId: workspace.body.workspace.id, action: AuditAction.shareLinkDownloaded },
    });
    await api(app).get("/api/v1/share/not-a-valid-share-token-value-xxxxxxx/download");
    const after = await prisma.auditEvent.count({
      where: { workspaceId: workspace.body.workspace.id, action: AuditAction.shareLinkDownloaded },
    });
    expect(after).toBe(before);
  });
});
