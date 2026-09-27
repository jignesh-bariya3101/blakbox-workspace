import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { UnauthorizedError } from "../common/errors";
import type { AuthedRequest } from "./auth.guard";

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<AuthedRequest>();
  if (!request.currentUser) {
    throw new UnauthorizedError();
  }
  return request.currentUser;
});
