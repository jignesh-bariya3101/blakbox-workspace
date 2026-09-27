import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { ValidationError } from "../common/errors";
import { AuditService } from "./audit.service";

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  cursor: z.string().uuid().optional(),
});

@Controller()
@UseGuards(AuthGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get("workspaces/:workspaceId/audit")
  async list(
    @CurrentUser() user: { id: string },
    @Param("workspaceId") workspaceId: string,
    @Query() query: unknown,
  ) {
    const parsed = listQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new ValidationError("Invalid request", parsed.error.flatten());
    }
    return this.audit.list(user.id, workspaceId, parsed.data);
  }
}
