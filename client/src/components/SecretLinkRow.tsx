import { useEffect, useState } from "react";
import { formatRemaining } from "../remaining-time";

export function SecretLinkRow({
  label,
  url,
  expiresAt,
  onRevoke,
  revokePending,
}: {
  label: string;
  url: string | undefined;
  expiresAt: string;
  onRevoke?: () => void;
  revokePending?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  async function copy() {
    if (!url) {
      return;
    }
    await navigator.clipboard.writeText(url).catch(() => undefined);
    setCopied(true);
  }

  return (
    <li className="secret-link">
      <div className="secret-link-main">
        <strong>{label}</strong>
        <p className="hint countdown">{formatRemaining(expiresAt, now)}</p>
        {url ? (
          <div className="secret-link-copy">
            <input readOnly value={url} aria-label={`${label} URL`} />
            <button type="button" className="btn btn-ghost" onClick={() => void copy()}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        ) : (
          <p className="hint">This link was created in another browser, so the secret is not stored here.</p>
        )}
      </div>
      {onRevoke ? (
        <button type="button" className="btn btn-ghost" onClick={onRevoke} disabled={revokePending}>
          {revokePending ? "Revoking…" : "Revoke"}
        </button>
      ) : null}
    </li>
  );
}
