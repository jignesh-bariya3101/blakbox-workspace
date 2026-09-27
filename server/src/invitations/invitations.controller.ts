import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { z } from "zod";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { AUTH_RATE_LIMIT, IpThrottlerGuard, RATE_LIMIT_WINDOW_MS } from "../common/rate-limit";
import { ValidationError } from "../common/errors";
import { InvitationsService } from "./invitations.service";

const inviteSchema = z.object({ email: z.string().email() });
const acceptSchema = z.object({ token: z.string().min(1) });

@Controller()
@UseGuards(AuthGuard)
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post("workspaces/:workspaceId/invitations")
  @HttpCode(201)
  async create(
    @CurrentUser() user: { id: string },
    @Param("workspaceId") workspaceId: string,
    @Body() body: unknown,
  ) {
    const parsed = inviteSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError("Invalid request", parsed.error.flatten());
    }
    const invitation = await this.invitations.invite(user.id, workspaceId, parsed.data.email);
    return { invitation };
  }

  @Get("workspaces/:workspaceId/invitations")
  async list(@CurrentUser() user: { id: string }, @Param("workspaceId") workspaceId: string) {
    const invitations = await this.invitations.list(user.id, workspaceId);
    return { invitations };
  }

  @Delete("workspaces/:workspaceId/invitations/:invitationId")
  @HttpCode(204)
  async revoke(
    @CurrentUser() user: { id: string },
    @Param("workspaceId") workspaceId: string,
    @Param("invitationId") invitationId: string,
  ) {
    await this.invitations.revoke(user.id, workspaceId, invitationId);
  }

  @Post("invitations/lookup")
  @HttpCode(200)
  async lookup(@CurrentUser() user: { id: string; email: string }, @Body() body: unknown) {
    const parsed = acceptSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError("Invalid request", parsed.error.flatten());
    }
    const invitation = await this.invitations.lookup(user, parsed.data.token);
    return { invitation };
  }

  @Post("invitations/accept")
  @HttpCode(201)
  @UseGuards(AuthGuard, IpThrottlerGuard)
  @Throttle({ default: { limit: AUTH_RATE_LIMIT, ttl: RATE_LIMIT_WINDOW_MS } })
  async accept(@CurrentUser() user: { id: string; email: string }, @Body() body: unknown) {
    const parsed = acceptSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError("Invalid request", parsed.error.flatten());
    }
    return this.invitations.accept(user, parsed.data.token);
  }
}
