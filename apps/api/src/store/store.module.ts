import { Module } from '@nestjs/common';
import { ServersModule } from '../servers/servers.module';
import { CreditsService } from './credits.service';
import { PrefabsService } from './prefabs.service';
import { StoreAdminController, StoreController } from './store.controller';
import { StoreService } from './store.service';

@Module({
  imports: [ServersModule],
  controllers: [StoreController, StoreAdminController],
  providers: [CreditsService, PrefabsService, StoreService],
})
export class StoreModule {}
