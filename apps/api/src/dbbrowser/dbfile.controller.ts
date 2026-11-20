import { Controller, Get, Param, Query } from '@nestjs/common';
import type { DbRowsPage, DbTableDesign, LocalDatabaseSnapshot } from '@ice18/shared';
import { CurrentUser } from '../auth/guards';
import type { UserRow } from '../db/schema';
import { SqliteSnapshotsService } from './sqlite-snapshots.service';

/** Read-only views of SQLite files in plugin folders. :fileKey is the file path, base64url-encoded. */
@Controller('servers/:identifier/dbfile/:fileKey')
export class DbFileController {
  constructor(private readonly snapshots: SqliteSnapshotsService) {}

  @Get('tables')
  tables(
    @CurrentUser() user: UserRow,
    @Param('identifier') identifier: string,
    @Param('fileKey') fileKey: string,
    @Query('refresh') refresh?: string,
  ): Promise<LocalDatabaseSnapshot> {
    return this.snapshots.tables(user, identifier, fileKey, refresh === '1');
  }

  @Get('tables/:table')
  design(
    @CurrentUser() user: UserRow,
    @Param('identifier') identifier: string,
    @Param('fileKey') fileKey: string,
    @Param('table') table: string,
  ): Promise<DbTableDesign> {
    return this.snapshots.design(user, identifier, fileKey, table);
  }

  @Get('tables/:table/rows')
  rows(
    @CurrentUser() user: UserRow,
    @Param('identifier') identifier: string,
    @Param('fileKey') fileKey: string,
    @Param('table') table: string,
    @Query() query: Record<string, string>,
  ): Promise<DbRowsPage> {
    return this.snapshots.rows(user, identifier, fileKey, table, query);
  }
}
