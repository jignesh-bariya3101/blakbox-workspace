import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { z } from "zod";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { ValidationError } from "../common/errors";
import { MAX_UPLOAD_BYTES } from "../storage/storage.types";
import { DocumentsService } from "./documents.service";

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  cursor: z.string().uuid().optional(),
});

const renameSchema = z.object({
  filename: z.string().min(1).max(255),
});

function contentDisposition(filename: string) {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function toDocumentJson(document: {
  id: string;
  workspaceId?: string;
  filename: string;
  byteSize: number;
  mimeType: string;
  uploadedById: string;
  createdAt: Date;
}) {
  return {
    id: document.id,
    workspaceId: document.workspaceId,
    filename: document.filename,
    byteSize: document.byteSize,
    mimeType: document.mimeType,
    uploadedById: document.uploadedById,
    createdAt: document.createdAt,
  };
}

@Controller()
@UseGuards(AuthGuard)
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get("workspaces/:workspaceId/documents")
  async list(
    @CurrentUser() user: { id: string },
    @Param("workspaceId") workspaceId: string,
    @Query() query: unknown,
  ) {
    const parsed = listQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new ValidationError("Invalid request", parsed.error.flatten());
    }
    return this.documents.list(user.id, workspaceId, parsed.data);
  }

  @Post("workspaces/:workspaceId/documents")
  @HttpCode(201)
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES },
    }),
  )
  async upload(
    @CurrentUser() user: { id: string },
    @Param("workspaceId") workspaceId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new ValidationError("A file is required");
    }
    const document = await this.documents.upload(user.id, workspaceId, file);
    return { document: toDocumentJson(document) };
  }

  @Get("documents/:documentId")
  async get(@CurrentUser() user: { id: string }, @Param("documentId") documentId: string) {
    const document = await this.documents.get(user.id, documentId);
    return { document: toDocumentJson(document) };
  }

  @Patch("documents/:documentId")
  async rename(
    @CurrentUser() user: { id: string },
    @Param("documentId") documentId: string,
    @Body() body: unknown,
  ) {
    const parsed = renameSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError("Invalid request", parsed.error.flatten());
    }
    const document = await this.documents.rename(user.id, documentId, parsed.data.filename);
    return { document: toDocumentJson(document) };
  }

  @Get("documents/:documentId/download")
  async download(@CurrentUser() user: { id: string }, @Param("documentId") documentId: string) {
    const { document, stream } = await this.documents.download(user.id, documentId);
    return new StreamableFile(stream, {
      type: document.mimeType,
      disposition: contentDisposition(document.filename),
    });
  }

  @Delete("documents/:documentId")
  @HttpCode(204)
  async remove(@CurrentUser() user: { id: string }, @Param("documentId") documentId: string) {
    await this.documents.remove(user.id, documentId);
  }
}
