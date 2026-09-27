type Kind = "invite" | "share";

type Stored = { token: string; expiresAt: string };

const PREFIX = "blakbox.rawTokens.";

function load(kind: Kind): Record<string, Stored> {
  try {
    const raw = localStorage.getItem(PREFIX + kind);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, Stored>;
    const now = Date.now();
    const keep: Record<string, Stored> = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (value?.token && new Date(value.expiresAt).getTime() > now) {
        keep[id] = value;
      }
    }
    return keep;
  } catch {
    return {};
  }
}

function save(kind: Kind, map: Record<string, Stored>) {
  localStorage.setItem(PREFIX + kind, JSON.stringify(map));
}

export function rememberGeneratedToken(kind: Kind, id: string, token: string, expiresAt: string) {
  const map = load(kind);
  map[id] = { token, expiresAt };
  save(kind, map);
}

export function forgetGeneratedToken(kind: Kind, id: string) {
  const map = load(kind);
  delete map[id];
  save(kind, map);
}

export function getGeneratedToken(kind: Kind, id: string): string | undefined {
  return load(kind)[id]?.token;
}
