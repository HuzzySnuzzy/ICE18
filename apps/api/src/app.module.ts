import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AccountController } from './account/account.controller';
import { AdminController } from './admin/admin.controller';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CsrfGuard, SessionGuard } from './auth/guards';
import { PterodactylErrorFilter } from './common/pterodactyl-error.filter';
import type { AppConfig } from './config/config';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './db/database.module';
import { HealthController } from './health.controller';
import { DbBrowserModule } from './dbbrowser/dbbrowser.module';
import { ManageModule } from './manage/manage.module';
import { PluginsModule } from './plugins/plugins.module';
import { PterodactylModule } from './pterodactyl/pterodactyl.module';
import { ServersModule } from './servers/servers.module';
import { UpdateService } from './updates/update.service';
import { UpdatesController } from './updates/updates.controller';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 600 }]),
        DatabaseModule,
        AuditModule,
        AuthModule,
        PterodactylModule,
        ServersModule,
        PluginsModule,
        DbBrowserModule,
        ManageModule,
      ],
      controllers: [HealthController, AccountController, AdminController, UpdatesController],
      providers: [
        UpdateService,
        // Order matters: rate limit, then CSRF check, then login check.
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: CsrfGuard },
        { provide: APP_GUARD, useClass: SessionGuard },
        { provide: APP_FILTER, useClass: PterodactylErrorFilter },
      ],
    };
  }
}
