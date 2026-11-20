import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/guards';
import { PterodactylService } from './pterodactyl/pterodactyl.service';

@Controller('health')
export class HealthController {
  constructor(private readonly ptero: PterodactylService) {}

  @Public()
  @Get()
  health(): { ok: true; pterodactylConfigured: boolean } {
    return { ok: true, pterodactylConfigured: this.ptero.configured };
  }
}
