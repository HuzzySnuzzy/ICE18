import { SERVER_PERMISSIONS, type PowerSignal, type ServerPermission } from '@ice18/shared';

export interface Viewer {
  isAdmin: boolean;
  pteroUserId: number | null;
}

export interface ServerOwnership {
  ownerId: number;
  subusers: Array<{ userId: number; permissions: string[] }>;
}

/**
 * What a viewer may do on a server, mirroring Pterodactyl's own rules:
 * ICE18 admins and the server owner get everything; Pterodactyl subusers get the
 * permissions they were given there. Returns null when the viewer can't see the server.
 */
export function computePermissions(viewer: Viewer, server: ServerOwnership): ServerPermission[] | null {
  if (viewer.isAdmin) return [...SERVER_PERMISSIONS];
  if (viewer.pteroUserId === null) return null;
  if (server.ownerId === viewer.pteroUserId) return [...SERVER_PERMISSIONS];

  const subuser = server.subusers.find((entry) => entry.userId === viewer.pteroUserId);
  if (!subuser) return null;
  return SERVER_PERMISSIONS.filter((permission) => subuser.permissions.includes(permission));
}

/** Pterodactyl uses control.stop for both stop and kill. */
export function permissionForSignal(signal: PowerSignal): ServerPermission {
  switch (signal) {
    case 'start':
      return 'control.start';
    case 'restart':
      return 'control.restart';
    case 'stop':
    case 'kill':
      return 'control.stop';
  }
}
