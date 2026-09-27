import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router-dom";
import { z } from "zod";
import {
  deleteDocument,
  downloadDocument,
  getDocument,
  getMe,
  getWorkspace,
  renameDocument,
} from "../api";
import { AppHeader } from "../components/AppHeader";
import { ShareControls } from "../components/ShareControls";
import { StatusPage } from "../components/StatusPage";
import { canChangeThisDocument } from "../permissions";
import { hasSession, queryErrorMessage, queryStatusKind } from "../query-status";

const renameSchema = z.object({
  filename: z.string().trim().min(1, "Enter a filename").max(255, "Keep the name under 255 characters"),
});

type RenameValues = z.infer<typeof renameSchema>;

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentPage() {
  const { workspaceId = "", documentId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const me = useQuery({ queryKey: ["me"], queryFn: getMe, retry: false });
  const documentQuery = useQuery({
    queryKey: ["document", documentId],
    queryFn: () => getDocument(documentId),
    enabled: Boolean(hasSession(me) && documentId),
    retry: false,
  });
  const workspace = useQuery({
    queryKey: ["workspace", workspaceId],
    queryFn: () => getWorkspace(workspaceId),
    enabled: Boolean(hasSession(me) && workspaceId),
    retry: false,
  });

  const form = useForm<RenameValues>({ resolver: zodResolver(renameSchema) });

  useEffect(() => {
    if (documentQuery.data?.document.filename) {
      form.reset({ filename: documentQuery.data.document.filename });
    }
  }, [documentQuery.data?.document.filename, form]);

  const rename = useMutation({
    mutationFn: (filename: string) => renameDocument(documentId, filename),
    onSuccess: async () => {
      form.reset();
      await queryClient.invalidateQueries({ queryKey: ["document", documentId] });
      await queryClient.invalidateQueries({ queryKey: ["documents", workspaceId] });
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteDocument(documentId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["documents", workspaceId] });
      navigate(`/workspaces/${workspaceId}`);
    },
  });

  if (me.isPending || documentQuery.isPending) {
    return (
      <div className="shell">
        <AppHeader />
        <main className="dashboard">
          <p className="lede">Loading document…</p>
        </main>
      </div>
    );
  }

  if (me.isError) {
    return (
      <StatusPage
        title="Sign in required"
        body="You need an account session to open this document."
        action={{ to: "/login", label: "Sign in" }}
      />
    );
  }

  if (documentQuery.isError) {
    const kind = queryStatusKind(documentQuery.error);
    if (kind === "notfound" || kind === "forbidden") {
      return (
        <StatusPage
          title="Document not found"
          body="This file is missing, deleted, or not visible from your workspace."
        />
      );
    }
    return (
      <StatusPage
        title="Could not load document"
        body={queryErrorMessage(documentQuery.error, "The API did not return this document.")}
      />
    );
  }

  const doc = documentQuery.data.document;
  if (doc.workspaceId !== workspaceId) {
    return (
      <StatusPage
        title="Document not found"
        body="This file does not belong to the workspace in the URL."
      />
    );
  }

  const role = workspace.data?.workspace.role;
  const canChange = canChangeThisDocument(role, doc.uploadedById, me.data.user.id);

  return (
    <div className="shell">
      <AppHeader />
      <main className="dashboard">
        <p className="crumb">
          <Link to={`/workspaces/${workspaceId}`}>Workspace</Link>
        </p>
        <h1>{doc.filename}</h1>
        <p className="lede">
          {formatBytes(doc.byteSize)} · {doc.mimeType} · uploaded{" "}
          {new Date(doc.createdAt).toLocaleString()}
        </p>
        <div className="row-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setDownloadError(null);
              void downloadDocument(doc.id, doc.filename).catch((error: Error) => {
                setDownloadError(error.message);
              });
            }}
          >
            Download
          </button>
          {canChange ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
            >
              {remove.isPending ? "Deleting…" : "Delete"}
            </button>
          ) : null}
        </div>
        {downloadError ? <p className="form-error">{downloadError}</p> : null}
        {remove.error ? <p className="form-error">{remove.error.message}</p> : null}

        {canChange ? (
          <form
            className="form"
            onSubmit={form.handleSubmit((values) => rename.mutate(values.filename))}
          >
            <label>
              Rename
              <input maxLength={255} {...form.register("filename")} />
            </label>
            {form.formState.errors.filename ? (
              <p className="field-error">{form.formState.errors.filename.message}</p>
            ) : null}
            {rename.error ? <p className="form-error">{rename.error.message}</p> : null}
            <button className="btn btn-primary" type="submit" disabled={rename.isPending}>
              {rename.isPending ? "Saving…" : "Save name"}
            </button>
          </form>
        ) : null}

        <section className="invite-panel">
          <h2>Share links</h2>
          <p className="hint">Anyone with an active link can download this file until you revoke it.</p>
          <ShareControls documentId={doc.id} role={role} />
        </section>
      </main>
    </div>
  );
}
