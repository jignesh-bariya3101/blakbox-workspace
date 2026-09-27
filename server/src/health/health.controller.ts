import { Controller, Get, Res } from "@nestjs/common";
import type { Response } from "express";
import { HealthService } from "./health.service";

@Controller()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get("health")
  liveness() {
    return { status: "ok" };
  }

  @Get("ready")
  async readiness(@Res({ passthrough: true }) response: Response) {
    const [database, objectStorage] = await Promise.all([
      this.health.checkDatabase(),
      this.health.checkMinio(),
    ]);
    const ready = database && objectStorage;
    response.status(ready ? 200 : 503);
    return {
      status: ready ? "ready" : "not_ready",
      checks: { database, objectStorage },
    };
  }
}
