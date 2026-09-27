import { Link } from "react-router-dom";
import { AppHeader } from "./AppHeader";

export function StatusPage({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { to: string; label: string };
}) {
  return (
    <div className="shell">
      <AppHeader />
      <main className="dashboard">
        <h1>{title}</h1>
        <p className="lede">{body}</p>
        {action ? (
          <Link className="btn btn-primary" to={action.to}>
            {action.label}
          </Link>
        ) : (
          <Link className="btn btn-primary" to="/">
            Back home
          </Link>
        )}
      </main>
    </div>
  );
}
