function loopbackHost(host: string) {
  return ["localhost", "127.0.0.1", "::1"].includes(host.replace(/^\[|\]$/g, "").toLowerCase());
}

/** localhost, 127.0.0.1, and ::1 are different cookie sites. SameSite=Lax will not send bb_session. */
export function alignPageHostWithApi() {
  const api = new URL(import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:3000");
  const page = window.location;
  if (!loopbackHost(page.hostname) || !loopbackHost(api.hostname)) {
    return;
  }
  if (page.hostname === api.hostname) {
    return;
  }
  const next = new URL(page.href);
  next.hostname = api.hostname;
  window.location.replace(next.href);
}
