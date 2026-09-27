import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import type { WorkspaceRole } from "@prisma/client";
import { z } from "zod";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { ValidationError } from "../common/errors";
import { WorkspacesService } from "./workspaces.service";

const nameSchema = z.object({ name: z.string().min(1).max(80) });
const transferSchema = z.object({ userId: z.string().uuid() });
const roleSchema = z.object({ role: z.enum(["ADMIN", "MEMBER"]) });

function toWorkspaceJson(
  workspace: { id: string; name: string; createdAt: Date },
  role?: string,
) {
  return {
    id: workspace.id,
    name: workspace.name,
    createdAt: workspace.createdAt,
    ...(role ? { role } : {}),
  };
}

@Controller("workspaces")
@UseGuards(AuthGuard)
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Post()
  @HttpCode(201)
  async create(@CurrentUser() user: { id: string }, @Body() body: unknown) {
    const parsed = nameSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError("Invalid request", parsed.error.flatten());
    }
    const workspace = await this.workspaces.create(user.id, parsed.data.name);
    return { workspace: toWorkspaceJson(workspace, "OWNER") };
  }

  @Get()
  async list(@CurrentUser() user: { id: string }) {
    const workspaces = await this.workspaces.listForUser(user.id);
    return { workspaces: workspaces.map((workspace) => toWorkspaceJson(workspace)) };
  }

  @Get(":workspaceId")
  async get(@CurrentUser() user: { id: string }, @Param("workspaceId") workspaceId: string) {
    const workspace = await this.workspaces.get(user.id, workspaceId);
    return { workspace: toWorkspaceJson(workspace, workspace.role) };
  }

  @Delete(":workspaceId")
  @HttpCode(204)
  async remove(@CurrentUser() user: { id: string }, @Param("workspaceId") workspaceId: string) {
    await this.workspaces.remove(user.id, workspaceId);
  }

  @Post(":workspaceId/transfer")
  @HttpCode(204)
  async transfer(
    @CurrentUser() user: { id: string },
    @Param("workspaceId") workspaceId: string,
    @Body() body: unknown,
  ) {
    const parsed = transferSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError("Invalid request", parsed.error.flatten());
    }
    await this.workspaces.transfer(user.id, workspaceId, parsed.data.userId);
  }

  @Get(":workspaceId/members")
  async members(@CurrentUser() user: { id: string }, @Param("workspaceId") workspaceId: string) {
    const members = await this.workspaces.listMembers(user.id, workspaceId);
    return {
      members: members.map((member) => ({
        userId: member.userId,
        email: member.user.email,
        role: member.role,
      })),
    };
  }

  @Delete(":workspaceId/members/:userId")
  @HttpCode(204)
  async removeMember(
    @CurrentUser() user: { id: string },
    @Param("workspaceId") workspaceId: string,
    @Param("userId") targetUserId: string,
  ) {
    await this.workspaces.removeMember(user.id, workspaceId, targetUserId);
  }

  @Patch(":workspaceId/members/:userId")
  @HttpCode(204)
  async changeRole(
    @CurrentUser() user: { id: string },
    @Param("workspaceId") workspaceId: string,
    @Param("userId") targetUserId: string,
    @Body() body: unknown,
  ) {
    const parsed = roleSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError("Invalid request", parsed.error.flatten());
    }
    await this.workspaces.changeRole(user.id, workspaceId, targetUserId, parsed.data.role as WorkspaceRole);
  }
}
