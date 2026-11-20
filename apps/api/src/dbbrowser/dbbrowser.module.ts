import { Module } from '@nestjs/common';
import { PluginsModule } from '../plugins/plugins.module';
import { ServersModule } from '../servers/servers.module';
import { DbBrowserController } from './dbbrowser.controller';
import { DbBrowserService } from './dbbrowser.service';

@Module({
  imports: [ServersModule, PluginsModule],
  controllers: [DbBrowserController],
  providers: [DbBrowserService],
})
export class DbBrowserModule {}
