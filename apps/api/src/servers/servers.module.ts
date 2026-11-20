import { Module } from '@nestjs/common';
import { ConsoleRelay } from './console.relay';
import { ServersController } from './servers.controller';
import { ServersService } from './servers.service';

@Module({
  controllers: [ServersController],
  providers: [ServersService, ConsoleRelay],
  exports: [ServersService, ConsoleRelay],
})
export class ServersModule {}
