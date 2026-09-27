import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiUrl } from "../api";
import { AppHeader } from "../components/AppHeader";

function filenameFromDisposition(header: string | null) {
  if (!header) return "download";
  const utf = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf?.[1]) return decodeURIComponent(utf[1]);
  const plain = header.match(/filename="([^"]+)"/i);
  return plain?.[1] ?? "download";
}

export function SharePage() {
  const { token = "" } = useParams();
  const [status, setStatus] = useState<"loading" | "done" | "missing" | "network">("loading");

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const response = await fetch(apiUrl(`/api/v1/share/${token}/download`));
        if (!response.ok) {
          if (!cancelled) setStatus("missing");
          return;
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filenameFromDisposition(response.headers.get("content-disposition"));
        link.click();
        URL.revokeObjectURL(url);
        if (!cancelled) setStatus("done");
      } catch {
        if (!cancelled) setStatus("network");
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const title =
    status === "missing"
      ? "This link is not available"
      : status === "network"
        ? "Could not reach the file"
        : "Shared file";
  const body =
    status === "loading"
      ? "Checking the link…"
      : status === "done"
        ? "Your download should start automatically."
        : status === "network"
          ? "A network error stopped the download. Try again."
          : "The token is invalid, expired, revoked, or the file is gone.";

  return (
    <div className="shell">
      <AppHeader />
      <main className="dashboard">
        <h1>{title}</h1>
        <p className="lede">{body}</p>
        <Link className="btn btn-primary" to="/">
          Back to BlakBox
        </Link>
      </main>
    </div>
  );
}
