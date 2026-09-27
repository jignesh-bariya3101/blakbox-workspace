import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { IpThrottlerGuard } from "../common/rate-limit";
import { PublicShareController } from "./public-share.controller";
import { ShareLinksController } from "./share-links.controller";
import { ShareLinksService } from "./share-links.service";

@Module({
  imports: [AuthModule],
  controllers: [ShareLinksController, PublicShareController],
  providers: [ShareLinksService, IpThrottlerGuard],
})
export class ShareLinksModule {}
