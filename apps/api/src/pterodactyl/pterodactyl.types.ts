// Shapes of the Pterodactyl API responses ICE18 reads. Only the fields we use.

export interface PteroList<T> {
  object: 'list';
  data: T[];
  meta?: {
    pagination?: {
      total: number;
      count: number;
      per_page: number;
      current_page: number;
      total_pages: number;
    };
  };
}

export interface PteroItem<T, O extends string = string> {
  object: O;
  attributes: T;
}

export interface PteroSubuser {
  user_id: number;
  permissions: string[];
}

export interface PteroNode {
  id: number;
  name: string;
}

export interface PteroEgg {
  id: number;
  name: string;
}

export interface PteroApplicationServer {
  id: number;
  uuid: string;
  identifier: string;
  name: string;
  description: string | null;
  status: string | null;
  suspended: boolean;
  limits: { memory: number; disk: number; cpu: number; swap: number; io: number };
  user: number;
  node: number;
  egg: number;
  relationships?: {
    subusers?: PteroList<PteroItem<PteroSubuser>>;
    node?: PteroItem<PteroNode>;
    egg?: PteroItem<PteroEgg>;
  };
}

export interface PteroApplicationUser {
  id: number;
  username: string;
  email: string;
  root_admin: boolean;
}

export interface PteroClientAccount {
  id: number;
  admin: boolean;
  username: string;
  email: string;
}

export interface PteroResources {
  current_state: string;
  is_suspended: boolean;
  resources: {
    memory_bytes: number;
    cpu_absolute: number;
    disk_bytes: number;
    network_rx_bytes: number;
    network_tx_bytes: number;
    uptime: number;
  };
}

export interface PteroWebsocketCredentials {
  data: { token: string; socket: string };
}

export interface PteroFileObject {
  name: string;
  mode: string;
  size: number;
  is_file: boolean;
  is_symlink: boolean;
  mimetype: string;
  modified_at: string;
}

export interface PteroServerDatabase {
  id: string;
  host: { address: string; port: number };
  name: string;
  username: string;
  connections_from: string;
  max_connections: number;
  relationships?: {
    password?: PteroItem<{ password: string }>;
  };
}

export interface PteroSubuserFull {
  uuid: string;
  username: string;
  email: string;
  image?: string;
  '2fa_enabled': boolean;
  created_at: string | null;
  permissions: string[];
}

export interface PteroEggVariable {
  name: string;
  description: string;
  env_variable: string;
  default_value: string;
  server_value: string | null;
  is_editable: boolean;
  rules: string;
}

export interface PteroStartupMeta {
  startup_command: string;
  raw_startup_command: string;
  docker_images: Record<string, string>;
}

export interface PteroAllocation {
  id: number;
  ip: string;
  ip_alias: string | null;
  port: number;
  notes: string | null;
  is_default: boolean;
}
