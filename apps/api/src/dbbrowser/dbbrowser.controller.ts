import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { DatabaseLockStatus, DbRowsPage, DbTable, DbTableDesign } from '@ice18/shared';
import { CurrentUser } from '../auth/guards';
import { parseBody } from '../common/validation';
import type { UserRow } from '../db/schema';
import { DbBrowserService } from './dbbrowser.service';

const cellValue = z.union([z.string().max(1_000_000), z.null()]);
const rowKey = z.record(z.string().max(64), z.string().max(4096));

const updateSchema = z.object({ key: rowKey, values: z.record(z.string().max(64), cellValue) });
const insertSchema = z.object({ values: z.record(z.string().max(64), cellValue) });
const deleteSchema = z.object({ keys: z.array(rowKey).min(1).max(100) });

@Controller('servers/:identifier/db')
export class DbBrowserController {
  constructor(private readonly browser: DbBrowserService) {}

  @Get(':databaseId/status')
  status(
    @CurrentUser() user: UserRow,
    @Param('identifier') identifier: string,
    @Param('databaseId') databaseId: string,
  ): Promise<DatabaseLockStatus> {
    return this.browser.status(user, identifier, databaseId);
  }

  @Get(':databaseId/tables')
  tables(
    @CurrentUser() user: UserRow,
    @Param('identifier') identifier: string,
    @Param('databaseId') databaseId: string,
    @Query('refresh') refresh?: string,
  ): Promise<DbTable[]> {
    return this.browser.tables(user, identifier, databaseId, refresh === '1');
  }

  @Get(':databaseId/tables/:table')
  design(
    @CurrentUser() user: UserRow,
    @Param('identifier') identifier: string,
    @Param('databaseId') databaseId: string,
    @Param('table') table: string,
  ): Promise<DbTableDesign> {
    return this.browser.design(user, identifier, databaseId, table);
  }

  @Get(':databaseId/tables/:table/rows')
  rows(
    @CurrentUser() user: UserRow,
    @Param('identifier') identifier: string,
    @Param('databaseId') databaseId: string,
    @Param('table') table: string,
    @Query() query: Record<string, string>,
  ): Promise<DbRowsPage> {
    return this.browser.rows(user, identifier, databaseId, table, query);
  }

  @Patch(':databaseId/tables/:table/rows')
  @HttpCode(204)
  async update(
    @CurrentUser() user: UserRow,
    @Param('identifier') identifier: string,
    @Param('databaseId') databaseId: string,
    @Param('table') table: string,
    @Body() body: unknown,
  ): Promise<void> {
    const { key, values } = parseBody(updateSchema, body);
    await this.browser.updateRow(user, identifier, databaseId, table, key, values);
  }

  @Post(':databaseId/tables/:table/rows')
  insert(
    @CurrentUser() user: UserRow,
    @Param('identifier') identifier: string,
    @Param('databaseId') databaseId: string,
    @Param('table') table: string,
    @Body() body: unknown,
  ): Promise<{ insertId: string | null }> {
    return this.browser.insertRow(user, identifier, databaseId, table, parseBody(insertSchema, body).values);
  }

  @Post(':databaseId/tables/:table/rows/delete')
  @HttpCode(200)
  delete(
    @CurrentUser() user: UserRow,
    @Param('identifier') identifier: string,
    @Param('databaseId') databaseId: string,
    @Param('table') table: string,
    @Body() body: unknown,
  ): Promise<{ deleted: number }> {
    return this.browser.deleteRows(user, identifier, databaseId, table, parseBody(deleteSchema, body).keys);
  }
}
