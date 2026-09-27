export type PublicUser = {
  id: string;
  email: string;
};

export type ApiError = {
  error: { code: string; message: string };
  requestId: string;
};

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");

export function apiUrl(path: string) {
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

async function parseJson<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      ...init,
      headers,
      credentials: "include",
    });
  } catch {
    throw new ApiRequestError(0, "network_error", "Network error. Try again.");
  }

  const body = await parseJson<T | ApiError>(response);
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? body.error.message
        : `Request failed: ${response.status}`;
    const code =
      body && typeof body === "object" && "error" in body ? body.error.code : "request_failed";
    throw new ApiRequestError(response.status, code, message);
  }
  return body as T;
}

export function getMe() {
  return api<{ user: PublicUser }>("/api/v1/auth/me");
}

export function register(email: string, password: string) {
  return api<{ user: PublicUser }>("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function login(email: string, password: string) {
  return api<{ user: PublicUser }>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function logout() {
  return api<void>("/api/v1/auth/logout", { method: "POST" });
}

export type Workspace = {
  id: string;
  name: string;
  role?: string;
  createdAt: string;
};

export function listWorkspaces() {
  return api<{ workspaces: Workspace[] }>("/api/v1/workspaces");
}

export function createWorkspace(name: string) {
  return api<{ workspace: Workspace }>("/api/v1/workspaces", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function getWorkspace(workspaceId: string) {
  return api<{ workspace: Workspace }>(`/api/v1/workspaces/${workspaceId}`);
}

export type Member = {
  userId: string;
  email: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
};

export function listMembers(workspaceId: string) {
  return api<{ members: Member[] }>(`/api/v1/workspaces/${workspaceId}/members`);
}

export function removeMember(workspaceId: string, userId: string) {
  return api<void>(`/api/v1/workspaces/${workspaceId}/members/${userId}`, { method: "DELETE" });
}

export function changeMemberRole(workspaceId: string, userId: string, role: "ADMIN" | "MEMBER") {
  return api<void>(`/api/v1/workspaces/${workspaceId}/members/${userId}`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
}

export type AuditEvent = {
  id: string;
  actorUserId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  requestId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export function listAuditEvents(workspaceId: string, cursor?: string) {
  const query = new URLSearchParams({ limit: "20" });
  if (cursor) query.set("cursor", cursor);
  return api<{ events: AuditEvent[]; nextCursor: string | null }>(
    `/api/v1/workspaces/${workspaceId}/audit?${query.toString()}`,
  );
}

export function transferOwnership(workspaceId: string, userId: string) {
  return api<void>(`/api/v1/workspaces/${workspaceId}/transfer`, {
    method: "POST",
    body: JSON.stringify({ userId }),
  });
}

export function deleteWorkspace(workspaceId: string) {
  return api<void>(`/api/v1/workspaces/${workspaceId}`, { method: "DELETE" });
}

export type PendingInvitation = {
  id: string;
  email: string;
  expiresAt: string;
  createdAt: string;
};

export function listInvitations(workspaceId: string) {
  return api<{ invitations: PendingInvitation[] }>(`/api/v1/workspaces/${workspaceId}/invitations`);
}

export function createInvitation(workspaceId: string, email: string) {
  return api<{ invitation: { id: string; email: string; token: string; expiresAt: string } }>(
    `/api/v1/workspaces/${workspaceId}/invitations`,
    { method: "POST", body: JSON.stringify({ email }) },
  );
}

export function revokeInvitation(workspaceId: string, invitationId: string) {
  return api<void>(`/api/v1/workspaces/${workspaceId}/invitations/${invitationId}`, {
    method: "DELETE",
  });
}

export function lookupInvitation(token: string) {
  return api<{ invitation: { email: string; expiresAt: string; workspaceName: string } }>(
    "/api/v1/invitations/lookup",
    { method: "POST", body: JSON.stringify({ token }) },
  );
}

export function acceptInvitation(token: string) {
  return api<{ workspace: Workspace }>("/api/v1/invitations/accept", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export type DocumentItem = {
  id: string;
  filename: string;
  byteSize: number;
  mimeType: string;
  uploadedById: string;
  createdAt: string;
};

export function getDocument(documentId: string) {
  return api<{ document: DocumentItem & { workspaceId: string } }>(`/api/v1/documents/${documentId}`);
}

export function listDocuments(workspaceId: string, cursor?: string) {
  const query = new URLSearchParams({ limit: "20" });
  if (cursor) query.set("cursor", cursor);
  return api<{ documents: DocumentItem[]; nextCursor: string | null }>(
    `/api/v1/workspaces/${workspaceId}/documents?${query.toString()}`,
  );
}

export function renameDocument(documentId: string, filename: string) {
  return api<{ document: DocumentItem }>(`/api/v1/documents/${documentId}`, {
    method: "PATCH",
    body: JSON.stringify({ filename }),
  });
}

export async function uploadDocument(workspaceId: string, file: File) {
  const body = new FormData();
  body.append("file", file);
  let response: Response;
  try {
    response = await fetch(apiUrl(`/api/v1/workspaces/${workspaceId}/documents`), {
      method: "POST",
      body,
      credentials: "include",
    });
  } catch {
    throw new ApiRequestError(0, "network_error", "Network error. Try again.");
  }
  const payload = (await response.json()) as { document: DocumentItem } | ApiError;
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? payload.error.message
        : `Request failed: ${response.status}`;
    const code =
      payload && typeof payload === "object" && "error" in payload
        ? payload.error.code
        : "request_failed";
    throw new ApiRequestError(response.status, code, message);
  }
  return payload as { document: DocumentItem };
}

export async function downloadDocument(documentId: string, filename: string) {
  let response: Response;
  try {
    response = await fetch(apiUrl(`/api/v1/documents/${documentId}/download`), {
      credentials: "include",
    });
  } catch {
    throw new ApiRequestError(0, "network_error", "Network error. Try again.");
  }
  if (!response.ok) {
    throw new ApiRequestError(response.status, "download_failed", "Download failed");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function deleteDocument(documentId: string) {
  return api<void>(`/api/v1/documents/${documentId}`, { method: "DELETE" });
}

export type ShareLink = {
  id: string;
  expiresAt: string;
  createdAt: string;
  mine: boolean;
};

export function listShareLinks(documentId: string) {
  return api<{ shareLinks: ShareLink[] }>(`/api/v1/documents/${documentId}/share-links`);
}

export function createShareLink(documentId: string, expiresAt?: string) {
  return api<{ shareLink: { id: string; token: string; expiresAt: string } }>(
    `/api/v1/documents/${documentId}/share-links`,
    {
      method: "POST",
      body: JSON.stringify(expiresAt ? { expiresAt } : {}),
    },
  );
}

export function revokeShareLink(shareLinkId: string) {
  return api<void>(`/api/v1/share-links/${shareLinkId}`, { method: "DELETE" });
}
