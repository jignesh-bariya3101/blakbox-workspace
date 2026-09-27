import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { deleteDocument, downloadDocument, renameDocument, type DocumentItem } from "../api";
import { canChangeThisDocument } from "../permissions";
import { ShareControls } from "./ShareControls";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentList({
  workspaceId,
  documents,
  nextCursor,
  currentUserId,
  role,
  onLoadMore,
  loadingMore,
}: {
  workspaceId: string;
  documents: DocumentItem[];
  nextCursor: string | null;
  currentUserId: string;
  role?: string;
  onLoadMore: () => void;
  loadingMore: boolean;
}) {
  const queryClient = useQueryClient();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [nextName, setNextName] = useState("");
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const rename = useMutation({
    mutationFn: () => renameDocument(renamingId!, nextName),
    onSuccess: async () => {
      setRenamingId(null);
      await queryClient.invalidateQueries({ queryKey: ["documents", workspaceId] });
    },
  });

  const remove = useMutation({
    mutationFn: deleteDocument,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["documents", workspaceId] });
    },
  });

  if (!documents.length) {
    return (
      <div className="empty">
        <strong>No files yet.</strong>
        <p>Upload a document to keep it inside this workspace.</p>
      </div>
    );
  }

  return (
    <>
      <ul className="document-list">
        {documents.map((doc) => {
          const canChange = canChangeThisDocument(role, doc.uploadedById, currentUserId);
          return (
            <li key={doc.id} className="document-row">
              <div>
                {renamingId === doc.id ? (
                  <form
                    className="inline-rename"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (nextName.trim()) rename.mutate();
                    }}
                  >
                    <input
                      value={nextName}
                      onChange={(event) => setNextName(event.target.value)}
                      maxLength={255}
                    />
                    <button className="btn btn-primary" type="submit" disabled={rename.isPending}>
                      Save
                    </button>
                  </form>
                ) : (
                  <strong>
                    <Link to={`/workspaces/${workspaceId}/documents/${doc.id}`}>{doc.filename}</Link>
                  </strong>
                )}
                <p>
                  {formatBytes(doc.byteSize)} · {doc.mimeType}
                </p>
              </div>
              <div className="row-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
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
                    onClick={() => {
                      setRenamingId(doc.id);
                      setNextName(doc.filename);
                    }}
                  >
                    Rename
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setSharingId(sharingId === doc.id ? null : doc.id)}
                >
                  Share
                </button>
                {canChange ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => remove.mutate(doc.id)}
                  >
                    Delete
                  </button>
                ) : null}
              </div>
              {sharingId === doc.id ? (
                <ShareControls documentId={doc.id} role={role} />
              ) : null}
            </li>
          );
        })}
      </ul>
      {nextCursor ? (
        <button type="button" className="btn btn-ghost" onClick={onLoadMore} disabled={loadingMore}>
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      ) : null}
      {downloadError ? <p className="form-error">{downloadError}</p> : null}
      {rename.error ? <p className="form-error">{rename.error.message}</p> : null}
      {remove.error ? <p className="form-error">{remove.error.message}</p> : null}
    </>
  );
}
