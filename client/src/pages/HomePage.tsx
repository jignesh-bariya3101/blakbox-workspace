import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { z } from "zod";
import { apiUrl, createWorkspace, listWorkspaces } from "../api";
import { AppHeader } from "../components/AppHeader";
import { useSessionUi } from "../session-ui";
import { useMe } from "../use-me";

const workspaceSchema = z.object({
  name: z.string().trim().min(1, "Enter a workspace name").max(80, "Keep the name under 80 characters"),
});

type WorkspaceForm = z.infer<typeof workspaceSchema>;

type Health = { status: string };
type Ready = {
  status: string;
  checks: { database: boolean; objectStorage: boolean };
};

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok && response.status !== 503) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

function SignedInHome({ email }: { email: string }) {
  const queryClient = useQueryClient();
  const form = useForm<WorkspaceForm>({ resolver: zodResolver(workspaceSchema) });
  const workspaces = useQuery({ queryKey: ["workspaces"], queryFn: listWorkspaces, retry: false });
  const create = useMutation({
    mutationFn: (name: string) => createWorkspace(name),
    onSuccess: async () => {
      form.reset();
      await queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });

  return (
    <main className="dashboard">
      <h1>Your workspaces</h1>
      <p className="lede">Signed in as {email}. Only members of a workspace can see what is inside it.</p>
      <form className="form" onSubmit={form.handleSubmit((values) => create.mutate(values.name))}>
        <label>
          New workspace
          <input placeholder="Finance, Legal, Design…" maxLength={80} {...form.register("name")} />
        </label>
        {form.formState.errors.name ? (
          <p className="field-error">{form.formState.errors.name.message}</p>
        ) : null}
        {create.error ? <p className="form-error">{create.error.message}</p> : null}
        <button className="btn btn-primary" type="submit" disabled={create.isPending}>
          Create workspace
        </button>
      </form>
      {workspaces.isPending ? (
        <p className="lede">Loading workspaces…</p>
      ) : workspaces.isError ? (
        <p className="form-error">{workspaces.error.message}</p>
      ) : workspaces.data?.workspaces.length ? (
        <ul className="workspace-list">
          {workspaces.data.workspaces.map((workspace) => (
            <li key={workspace.id} className="feature">
              <h3>
                <Link to={`/workspaces/${workspace.id}`}>{workspace.name}</Link>
              </h3>
              <p>Documents in this workspace stay hidden from anyone who is not a member.</p>
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty">
          <strong>No workspace yet.</strong>
          <p>Create one to hold team files. Invites and uploads come next.</p>
        </div>
      )}
    </main>
  );
}

function StatusPanel() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => getJson<Health>(apiUrl("/health")),
  });
  const ready = useQuery({
    queryKey: ["ready"],
    queryFn: () => getJson<Ready>(apiUrl("/ready")),
  });

  return (
    <aside className="panel">
      <h2>System status</h2>
      <div className="status-row">
        <span>API</span>
        <span className={`pill ${health.data?.status === "ok" ? "up" : "down"}`}>
          {health.data?.status ?? health.status}
        </span>
      </div>
      <div className="status-row">
        <span>Database</span>
        <span className={`pill ${ready.data?.checks.database ? "up" : "down"}`}>
          {ready.data?.checks.database ? "Connected" : "Unavailable"}
        </span>
      </div>
      <div className="status-row">
        <span>File storage</span>
        <span className={`pill ${ready.data?.checks.objectStorage ? "up" : "down"}`}>
          {ready.data?.checks.objectStorage ? "Connected" : "Not running yet"}
        </span>
      </div>
    </aside>
  );
}

export function HomePage() {
  const { forceGuest } = useSessionUi();
  const { me, signedIn, user } = useMe();

  if (!forceGuest && me.isPending && !signedIn) {
    return (
      <div className="shell">
        <AppHeader />
        <main className="dashboard">
          <p className="lede">Checking your session…</p>
        </main>
      </div>
    );
  }

  if (signedIn && user) {
    return (
      <div className="shell">
        <AppHeader />
        <SignedInHome email={user.email} />
      </div>
    );
  }

  return (
    <div className="shell">
      <AppHeader />
      <section className="hero">
        <div>
          <h1>Private files for a small team, without the enterprise maze.</h1>
          <p className="lede">
            BlakBox is a workspace vault: members upload documents, owners control access, and share
            links expire on a clock you set.
          </p>
          <div className="hero-actions">
            <Link className="btn btn-primary" to="/register">
              Get started
            </Link>
            <Link className="btn btn-ghost" to="/login">
              I already have an account
            </Link>
          </div>
        </div>
        <StatusPanel />
      </section>
      <section className="features">
        <article className="feature">
          <h3>Workspace roles</h3>
          <p>Owner, admin, and member permissions are decided on the server, not in the browser.</p>
        </article>
        <article className="feature">
          <h3>Files stay off the database</h3>
          <p>PostgreSQL keeps metadata. Object storage keeps the bytes. Credentials never reach the UI.</p>
        </article>
        <article className="feature">
          <h3>Share links are secrets</h3>
          <p>Random tokens, hashed at rest, with expiry and revocation. Guessing an ID is not enough.</p>
        </article>
      </section>
    </div>
  );
}
