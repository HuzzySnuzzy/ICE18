import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import type { UpdateStatus } from '@ice18/shared';
import { AdminOnly, CurrentUser } from '../auth/guards';
import type { UserRow } from '../db/schema';
import { UpdateService } from './update.service';

@AdminOnly()
@Controller('admin/updates')
export class UpdatesController {
  constructor(private readonly updates: UpdateService) {}

  @Get()
  status(): UpdateStatus {
    return this.updates.getStatus();
  }

  @Post('check')
  @HttpCode(200)
  check(): Promise<UpdateStatus> {
    return this.updates.check();
  }

  @Post('apply')
  @HttpCode(202)
  async apply(@CurrentUser() user: UserRow): Promise<{ restarting: true }> {
    await this.updates.apply(user.id);
    return { restarting: true };
  }
}
