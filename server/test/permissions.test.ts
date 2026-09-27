import { describe, expect, it } from "vitest";
import { can, Permission } from "../src/authz/permissions";

describe("permission matrix", () => {
  it("lets a member view and delete their own document, not someone else's", () => {
    expect(can("MEMBER", Permission.documentView)).toBe(true);
    expect(can("MEMBER", Permission.documentDeleteOwn)).toBe(true);
    expect(can("MEMBER", Permission.documentDeleteAny)).toBe(false);
  });

  it("keeps owner-only and admin-only actions off members", () => {
    expect(can("MEMBER", Permission.workspaceDelete)).toBe(false);
    expect(can("MEMBER", Permission.memberInvite)).toBe(false);
    expect(can("ADMIN", Permission.workspaceDelete)).toBe(false);
    expect(can("ADMIN", Permission.memberLeave)).toBe(true);
    expect(can("OWNER", Permission.memberLeave)).toBe(false);
    expect(can("ADMIN", Permission.memberInvite)).toBe(true);
    expect(can("OWNER", Permission.workspaceDelete)).toBe(true);
    expect(can("MEMBER", Permission.auditView)).toBe(false);
    expect(can("ADMIN", Permission.auditView)).toBe(true);
    expect(can("OWNER", Permission.auditView)).toBe(true);
  });
});
