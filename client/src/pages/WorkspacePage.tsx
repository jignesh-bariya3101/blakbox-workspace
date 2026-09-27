import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { deleteWorkspace, getMe, getWorkspace, listDocuments, uploadDocument } from "../api";
import { AppHeader } from "../components/AppHeader";
import { AuditPanel } from "../components/AuditPanel";
import { DocumentList } from "../components/DocumentList";
import { InvitePanel } from "../components/InvitePanel";
import { MembersPanel } from "../components/MembersPanel";
import { StatusPage } from "../components/StatusPage";
import { UploadForm } from "../components/UploadForm";
import { canDeleteWorkspace, canInvite } from "../permissions";
import { hasSession, queryErrorMessage, queryStatusKind } from "../query-status";

export function WorkspacePage() {
  const { workspaceId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: getMe, retry: false });
  const workspace = useQuery({
    queryKey: ["workspace", workspaceId],
    queryFn: () => getWorkspace(workspaceId),
    enabled: Boolean(hasSession(me) && workspaceId),
    retry: false,
  });
  const documents = useQuery({
    queryKey: ["documents", workspaceId],
    queryFn: () => listDocuments(workspaceId),
    enabled: Boolean(hasSession(me) && workspaceId),
    retry: false,
  });

  const removeWorkspace = useMutation({
    mutationFn: () => deleteWorkspace(workspaceId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      navigate("/");
    },
  });

  const upload = useMutation({
    mutationFn: (file: File) => uploadDocument(workspaceId, file),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["documents", workspaceId] });
    },
  });

  const loadMore = useMutation({
    mutationFn: () => listDocuments(workspaceId, documents.data?.nextCursor ?? undefined),
    onSuccess: (page) => {
      queryClient.setQueryData(
        ["documents", workspaceId],
        (current: { documents: typeof page.documents; nextCursor: string | null } | undefined) => ({
          documents: [...(current?.documents ?? []), ...page.documents],
          nextCursor: page.nextCursor,
        }),
      );
    },
  });

  if (me.isPending) {
    return (
      <div className="shell">
        <AppHeader />
        <main className="dashboard">
          <p className="lede">Loading your session…</p>
        </main>
      </div>
    );
  }

  if (me.isError) {
    return (
      <StatusPage
        title="Sign in to open this workspace"
        body="This page needs an active session."
        action={{ to: "/login", label: "Sign in" }}
      />
    );
  }

  if (workspace.isPending || documents.isPending) {
    return (
      <div className="shell">
        <AppHeader />
        <main className="dashboard">
          <p className="lede">Loading workspace…</p>
        </main>
      </div>
    );
  }

  if (workspace.isError) {
    const kind = queryStatusKind(workspace.error);
    if (kind === "notfound" || kind === "forbidden") {
      return (
        <StatusPage
          title="Workspace not found"
          body="This workspace does not exist, or you are not a member of it."
        />
      );
    }
    return (
      <StatusPage
        title="Could not load workspace"
        body={queryErrorMessage(workspace.error, "The API did not return this workspace.")}
      />
    );
  }

  const role = workspace.data.workspace.role;

  return (
    <div className="shell">
      <AppHeader />
      <main className="dashboard">
        <p className="crumb">
          <Link to="/">Workspaces</Link>
        </p>
        <h1>{workspace.data.workspace.name}</h1>
        <p className="lede">
          Files are stored in object storage, not PostgreSQL. Only members of this workspace can
          upload or download them.
        </p>
        <MembersPanel
          workspaceId={workspaceId}
          currentUserId={me.data.user.id}
          currentRole={role}
        />
        {canInvite(role) ? (
          <>
            <InvitePanel workspaceId={workspaceId} />
            <AuditPanel workspaceId={workspaceId} />
          </>
        ) : null}
        {canDeleteWorkspace(role) ? (
          <p>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => removeWorkspace.mutate()}
              disabled={removeWorkspace.isPending}
            >
              {removeWorkspace.isPending ? "Deleting…" : "Delete workspace"}
            </button>
            {removeWorkspace.error ? (
              <span className="form-error"> {removeWorkspace.error.message}</span>
            ) : null}
          </p>
        ) : null}

        <UploadForm
          key={upload.data?.document.id ?? "upload"}
          pending={upload.isPending}
          error={upload.error?.message}
          onUpload={(file) => upload.mutate(file)}
        />

        {documents.isError ? (
          <p className="form-error">
            {queryErrorMessage(documents.error, "Could not load documents.")}
          </p>
        ) : (
          <DocumentList
            workspaceId={workspaceId}
            documents={documents.data?.documents ?? []}
            nextCursor={documents.data?.nextCursor ?? null}
            currentUserId={me.data.user.id}
            role={role}
            onLoadMore={() => loadMore.mutate()}
            loadingMore={loadMore.isPending}
          />
        )}
      </main>
    </div>
  );
}
