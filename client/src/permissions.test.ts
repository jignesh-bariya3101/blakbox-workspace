import { describe, expect, it } from "vitest";
import {
  canChangeThisDocument,
  canDeleteWorkspace,
  canInvite,
  canRevokeShareLink,
} from "./permissions";

describe("permission UX helpers", () => {
  it("lets members change only their own files and revoke only their own links", () => {
    expect(canChangeThisDocument("MEMBER", "uploader", "uploader")).toBe(true);
    expect(canChangeThisDocument("MEMBER", "uploader", "other")).toBe(false);
    expect(canRevokeShareLink("MEMBER", true)).toBe(true);
    expect(canRevokeShareLink("MEMBER", false)).toBe(false);
    expect(canInvite("MEMBER")).toBe(false);
    expect(canDeleteWorkspace("MEMBER")).toBe(false);
    expect(canDeleteWorkspace("ADMIN")).toBe(false);
    expect(canDeleteWorkspace("OWNER")).toBe(true);
  });

  it("lets staff invite and manage other people's files and links", () => {
    expect(canInvite("ADMIN")).toBe(true);
    expect(canInvite("OWNER")).toBe(true);
    expect(canChangeThisDocument("ADMIN", "uploader", "other")).toBe(true);
    expect(canRevokeShareLink("OWNER", false)).toBe(true);
  });
});
