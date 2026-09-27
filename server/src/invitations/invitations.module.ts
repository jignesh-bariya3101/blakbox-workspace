import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { IpThrottlerGuard } from "../common/rate-limit";
import { InvitationsController } from "./invitations.controller";
import { InvitationsService } from "./invitations.service";

@Module({
  imports: [AuthModule],
  controllers: [InvitationsController],
  providers: [InvitationsService, IpThrottlerGuard],
})
export class InvitationsModule {}
