import { useQuery } from "@tanstack/react-query";
import { listAuditEvents } from "../api";

export function AuditPanel({ workspaceId }: { workspaceId: string }) {
  const audit = useQuery({
    queryKey: ["audit", workspaceId],
    queryFn: () => listAuditEvents(workspaceId),
  });

  return (
    <section className="invite-panel">
      <h2>Activity</h2>
      <p className="hint">Workspace events only. Secrets are never stored here.</p>
      {audit.error ? <p className="form-error">{audit.error.message}</p> : null}
      <ul className="audit-list">
        {audit.data?.events.map((event) => (
          <li key={event.id}>
            <strong>{event.action}</strong>
            <p>
              {new Date(event.createdAt).toLocaleString()}
              {event.resourceType ? ` · ${event.resourceType}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
