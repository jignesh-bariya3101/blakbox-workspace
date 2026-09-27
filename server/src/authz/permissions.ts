import type { WorkspaceRole } from "@prisma/client";

export const Permission = {
  documentView: "document.view",
  documentUpload: "document.upload",
  documentDownload: "document.download",
  documentRenameOwn: "document.rename.own",
  documentRenameAny: "document.rename.any",
  documentDeleteOwn: "document.delete.own",
  documentDeleteAny: "document.delete.any",
  shareLinkCreate: "share_link.create",
  shareLinkRevokeOwn: "share_link.revoke.own",
  shareLinkRevokeAny: "share_link.revoke.any",
  memberInvite: "member.invite",
  memberInviteRevoke: "member.invite.revoke",
  memberRemoveMember: "member.remove.member",
  memberRemoveAdmin: "member.remove.admin",
  memberLeave: "member.leave",
  memberChangeRole: "member.change_role",
  workspaceTransfer: "workspace.transfer",
  workspaceDelete: "workspace.delete",
  auditView: "audit.view",
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];

const ALL: Permission[] = Object.values(Permission);

const ADMIN: Permission[] = ALL.filter(
  (permission) =>
    permission !== Permission.memberRemoveAdmin &&
    permission !== Permission.memberChangeRole &&
    permission !== Permission.workspaceTransfer &&
    permission !== Permission.workspaceDelete,
);

const MEMBER: Permission[] = [
  Permission.documentView,
  Permission.documentUpload,
  Permission.documentDownload,
  Permission.documentRenameOwn,
  Permission.documentDeleteOwn,
  Permission.shareLinkCreate,
  Permission.shareLinkRevokeOwn,
  Permission.memberLeave,
];

const MATRIX: Record<WorkspaceRole, ReadonlySet<Permission>> = {
  OWNER: new Set(ALL.filter((permission) => permission !== Permission.memberLeave)),
  ADMIN: new Set(ADMIN),
  MEMBER: new Set(MEMBER),
};

export function can(role: WorkspaceRole, permission: Permission): boolean {
  return MATRIX[role].has(permission);
}
