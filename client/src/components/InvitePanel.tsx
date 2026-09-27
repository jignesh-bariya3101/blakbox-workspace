import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { createInvitation, listInvitations, revokeInvitation } from "../api";
import { forgetGeneratedToken, getGeneratedToken, rememberGeneratedToken } from "../generated-tokens";
import { SecretLinkRow } from "./SecretLinkRow";

const schema = z.object({
  email: z.string().email("Enter a valid email"),
});

type FormValues = z.infer<typeof schema>;

export function InvitePanel({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const form = useForm<FormValues>({ resolver: zodResolver(schema) });
  const invitations = useQuery({
    queryKey: ["invitations", workspaceId],
    queryFn: () => listInvitations(workspaceId),
  });

  const create = useMutation({
    mutationFn: (email: string) => createInvitation(workspaceId, email),
    onSuccess: async (result) => {
      rememberGeneratedToken(
        "invite",
        result.invitation.id,
        result.invitation.token,
        result.invitation.expiresAt,
      );
      const url = `${window.location.origin}/invite/${result.invitation.token}`;
      await navigator.clipboard.writeText(url).catch(() => undefined);
      form.reset();
      await queryClient.invalidateQueries({ queryKey: ["invitations", workspaceId] });
    },
  });

  const revoke = useMutation({
    mutationFn: (invitationId: string) => revokeInvitation(workspaceId, invitationId),
    onSuccess: async (_data, invitationId) => {
      forgetGeneratedToken("invite", invitationId);
      await queryClient.invalidateQueries({ queryKey: ["invitations", workspaceId] });
    },
  });

  return (
    <section className="invite-panel">
      <h2>Invite people</h2>
      <p className="hint">No email is sent. The link stays on this page until it expires or you revoke it.</p>
      <form className="form" onSubmit={form.handleSubmit((values) => create.mutate(values.email))}>
        <label>
          Email
          <input type="email" placeholder="teammate@company.com" {...form.register("email")} />
        </label>
        {form.formState.errors.email ? (
          <p className="field-error">{form.formState.errors.email.message}</p>
        ) : null}
        {create.error ? <p className="form-error">{create.error.message}</p> : null}
        <button className="btn btn-primary" type="submit" disabled={create.isPending}>
          {create.isPending ? "Creating…" : "Create invite link"}
        </button>
      </form>
      {invitations.data?.invitations.length ? (
        <ul className="share-list">
          {invitations.data.invitations.map((invitation) => {
            const token = getGeneratedToken("invite", invitation.id);
            return (
              <SecretLinkRow
                key={invitation.id}
                label={invitation.email}
                url={token ? `${window.location.origin}/invite/${token}` : undefined}
                expiresAt={invitation.expiresAt}
                onRevoke={() => revoke.mutate(invitation.id)}
                revokePending={revoke.isPending}
              />
            );
          })}
        </ul>
      ) : (
        <p className="hint">No pending invitations.</p>
      )}
    </section>
  );
}
