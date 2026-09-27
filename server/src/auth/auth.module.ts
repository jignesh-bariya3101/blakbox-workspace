import { Module } from "@nestjs/common";
import { IpThrottlerGuard } from "../common/rate-limit";
import { AuthController } from "./auth.controller";
import { AuthGuard } from "./auth.guard";
import { AuthService } from "./auth.service";

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, IpThrottlerGuard],
  exports: [AuthService, AuthGuard],
})
export class AuthModule {}
