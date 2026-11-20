import type { Request } from 'express';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Allocation, FileEntry, PermissionCatalogue, ServerPermission, StartupInfo, Subuser } from '@ice18/shared';
import { AuditService } from '../audit/audit.service';
import type { UserRow } from '../db/schema';
import { uploadToSignedUrl } from '../pterodactyl/pterodactyl.http';
import { PterodactylService } from '../pterodactyl/pterodactyl.service';
import type { PteroAllocation, PteroSubuserFull } from '../pterodactyl/pterodactyl.types';
import { MAX_DELETE_ITEMS, safeFilePath, safeRelativePath } from '../pterodactyl/safety';
import { ServersService, type ServerAccess } from '../servers/servers.service';
import { isPlainName, knownPermissions, ungrantable } from './grants';

const UPLOAD_MAX_BYTES = Number(process.env.UPLOAD_MAX_MB || 100) * 1024 * 1024;
const CATALOGUE_TTL_MS = 60 * 60_000;

const joinPath = (root: string, name: string) => `${root.replace(/\/+$/, '')}/${name}`;

function toSubuser(user: PteroSubuserFull): Subuser {
  return {
    uuid: user.uuid,
    username: user.username,
    email: user.email,
    twoFactor: user['2fa_enabled'],
    createdAt: user.created_at,
    permissions: user.permissions,
  };
}

function toAllocation(allocation: PteroAllocation): Allocation {
  return {
    id: allocation.id,
    ip: allocation.ip,
    ipAlias: allocation.ip_alias,
    port: allocation.port,
    notes: allocation.notes,
    isDefault: allocation.is_default,
  };
}

/**
 * Files, users, startup and network for one server. Every method checks the viewer's
 * Pterodactyl permissions first, because ICE18 itself talks to Pterodactyl as an admin.
 */
@Injectable()
export class ManageService {
  private catalogue?: { at: number; value: PermissionCatalogue };

  constructor(
    private readonly servers: ServersService,
    private readonly ptero: PterodactylService,
    private readonly audit: AuditService,
  ) {}

  private async require(user: UserRow, identifier: string, needed: ServerPermission[]): Promise<ServerAccess> {
    const access = await this.servers.getForUser(user, identifier);
    const missing = needed.filter((permission) => !access.permissions.includes(permission));
    if (missing.length > 0) throw new ForbiddenException(`You need these permissions on this server: ${missing.join(', ')}.`);
    return access;
  }

  private path(value: unknown, label = 'path'): string {
    if (!safeFilePath(value)) throw new BadRequestException(`Invalid ${label}.`);
    return value;
  }

  // ---------- files ----------

