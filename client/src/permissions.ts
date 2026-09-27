export function isStaff(role?: string) {
  return role === "OWNER" || role === "ADMIN";
}

export function canInvite(role?: string) {
  return isStaff(role);
}

export function canDeleteWorkspace(role?: string) {
  return role === "OWNER";
}

export function canManageOthersDocuments(role?: string) {
  return isStaff(role);
}

export function canChangeThisDocument(role: string | undefined, uploadedById: string, userId: string) {
  return uploadedById === userId || canManageOthersDocuments(role);
}

export function canRevokeShareLink(role: string | undefined, mine: boolean) {
  return mine || isStaff(role);
}
