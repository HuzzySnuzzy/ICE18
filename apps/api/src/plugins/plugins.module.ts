import { Module } from '@nestjs/common';
import { ServersModule } from '../servers/servers.module';
import { PluginsController } from './plugins.controller';
import { PluginsService } from './plugins.service';

@Module({
  imports: [ServersModule],
  controllers: [PluginsController],
  providers: [PluginsService],
})
export class PluginsModule {}