  async list(user: UserRow, identifier: string, directory: string): Promise<FileEntry[]> {
    await this.require(user, identifier, ['file.read']);
    const entries = await this.ptero.listFiles(identifier, this.path(directory, 'directory'));
    return entries
      .map((entry) => ({
        name: entry.name,
        isFile: entry.is_file,
        isSymlink: entry.is_symlink,
        size: entry.size,
        mimetype: entry.mimetype,
        modifiedAt: entry.modified_at || null,
        mode: entry.mode,
      }))
      .sort((a, b) => Number(a.isFile) - Number(b.isFile) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  }

  async read(user: UserRow, identifier: string, file: string): Promise<string> {
    await this.require(user, identifier, ['file.read-content']);
    return this.ptero.readFile(identifier, this.path(file, 'file'));
  }

  async write(user: UserRow, identifier: string, file: string, content: string, create: boolean): Promise<void> {
    await this.require(user, identifier, create ? ['file.create'] : ['file.update']);
    await this.ptero.writeFile(identifier, this.path(file, 'file'), content);
    await this.audit.record(user.id, create ? 'server.file.create' : 'server.file.write', identifier, file);
  }

  async downloadUrl(user: UserRow, identifier: string, file: string): Promise<string> {
    await this.require(user, identifier, ['file.read-content']);
    const url = await this.ptero.signedDownloadUrl(identifier, this.path(file, 'file'));
    await this.audit.record(user.id, 'server.file.download', identifier, file);
    return url;
  }

  async upload(user: UserRow, identifier: string, directory: string, name: string, request: Request): Promise<void> {
    await this.require(user, identifier, ['file.create']);
    const dir = this.path(directory, 'directory');
    if (!isPlainName(name)) throw new BadRequestException('Invalid file name.');
    const declared = Number(request.headers['content-length'] ?? 0);
    if (declared > UPLOAD_MAX_BYTES) throw new PayloadTooLargeException(`Uploads are limited to ${UPLOAD_MAX_BYTES / 1048576} MB (UPLOAD_MAX_MB).`);

    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > UPLOAD_MAX_BYTES) throw new PayloadTooLargeException(`Uploads are limited to ${UPLOAD_MAX_BYTES / 1048576} MB (UPLOAD_MAX_MB).`);
      chunks.push(chunk);
    }
    const url = await this.ptero.signedUploadUrl(identifier);
    await uploadToSignedUrl(url, dir, name, Buffer.concat(chunks));
    await this.audit.record(user.id, 'server.file.upload', identifier, joinPath(dir, name));
  }

  async createFolder(user: UserRow, identifier: string, root: string, name: string): Promise<void> {
    await this.require(user, identifier, ['file.create']);
    if (!isPlainName(name)) throw new BadRequestException('Invalid folder name.');
    await this.ptero.createFolder(identifier, this.path(root, 'folder'), name);
    await this.audit.record(user.id, 'server.file.create_folder', identifier, joinPath(root, name));
  }

  async rename(user: UserRow, identifier: string, root: string, from: string, to: string): Promise<void> {
    await this.require(user, identifier, ['file.update']);
    if (!safeRelativePath(from) || !safeRelativePath(to)) throw new BadRequestException('Invalid name.');
    await this.ptero.renameFiles(identifier, this.path(root, 'folder'), [{ from, to }]);
    await this.audit.record(user.id, 'server.file.rename', identifier, `${joinPath(root, from)} -> ${joinPath(root, to)}`);
  }

  async copy(user: UserRow, identifier: string, location: string): Promise<void> {
    await this.require(user, identifier, ['file.create']);
    await this.ptero.copyFile(identifier, this.path(location, 'file'));
    await this.audit.record(user.id, 'server.file.copy', identifier, location);
  }

  async compress(user: UserRow, identifier: string, root: string, files: string[]): Promise<FileEntry> {
    await this.require(user, identifier, ['file.archive']);
    if (files.length === 0 || !files.every(isPlainName)) throw new BadRequestException('Invalid files to compress.');
    const archive = await this.ptero.compressFiles(identifier, this.path(root, 'folder'), files);
    await this.audit.record(user.id, 'server.file.compress', identifier, `${root}: ${files.join(', ')}`.slice(0, 500));
    return {
      name: archive.name,
      isFile: true,
      isSymlink: false,
      size: archive.size,
      mimetype: archive.mimetype,
      modifiedAt: archive.modified_at || null,
      mode: archive.mode,
    };
  }

  async decompress(user: UserRow, identifier: string, root: string, file: string): Promise<void> {
    await this.require(user, identifier, ['file.archive']);
    if (!isPlainName(file)) throw new BadRequestException('Invalid archive name.');
    await this.ptero.decompressFile(identifier, this.path(root, 'folder'), file);
    await this.audit.record(user.id, 'server.file.decompress', identifier, joinPath(root, file));
  }

  /** Real delete, owner-approved. The UI confirms first; the safety rules cap and check it. */
  async delete(user: UserRow, identifier: string, root: string, files: string[]): Promise<void> {
    await this.require(user, identifier, ['file.delete']);
    if (files.length === 0 || files.length > MAX_DELETE_ITEMS || !files.every(isPlainName)) {
      throw new BadRequestException(`Choose between 1 and ${MAX_DELETE_ITEMS} files or folders to delete.`);
    }
    await this.ptero.deleteFiles(identifier, this.path(root, 'folder'), files);
    await this.audit.record(user.id, 'server.file.delete', identifier, files.map((name) => joinPath(root, name)).join(', ').slice(0, 3900));
  }

  // ---------- users ----------

  async permissionCatalogue(): Promise<PermissionCatalogue> {
    if (this.catalogue && Date.now() - this.catalogue.at < CATALOGUE_TTL_MS) return this.catalogue.value;
    const value = await this.ptero.permissionCatalogue();
    this.catalogue = { at: Date.now(), value };
    return value;
  }

  async subusers(user: UserRow, identifier: string): Promise<{ users: Subuser[]; grantable: string[] | '*' }> {
    const access = await this.require(user, identifier, ['user.read']);
    return { users: (await this.ptero.listSubusers(identifier)).map(toSubuser), grantable: access.grantable };
  }

  private async checkGrant(access: ServerAccess, permissions: string[]): Promise<string[]> {
    const { known, unknown } = knownPermissions(permissions, await this.permissionCatalogue());
    if (unknown.length > 0) throw new BadRequestException(`Unknown permissions: ${unknown.join(', ')}.`);
    const notYours = ungrantable(known, access.grantable);
    if (notYours.length > 0) {
      throw new ForbiddenException(`You can't give permissions you don't have yourself: ${notYours.join(', ')}.`);
    }
    // Pterodactyl requires websocket.connect for any console access; it adds it itself too.
    return known;
  }

  async addSubuser(user: UserRow, identifier: string, email: string, permissions: string[]): Promise<Subuser> {
    const access = await this.require(user, identifier, ['user.create']);
    const granted = await this.checkGrant(access, permissions);
    const created = await this.ptero.createSubuser(identifier, email.trim().toLowerCase(), granted);
    await this.audit.record(user.id, 'server.user.add', identifier, `${created.email}: ${granted.join(', ')}`);
    return toSubuser(created);
  }

  async updateSubuser(user: UserRow, identifier: string, uuid: string, permissions: string[]): Promise<Subuser> {
    const access = await this.require(user, identifier, ['user.update']);
    const target = (await this.ptero.listSubusers(identifier)).find((entry) => entry.uuid === uuid);
    if (!target) throw new BadRequestException('That user is not on this server.');
    const granted = await this.checkGrant(access, permissions);
    const updated = await this.ptero.updateSubuser(identifier, uuid, granted);
    this.servers.invalidate();
    await this.audit.record(user.id, 'server.user.update', identifier, `${updated.email}: ${granted.join(', ')}`);
    return toSubuser(updated);
  }

  async removeSubuser(user: UserRow, identifier: string, uuid: string): Promise<void> {
    await this.require(user, identifier, ['user.delete']);
    const target = (await this.ptero.listSubusers(identifier)).find((entry) => entry.uuid === uuid);
    if (!target) throw new BadRequestException('That user is not on this server.');
    await this.ptero.removeSubuser(identifier, uuid);
    this.servers.invalidate();
    await this.audit.record(user.id, 'server.user.remove', identifier, target.email);
  }

  // ---------- startup & settings ----------

  async startup(user: UserRow, identifier: string): Promise<StartupInfo> {
    await this.require(user, identifier, ['startup.read']);
    const { variables, meta } = await this.ptero.startup(identifier);
    return {
      startupCommand: meta.startup_command,
      rawStartupCommand: meta.raw_startup_command,
      dockerImages: meta.docker_images ?? {},
      variables: variables.map((variable) => ({
        name: variable.name,
        description: variable.description,
        envVariable: variable.env_variable,
        defaultValue: variable.default_value,
        serverValue: variable.server_value,
        isEditable: variable.is_editable,
        rules: variable.rules,
      })),
    };
  }

  async setVariable(user: UserRow, identifier: string, key: string, value: string): Promise<void> {
    await this.require(user, identifier, ['startup.update']);
    const { variables } = await this.ptero.startup(identifier);
    const variable = variables.find((entry) => entry.env_variable === key);
    if (!variable) throw new BadRequestException(`Unknown variable ${key}.`);
    if (!variable.is_editable) throw new ForbiddenException(`${variable.name} can only be changed by an admin in Pterodactyl.`);
    await this.ptero.updateStartupVariable(identifier, key, value);
    // The value may be a secret: log which variable changed, not what to.
    await this.audit.record(user.id, 'server.startup.variable', identifier, key);
  }

  async renameServer(user: UserRow, identifier: string, name: string, description: string | undefined): Promise<void> {
    await this.require(user, identifier, ['settings.rename']);
    await this.ptero.renameServer(identifier, name.trim(), description);
    this.servers.invalidate();
    await this.audit.record(user.id, 'server.rename', identifier, name.trim());
  }

  // ---------- network ----------

  async allocations(user: UserRow, identifier: string): Promise<Allocation[]> {
    await this.require(user, identifier, ['allocation.read']);
    return (await this.ptero.allocations(identifier)).map(toAllocation).sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.port - b.port);
  }

  async addAllocation(user: UserRow, identifier: string): Promise<Allocation> {
    await this.require(user, identifier, ['allocation.create']);
    const added = toAllocation(await this.ptero.assignAllocation(identifier));
    await this.audit.record(user.id, 'server.allocation.add', identifier, `${added.ip}:${added.port}`);
    return added;
  }

  async setNotes(user: UserRow, identifier: string, id: number, notes: string | null): Promise<Allocation> {
    await this.require(user, identifier, ['allocation.update']);
    const updated = toAllocation(await this.ptero.setAllocationNotes(identifier, id, notes));
    await this.audit.record(user.id, 'server.allocation.notes', identifier, `${updated.ip}:${updated.port}`);
    return updated;
  }

  async setPrimary(user: UserRow, identifier: string, id: number): Promise<Allocation> {
    await this.require(user, identifier, ['allocation.update']);
    const updated = toAllocation(await this.ptero.setPrimaryAllocation(identifier, id));
    await this.audit.record(user.id, 'server.allocation.primary', identifier, `${updated.ip}:${updated.port}`);
    return updated;
  }
}
