import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createShareLink, listShareLinks, revokeShareLink } from "../api";
import { forgetGeneratedToken, getGeneratedToken, rememberGeneratedToken } from "../generated-tokens";
import { canRevokeShareLink } from "../permissions";
import { SecretLinkRow } from "./SecretLinkRow";

export function ShareControls({ documentId, role }: { documentId: string; role?: string }) {
  const queryClient = useQueryClient();
  const links = useQuery({
    queryKey: ["share-links", documentId],
    queryFn: () => listShareLinks(documentId),
  });

  const create = useMutation({
    mutationFn: () => createShareLink(documentId),
    onSuccess: async (result) => {
      rememberGeneratedToken("share", result.shareLink.id, result.shareLink.token, result.shareLink.expiresAt);
      const url = `${window.location.origin}/share/${result.shareLink.token}`;
      await navigator.clipboard.writeText(url).catch(() => undefined);
      await queryClient.invalidateQueries({ queryKey: ["share-links", documentId] });
    },
  });

  const revoke = useMutation({
    mutationFn: revokeShareLink,
    onSuccess: async (_data, shareLinkId) => {
      forgetGeneratedToken("share", shareLinkId);
      await queryClient.invalidateQueries({ queryKey: ["share-links", documentId] });
    },
  });

  return (
    <div className="share-box">
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => create.mutate()}
        disabled={create.isPending}
      >
        {create.isPending ? "Creating…" : "Create share link"}
      </button>
      {create.error ? <p className="form-error">{create.error.message}</p> : null}
      {links.data?.shareLinks.length ? (
        <ul className="share-list">
          {links.data.shareLinks.map((link) => {
            const token = getGeneratedToken("share", link.id);
            return (
              <SecretLinkRow
                key={link.id}
                label="Share link"
                url={token ? `${window.location.origin}/share/${token}` : undefined}
                expiresAt={link.expiresAt}
                onRevoke={
                  canRevokeShareLink(role, link.mine) ? () => revoke.mutate(link.id) : undefined
                }
                revokePending={revoke.isPending}
              />
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
