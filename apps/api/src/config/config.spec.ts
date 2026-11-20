import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config';

let dir: string;
let secretFile: string;
const load = (env: Record<string, string>) => loadConfig(env, { secretFile, loadEnvFiles: false });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ice18-config-'));
  secretFile = path.join(dir, '.ice18-secret');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('loadConfig', () => {
  it('starts with nothing filled in, like a freshly created Pterodactyl server', () => {
    // Egg variables left blank arrive as empty strings.
    const config = load({ DB_HOST: '', DB_DATABASE: '', DB_USERNAME: '', DB_PASSWORD: '', APP_SECRET: '', SERVER_PORT: '25570' });
    expect(config.database).toBeNull();
    expect(config.PORT).toBe(25570);
    expect(config.APP_SECRET).toHaveLength(64);
  });

  it('generates the app secret once and reuses it', () => {
    const first = load({}).APP_SECRET;
    expect(fs.readFileSync(secretFile, 'utf8').trim()).toBe(first);
    expect(load({}).APP_SECRET).toBe(first);
  });

  it('prefers an APP_SECRET that is set', () => {
    expect(load({ APP_SECRET: 'x'.repeat(40) }).APP_SECRET).toBe('x'.repeat(40));
    expect(fs.existsSync(secretFile)).toBe(false);
  });

  it('uses separate database fields as-is, so special characters in passwords just work', () => {
    const config = load({
      DB_HOST: '172.18.0.1',
      DB_PORT: '3307',
      DB_DATABASE: 's1_ice18',
      DB_USERNAME: 'u1_abc',
      DB_PASSWORD: 'p@ss:w/rd#!%?',
    });
    expect(config.database).toEqual({
      host: '172.18.0.1',
      port: 3307,
      database: 's1_ice18',
      user: 'u1_abc',
      password: 'p@ss:w/rd#!%?',
    });
  });

  it('still accepts a DATABASE_URL', () => {
    expect(load({ DATABASE_URL: 'mysql://a:b@h:3306/d' }).database).toEqual({ uri: 'mysql://a:b@h:3306/d' });
  });

  it('defaults the database port to 3306', () => {
    expect(load({ DB_HOST: 'h', DB_DATABASE: 'd', DB_USERNAME: 'u' }).database).toMatchObject({ port: 3306, password: '' });
  });
});
