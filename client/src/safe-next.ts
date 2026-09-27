const INVITE_PATH = /^\/invite\/[A-Za-z0-9_-]{43}$/;

export function safeNext(search: string) {
  const next = new URLSearchParams(search).get("next");
  if (!next) {
    return "/";
  }
  try {
    const parsed = new URL(next, "https://blakbox.invalid");
    if (parsed.origin !== "https://blakbox.invalid") {
      return "/";
    }
    if (parsed.search || parsed.hash) {
      return "/";
    }
    if (!INVITE_PATH.test(parsed.pathname)) {
      return "/";
    }
    return parsed.pathname;
  } catch {
    return "/";
  }
}
