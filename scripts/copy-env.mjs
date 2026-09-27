import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function copyIfMissing(from, to) {
  if (existsSync(to)) {
    console.log(`keep ${to}`);
    return;
  }
  copyFileSync(from, to);
  console.log(`wrote ${to}`);
}

copyIfMissing(join(root, ".env.example"), join(root, "server", ".env"));
copyIfMissing(join(root, "client", ".env.example"), join(root, "client", ".env"));
