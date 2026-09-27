import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  MINIO_ENDPOINT: z.string().url(),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(1),
  MINIO_BUCKET: z.string().min(1),
  MINIO_REGION: z.string().min(1).default("us-east-1"),
  STORAGE_DRIVER: z.enum(["s3", "memory"]).default("s3"),
  TRUST_PROXY: z.enum(["true", "false"]).default("false"),
  // Override the Secure cookie flag. Unset means Secure only when NODE_ENV=production.
  COOKIE_SECURE: z.enum(["true", "false"]).optional(),
  CORS_ORIGINS: z
    .string()
    .default(
      "http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:8080,http://localhost:8080",
    ),
});

export type Config = z.infer<typeof envSchema> & { cookieSecure: boolean; corsOrigins: string[] };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid configuration: ${issues}`);
  }
  const cookieSecure =
    parsed.data.COOKIE_SECURE !== undefined
      ? parsed.data.COOKIE_SECURE === "true"
      : parsed.data.NODE_ENV === "production";
  const corsOrigins = parsed.data.CORS_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (corsOrigins.some((origin) => !/^https?:\/\/[^\s/]+/i.test(origin))) {
    throw new Error("Invalid configuration: CORS_ORIGINS must be a comma-separated list of http(s) origins");
  }
  return { ...parsed.data, cookieSecure, corsOrigins };
}

const LOOPBACK_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i;

export function isAllowedCorsOrigin(origin: string | undefined, config: Config): boolean {
  if (!origin) {
    return true;
  }
  if (config.corsOrigins.includes(origin)) {
    return true;
  }
  return config.NODE_ENV === "development" && LOOPBACK_ORIGIN.test(origin);
}

export const CONFIG = Symbol("CONFIG");
