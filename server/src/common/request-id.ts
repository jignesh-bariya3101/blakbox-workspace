import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export type RequestWithId = Request & { requestId: string };

const requestContext = new AsyncLocalStorage<{ requestId: string }>();

export function currentRequestId() {
  return requestContext.getStore()?.requestId ?? "";
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header("x-request-id");
  const requestId =
    incoming && incoming.length > 0 && incoming.length <= 128 ? incoming : randomUUID();
  (req as RequestWithId).requestId = requestId;
  res.setHeader("x-request-id", requestId);
  requestContext.run({ requestId }, () => next());
}
