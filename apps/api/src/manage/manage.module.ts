import { Module } from '@nestjs/common';
import { ServersModule } from '../servers/servers.module';
import { ManageController } from './manage.controller';
import { ManageService } from './manage.service';

@Module({
  imports: [ServersModule],
  controllers: [ManageController],
  providers: [ManageService],
})
export class ManageModule {}
