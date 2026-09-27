import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { AppController } from "./app.controller";
import { AuthModule } from "./auth/auth.module";
import { AuditModule } from "./audit/audit.module";
import { AuthzModule } from "./authz/authz.module";
import { DocumentsModule } from "./documents/documents.module";
import { ShareLinksModule } from "./share-links/share-links.module";
import { StorageModule } from "./storage/storage.module";
import { HttpExceptionFilter } from "./common/http-exception.filter";
import { ConfigModule } from "./config.module";
import { InvitationsModule } from "./invitations/invitations.module";
import { HealthModule } from "./health/health.module";
import { PrismaModule } from "./prisma/prisma.module";
import { WorkspacesModule } from "./workspaces/workspaces.module";

@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: 60_000,
          limit: process.env.NODE_ENV === "test" ? 1000 : 10,
        },
      ],
    }),
    ConfigModule,
    PrismaModule,
    StorageModule,
    HealthModule,
    AuthzModule,
    AuditModule,
    AuthModule,
    WorkspacesModule,
    InvitationsModule,
    DocumentsModule,
    ShareLinksModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
