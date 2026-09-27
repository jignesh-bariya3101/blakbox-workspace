import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { ValidationError } from "../common/errors";
import { ShareLinksService } from "./share-links.service";

const createSchema = z.object({
  expiresAt: z.string().min(1).optional(),
});

@Controller()
@UseGuards(AuthGuard)
export class ShareLinksController {
  constructor(private readonly shareLinks: ShareLinksService) {}

  @Post("documents/:documentId/share-links")
  @HttpCode(201)
  async create(
    @CurrentUser() user: { id: string },
    @Param("documentId") documentId: string,
    @Body() body: unknown,
  ) {
    const parsed = createSchema.safeParse(body && typeof body === "object" ? body : {});
    if (!parsed.success) {
      throw new ValidationError("Invalid request", parsed.error.flatten());
    }
    const shareLink = await this.shareLinks.create(user.id, documentId, parsed.data.expiresAt);
    return { shareLink };
  }

  @Get("documents/:documentId/share-links")
  async list(@CurrentUser() user: { id: string }, @Param("documentId") documentId: string) {
    const shareLinks = await this.shareLinks.list(user.id, documentId);
    return { shareLinks };
  }

  @Delete("share-links/:shareLinkId")
  @HttpCode(204)
  async revoke(@CurrentUser() user: { id: string }, @Param("shareLinkId") shareLinkId: string) {
    await this.shareLinks.revoke(user.id, shareLinkId);
  }
}
