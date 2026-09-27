import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { ApiRequestError, logout } from "../api";
import { useSessionUi } from "../session-ui";
import { useMe } from "../use-me";
import { Brand } from "./Brand";

export function AppHeader() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { setForceGuest } = useSessionUi();
  const { signedIn, user } = useMe();

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      setForceGuest(true);
      queryClient.clear();
      navigate("/", { replace: true });
    },
    onError: (error) => {
      if (error instanceof ApiRequestError && (error.status === 401 || error.status === 0)) {
        setForceGuest(true);
        queryClient.clear();
        navigate("/", { replace: true });
      }
    },
  });

  return (
    <header className="topbar">
      <Brand />
      <div className="nav-actions">
        {signedIn && user ? (
          <>
            <span className="user-chip">{user.email}</span>
            <button type="button" className="btn btn-ghost" onClick={() => logoutMutation.mutate()}>
              {logoutMutation.isPending ? "Signing out…" : "Sign out"}
            </button>
          </>
        ) : (
          <>
            <Link className="btn btn-ghost" to="/login">
              Sign in
            </Link>
            <Link className="btn btn-primary" to="/register">
              Create account
            </Link>
          </>
        )}
      </div>
    </header>
  );
}
