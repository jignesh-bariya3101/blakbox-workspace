import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { acceptInvitation, getMe, lookupInvitation } from "../api";
import { AppHeader } from "../components/AppHeader";
import { hasSession, queryErrorMessage, queryStatusKind } from "../query-status";

export function AcceptInvitePage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const next = `/invite/${token}`;
  const me = useQuery({ queryKey: ["me"], queryFn: getMe, retry: false });
  const lookup = useQuery({
    queryKey: ["invite", token],
    queryFn: () => lookupInvitation(token),
    enabled: Boolean(hasSession(me) && token),
    retry: false,
  });
  const accept = useMutation({
    mutationFn: () => acceptInvitation(token),
    onSuccess: (result) => {
      navigate(`/workspaces/${result.workspace.id}`);
    },
  });

  return (
    <div className="shell">
      <AppHeader />
      <main className="dashboard">
        <h1>Workspace invitation</h1>
        {!hasSession(me) && !me.isPending ? (
          <>
            <p className="lede">
              Sign in or register with the invited email. Creating an account does not join the
              workspace by itself.
            </p>
            <div className="hero-actions">
              <Link className="btn btn-primary" to={`/login?next=${encodeURIComponent(next)}`}>
                Sign in
              </Link>
              <Link className="btn btn-ghost" to={`/register?next=${encodeURIComponent(next)}`}>
                Create account
              </Link>
            </div>
          </>
        ) : lookup.isError ? (
          <p className="lede">
            {queryStatusKind(lookup.error) === "notfound"
              ? "This invitation is invalid, expired, or already used."
              : queryErrorMessage(lookup.error, "This invitation is not available for this account.")}
          </p>
        ) : lookup.data ? (
          <>
            <p className="lede">
              You were invited to {lookup.data.invitation.workspaceName} as{" "}
              {lookup.data.invitation.email}.
            </p>
            {accept.error ? <p className="form-error">{accept.error.message}</p> : null}
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => accept.mutate()}
              disabled={accept.isPending}
            >
              {accept.isPending ? "Joining…" : "Accept invitation"}
            </button>
          </>
        ) : (
          <p className="lede">Checking the invitation…</p>
        )}
      </main>
    </div>
  );
}
