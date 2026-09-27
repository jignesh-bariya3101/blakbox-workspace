import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { UnauthorizedError } from "../common/errors";
import { SESSION_COOKIE_NAME } from "./auth.constants";
import { AuthService } from "./auth.service";

export type AuthedRequest = Request & {
  currentUser?: { id: string; email: string };
  currentSessionId?: string;
};

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const rawToken = request.cookies?.[SESSION_COOKIE_NAME];
    if (!rawToken) {
      throw new UnauthorizedError();
    }

    const { sessionId, user } = await this.auth.authenticateSession(rawToken);
    request.currentUser = { id: user.id, email: user.email };
    request.currentSessionId = sessionId;
    return true;
  }
}
