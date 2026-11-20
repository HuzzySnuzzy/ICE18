import { Module } from '@nestjs/common';
import { PluginsModule } from '../plugins/plugins.module';
import { ServersModule } from '../servers/servers.module';
import { DatabasesController } from './databases.controller';
import { DatabasesService } from './databases.service';
import { DbBrowserController } from './dbbrowser.controller';
import { DbFileController } from './dbfile.controller';
import { SqliteSnapshotsService } from './sqlite-snapshots.service';
import { DbBrowserService } from './dbbrowser.service';

@Module({
  imports: [ServersModule, PluginsModule],
  controllers: [DbBrowserController, DatabasesController, DbFileController],
  providers: [DbBrowserService, DatabasesService, SqliteSnapshotsService],
})
export class DbBrowserModule {}
