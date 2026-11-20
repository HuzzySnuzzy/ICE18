import { Controller, Get, Query } from '@nestjs/common';
import type { DatabaseUsageIndex, LocalDatabaseFile, PanelDatabase } from '@ice18/shared';
import { CurrentUser } from '../auth/guards';
import type { UserRow } from '../db/schema';
import { DatabasesService } from './databases.service';

/** The Databases page: every database the user can see, across all servers. */
@Controller('databases')
export class DatabasesController {
  constructor(private readonly databases: DatabasesService) {}

  @Get()
  list(@CurrentUser() user: UserRow): Promise<PanelDatabase[]> {
    return this.databases.list(user);
  }

  /** Which plugins on which servers use each database. Can take a few seconds when rebuilt. */
  @Get('usage')
  usage(@CurrentUser() user: UserRow, @Query('refresh') refresh?: string): Promise<DatabaseUsageIndex> {
    return this.databases.usageIndex(user, refresh === '1');
  }

  /** SQLite/H2 database files found inside plugin folders, including ones no config mentions. */
  @Get('files')
  files(@CurrentUser() user: UserRow, @Query('refresh') refresh?: string): Promise<LocalDatabaseFile[]> {
    return this.databases.localFiles(user, refresh === '1');
  }
}
