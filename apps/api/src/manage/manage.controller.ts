import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type { Allocation, FileEntry, PermissionCatalogue, StartupInfo, Subuser } from '@ice18/shared';
import { CurrentUser } from '../auth/guards';
import { parseBody } from '../common/validation';
import type { UserRow } from '../db/schema';
import { ManageService } from './manage.service';

const path = z.string().min(1).max(4096);
const name = z.string().min(1).max(255);
const permissions = z.array(z.string().min(3).max(64)).max(200);

@Controller('servers/:identifier')
export class ManageController {
  constructor(private readonly manage: ManageService) {}

  // ---------- files ----------

  @Get('files')
  list(@CurrentUser() user: UserRow, @Param('identifier') id: string, @Query('directory') directory = '/'): Promise<FileEntry[]> {
    return this.manage.list(user, id, directory);
  }

  @Get('files/contents')
  async contents(@CurrentUser() user: UserRow, @Param('identifier') id: string, @Query('file') file: string): Promise<{ content: string }> {
    return { content: await this.manage.read(user, id, file) };
  }

  @Put('files/contents')
  @HttpCode(204)
  async write(@CurrentUser() user: UserRow, @Param('identifier') id: string, @Body() body: unknown): Promise<void> {
    const input = parseBody(z.object({ file: path, content: z.string().max(5 * 1024 * 1024), create: z.boolean().default(false) }), body);
    await this.manage.write(user, id, input.file, input.content, input.create);
  }

  @Get('files/download')
  async download(@CurrentUser() user: UserRow, @Param('identifier') id: string, @Query('file') file: string): Promise<{ url: string }> {
    return { url: await this.manage.downloadUrl(user, id, file) };
  }

  /** Raw file body (application/octet-stream); the file name and folder are in the query. */
  @Post('files/upload')
  @HttpCode(204)
  async upload(
    @CurrentUser() user: UserRow,
    @Param('identifier') id: string,
    @Query('directory') directory: string,
    @Query('name') fileName: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.manage.upload(user, id, directory, fileName, request);
  }

  @Post('files/folder')
  @HttpCode(204)
  async createFolder(@CurrentUser() user: UserRow, @Param('identifier') id: string, @Body() body: unknown): Promise<void> {
    const input = parseBody(z.object({ root: path, name }), body);
    await this.manage.createFolder(user, id, input.root, input.name);
  }

  @Post('files/rename')
  @HttpCode(204)
  async rename(@CurrentUser() user: UserRow, @Param('identifier') id: string, @Body() body: unknown): Promise<void> {
    const input = parseBody(z.object({ root: path, from: path, to: path }), body);
    await this.manage.rename(user, id, input.root, input.from, input.to);
  }

  @Post('files/copy')
  @HttpCode(204)
  async copy(@CurrentUser() user: UserRow, @Param('identifier') id: string, @Body() body: unknown): Promise<void> {
    await this.manage.copy(user, id, parseBody(z.object({ location: path }), body).location);
  }

  @Post('files/compress')
  compress(@CurrentUser() user: UserRow, @Param('identifier') id: string, @Body() body: unknown): Promise<FileEntry> {
    const input = parseBody(z.object({ root: path, files: z.array(name).min(1).max(1000) }), body);
    return this.manage.compress(user, id, input.root, input.files);
  }

  @Post('files/decompress')
  @HttpCode(204)
  async decompress(@CurrentUser() user: UserRow, @Param('identifier') id: string, @Body() body: unknown): Promise<void> {
    const input = parseBody(z.object({ root: path, file: name }), body);
    await this.manage.decompress(user, id, input.root, input.file);
  }

  @Post('files/delete')
  @HttpCode(204)
  async delete(@CurrentUser() user: UserRow, @Param('identifier') id: string, @Body() body: unknown): Promise<void> {
    const input = parseBody(z.object({ root: path, files: z.array(name).min(1).max(50) }), body);
    await this.manage.delete(user, id, input.root, input.files);
  }

  // ---------- users ----------

  @Get('users')
  subusers(@CurrentUser() user: UserRow, @Param('identifier') id: string): Promise<{ users: Subuser[]; grantable: string[] | '*' }> {
    return this.manage.subusers(user, id);
  }

  @Get('users/permissions')
  catalogue(): Promise<PermissionCatalogue> {
    return this.manage.permissionCatalogue();
  }

  @Post('users')
  addSubuser(@CurrentUser() user: UserRow, @Param('identifier') id: string, @Body() body: unknown): Promise<Subuser> {
    const input = parseBody(z.object({ email: z.email().max(255), permissions }), body);
    return this.manage.addSubuser(user, id, input.email, input.permissions);
  }

  @Put('users/:uuid')
  updateSubuser(
    @CurrentUser() user: UserRow,
    @Param('identifier') id: string,
    @Param('uuid') uuid: string,
    @Body() body: unknown,
  ): Promise<Subuser> {
    return this.manage.updateSubuser(user, id, uuid, parseBody(z.object({ permissions }), body).permissions);
  }

  @Delete('users/:uuid')
  @HttpCode(204)
  async removeSubuser(@CurrentUser() user: UserRow, @Param('identifier') id: string, @Param('uuid') uuid: string): Promise<void> {
    await this.manage.removeSubuser(user, id, uuid);
  }

  // ---------- startup & settings ----------

  @Get('startup')
  startup(@CurrentUser() user: UserRow, @Param('identifier') id: string): Promise<StartupInfo> {
    return this.manage.startup(user, id);
  }

  @Put('startup/variables')
  @HttpCode(204)
  async setVariable(@CurrentUser() user: UserRow, @Param('identifier') id: string, @Body() body: unknown): Promise<void> {
    const input = parseBody(z.object({ key: z.string().min(1).max(191), value: z.string().max(10_000) }), body);
    await this.manage.setVariable(user, id, input.key, input.value);
  }

  @Post('rename')
  @HttpCode(204)
  async rename2(@CurrentUser() user: UserRow, @Param('identifier') id: string, @Body() body: unknown): Promise<void> {
    const input = parseBody(z.object({ name: z.string().trim().min(1).max(191), description: z.string().max(10_000).optional() }), body);
    await this.manage.renameServer(user, id, input.name, input.description);
  }

  // ---------- network ----------

  @Get('allocations')
  allocations(@CurrentUser() user: UserRow, @Param('identifier') id: string): Promise<Allocation[]> {
    return this.manage.allocations(user, id);
  }

  @Post('allocations')
  addAllocation(@CurrentUser() user: UserRow, @Param('identifier') id: string): Promise<Allocation> {
    return this.manage.addAllocation(user, id);
  }

  @Put('allocations/:allocation')
  setNotes(
    @CurrentUser() user: UserRow,
    @Param('identifier') id: string,
    @Param('allocation', ParseIntPipe) allocation: number,
    @Body() body: unknown,
  ): Promise<Allocation> {
    return this.manage.setNotes(user, id, allocation, parseBody(z.object({ notes: z.string().max(255).nullable() }), body).notes);
  }

  @Post('allocations/:allocation/primary')
  @HttpCode(200)
  setPrimary(
    @CurrentUser() user: UserRow,
    @Param('identifier') id: string,
    @Param('allocation', ParseIntPipe) allocation: number,
  ): Promise<Allocation> {
    return this.manage.setPrimary(user, id, allocation);
  }
}
