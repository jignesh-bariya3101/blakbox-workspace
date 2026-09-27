import { Controller, Get, Param, StreamableFile, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { IpThrottlerGuard, RATE_LIMIT_WINDOW_MS, SHARE_RATE_LIMIT } from "../common/rate-limit";
import { ShareLinksService } from "./share-links.service";

function contentDisposition(filename: string) {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

@Controller()
@UseGuards(IpThrottlerGuard)
export class PublicShareController {
  constructor(private readonly shareLinks: ShareLinksService) {}

  @Get("share/:token/download")
  @Throttle({ default: { limit: SHARE_RATE_LIMIT, ttl: RATE_LIMIT_WINDOW_MS } })
  async download(@Param("token") token: string) {
    const { filename, mimeType, stream } = await this.shareLinks.publicDownload(token);
    return new StreamableFile(stream, {
      type: mimeType,
      disposition: contentDisposition(filename),
    });
  }
}
