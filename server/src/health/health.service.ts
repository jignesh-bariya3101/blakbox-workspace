import { Inject, Injectable } from "@nestjs/common";
import { CONFIG, type Config } from "../config";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  async checkDatabase(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  async checkMinio(): Promise<boolean> {
    if (this.config.STORAGE_DRIVER === "memory" || process.env.NODE_ENV === "test") {
      return true;
    }
    try {
      const url = new URL("/minio/health/live", this.config.MINIO_ENDPOINT);
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      return response.ok;
    } catch {
      return false;
    }
  }
}
