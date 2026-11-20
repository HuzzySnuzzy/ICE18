import { Module } from '@nestjs/common';
import { ServersModule } from '../servers/servers.module';
import { PluginsController } from './plugins.controller';
import { PluginsService } from './plugins.service';
import { DatabaseUsageService } from './usage.service';

@Module({
  imports: [ServersModule],
  controllers: [PluginsController],
  providers: [PluginsService, DatabaseUsageService],
  exports: [PluginsService, DatabaseUsageService],
})
export class PluginsModule {}
