import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import type { Request } from "express";

export const RATE_LIMIT_WINDOW_MS = 60_000;
export const AUTH_RATE_LIMIT = process.env.NODE_ENV === "test" ? 1000 : 10;
export const SHARE_RATE_LIMIT = process.env.NODE_ENV === "test" ? 1000 : 30;

function isSingleClientIp(value: string): boolean {
  const trimmed = value.trim();
  return Boolean(trimmed) && trimmed.length <= 45 && !trimmed.includes(",") && !/\s/.test(trimmed);
}

export function clientIp(
  request: Pick<Request, "socket"> & { headers?: Request["headers"] },
  trustProxy = process.env.TRUST_PROXY === "true",
): string {
  if (trustProxy) {
    const raw = request.headers?.["x-real-ip"];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value === "string" && isSingleClientIp(value)) {
      return value.trim();
    }
  }
  return request.socket.remoteAddress ?? "unknown";
}

@Injectable()
export class IpThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(request: Record<string, unknown>): Promise<string> {
    const socket = request.socket as Request["socket"] | undefined;
    return clientIp({
      socket: socket ?? ({ remoteAddress: "unknown" } as Request["socket"]),
      headers: request.headers as Request["headers"] | undefined,
    });
  }

  protected generateKey(_context: unknown, tracker: string, name: string): string {
    return `${name}:${tracker}`;
  }
}
