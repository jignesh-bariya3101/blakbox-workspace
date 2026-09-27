import { randomBytes } from "node:crypto";
import { ValidationError } from "../common/errors";

export function buildObjectKey(workspaceId: string, documentId: string): string {
  const suffix = randomBytes(16).toString("hex");
  const key = `workspaces/${workspaceId}/documents/${documentId}/${suffix}`;
  assertSafeObjectKey(key);
  return key;
}

export function assertSafeObjectKey(key: string) {
  if (key.includes("..") || key.includes("\\") || key.startsWith("/") || key.includes("\0")) {
    throw new ValidationError("Invalid storage key");
  }
}
