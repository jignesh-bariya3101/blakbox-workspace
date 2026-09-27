import { Global, Inject, Logger, Module, OnModuleInit } from "@nestjs/common";
import { CONFIG, type Config } from "../config";
import { StorageCleanupService } from "./cleanup.service";
import { MemoryStorageProvider } from "./memory.storage";
import { S3StorageProvider } from "./s3.storage";
import { STORAGE_PROVIDER, type StorageProvider } from "./storage.types";

function createStorage(config: Config): StorageProvider {
  if (config.STORAGE_DRIVER === "memory" || process.env.NODE_ENV === "test") {
    return new MemoryStorageProvider();
  }
  return new S3StorageProvider(config);
}

@Global()
@Module({
  providers: [
    {
      provide: STORAGE_PROVIDER,
      inject: [CONFIG],
      useFactory: (config: Config) => createStorage(config),
    },
    StorageCleanupService,
  ],
  exports: [STORAGE_PROVIDER, StorageCleanupService],
})
export class StorageModule implements OnModuleInit {
  private readonly logger = new Logger(StorageModule.name);

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async onModuleInit() {
    if (this.storage instanceof S3StorageProvider) {
      try {
        await this.storage.ensureBucket();
      } catch {
        this.logger.warn(`MinIO bucket ${this.config.MINIO_BUCKET} is not reachable yet`);
      }
    }
  }
}
