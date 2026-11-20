import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import type { EggDetails, EggSummary, LocationSummary, Prefab, PrefabInput, StoreItem } from '@ice18/shared';
import { DatabaseService } from '../db/database.service';
import { prefabs, type PrefabRow } from '../db/schema';
import { PterodactylService } from '../pterodactyl/pterodactyl.service';
import type { PteroApplicationServer, PteroCreateServer } from '../pterodactyl/pterodactyl.types';

const CATALOGUE_TTL_MS = 5 * 60_000;

export function toPrefab(row: PrefabRow): Prefab {
  const { createdAt: _created, updatedAt: _updated, ...rest } = row;
  return rest;
}

export function toStoreItem(row: PrefabRow): StoreItem {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    memory: row.memory,
    disk: row.disk,
    cpu: row.cpu,
    databases: row.databases,
    allocations: row.allocations,
    backups: row.backups,
    price: row.price,
  };
}

/** Server templates and creating servers from them. */
@Injectable()
export class PrefabsService {
  private eggCache?: { at: number; eggs: EggSummary[] };

  constructor(
    private readonly database: DatabaseService,
    private readonly ptero: PterodactylService,
  ) {}

  async list(onlyVisible = false): Promise<PrefabRow[]> {
    const rows = await this.database.db.select().from(prefabs).orderBy(asc(prefabs.sortOrder), asc(prefabs.price), asc(prefabs.id));
    return onlyVisible ? rows.filter((row) => row.storeVisible) : rows;
  }

  async get(id: number): Promise<PrefabRow> {
    const [row] = await this.database.db.select().from(prefabs).where(eq(prefabs.id, id)).limit(1);
    if (!row) throw new NotFoundException('No such prefab.');
    return row;
  }

  private async validate(input: PrefabInput): Promise<void> {
    const egg = await this.eggDetails(input.nestId, input.eggId).catch(() => null);
    if (!egg) throw new BadRequestException('That egg no longer exists in Pterodactyl.');
    const known = new Set(egg.variables.map((variable) => variable.envVariable));
    const unknown = Object.keys(input.environment).filter((key) => !known.has(key));
    if (unknown.length > 0) throw new BadRequestException(`Not variables of this egg: ${unknown.join(', ')}.`);
    if (input.locationIds.length === 0) throw new BadRequestException('Choose at least one location to deploy to.');
  }

  async create(input: PrefabInput): Promise<Prefab> {
    await this.validate(input);
    const [created] = await this.database.db.insert(prefabs).values(input).$returningId();
    return toPrefab(await this.get(created!.id));
  }

  async update(id: number, input: PrefabInput): Promise<Prefab> {
    await this.get(id);
    await this.validate(input);
    await this.database.db.update(prefabs).set(input).where(eq(prefabs.id, id));
    return toPrefab(await this.get(id));
  }

  /** Deletes the template only. Servers made from it, and their subscriptions, are untouched. */
  async remove(id: number): Promise<void> {
    await this.get(id);
    await this.database.db.delete(prefabs).where(eq(prefabs.id, id));
  }

  // ---------- Pterodactyl catalogue ----------

  async eggs(refresh = false): Promise<EggSummary[]> {
    if (!refresh && this.eggCache && Date.now() - this.eggCache.at < CATALOGUE_TTL_MS) return this.eggCache.eggs;
    const nests = await this.ptero.nests();
    const eggs: EggSummary[] = [];
    for (const nest of nests) {
      for (const egg of await this.ptero.eggs(nest.id)) {
        eggs.push({
          id: egg.id,
          nestId: nest.id,
          nestName: nest.name,
          name: egg.name,
          description: egg.description ?? '',
          dockerImages: egg.docker_images && Object.keys(egg.docker_images).length > 0 ? egg.docker_images : { [egg.docker_image]: egg.docker_image },
          startup: egg.startup,
        });
      }
    }
    this.eggCache = { at: Date.now(), eggs };
    return eggs;
  }

  async eggDetails(nestId: number, eggId: number): Promise<EggDetails> {
    const egg = await this.ptero.egg(nestId, eggId);
    const nestName = (await this.eggs()).find((entry) => entry.id === eggId)?.nestName ?? '';
    return {
      id: egg.id,
      nestId,
      nestName,
      name: egg.name,
      description: egg.description ?? '',
      dockerImages: egg.docker_images && Object.keys(egg.docker_images).length > 0 ? egg.docker_images : { [egg.docker_image]: egg.docker_image },
      startup: egg.startup,
      variables: (egg.relationships?.variables?.data ?? []).map((item) => ({
        name: item.attributes.name,
        description: item.attributes.description,
        envVariable: item.attributes.env_variable,
        defaultValue: item.attributes.default_value ?? '',
        userEditable: item.attributes.user_editable,
        rules: item.attributes.rules,
      })),
    };
  }

  async locations(): Promise<LocationSummary[]> {
    return (await this.ptero.locations()).map((location) => ({ id: location.id, short: location.short, long: location.long }));
  }

  // ---------- creating servers ----------

  /** Builds Pterodactyl's create-server request: egg defaults, overridden by the prefab's values. */
  async buildServer(prefab: PrefabRow, pteroUserId: number, name: string, description = ''): Promise<PteroCreateServer> {
    const egg = await this.eggDetails(prefab.nestId, prefab.eggId);
    const environment: Record<string, string> = {};
    for (const variable of egg.variables) {
      environment[variable.envVariable] = prefab.environment[variable.envVariable] ?? variable.defaultValue;
    }
    return {
      name,
      description,
      user: pteroUserId,
      egg: prefab.eggId,
      docker_image: prefab.dockerImage,
      startup: prefab.startup,
      environment,
      limits: { memory: prefab.memory, swap: prefab.swap, disk: prefab.disk, io: prefab.io, cpu: prefab.cpu },
      feature_limits: { databases: prefab.databases, allocations: prefab.allocations, backups: prefab.backups },
      deploy: { locations: prefab.locationIds, dedicated_ip: false, port_range: [] },
      start_on_completion: true,
    };
  }

  async createServer(prefab: PrefabRow, pteroUserId: number, name: string): Promise<PteroApplicationServer> {
    return this.ptero.createServer(await this.buildServer(prefab, pteroUserId, name));
  }
}
