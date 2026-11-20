import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import type { UpdateStatus } from '@ice18/shared';
import { AuditService } from '../audit/audit.service';
import { CONFIG, type AppConfig } from '../config/config';

const execFileAsync = promisify(execFile);

/** Repository root (this file is at apps/api/{src,dist}/updates/). */
export const REPO_ROOT = path.resolve(__dirname, '../../../..');

/** Written by scripts/update.sh with the commit that failed to install. */
export const FAILED_MARKER = path.join(REPO_ROOT, '.ice18-update-failed');

/** scripts/start.sh restarts the panel (and applies the update) on this exit code. */
export const RESTART_FOR_UPDATE_EXIT_CODE = 75;

/** Decides whether a check result should trigger an automatic update. */
export function shouldAutoApply(status: UpdateStatus, failedCommit: string | null = null): boolean {
  return (
    status.supported &&
    status.autoUpdate &&
    status.canRestart &&
    status.updateAvailable &&
    !status.localChanges &&
    status.latestCommit !== failedCommit
  );
}

function readFailedCommit(): string | null {
  try {
    return fs.readFileSync(FAILED_MARKER, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/**
 * Checks the git remote for new ICE18 versions. Applying an update means asking
 * scripts/start.sh to restart the panel: it pulls, reinstalls, rebuilds (rolling back
 * on failure) and starts the new version. This service never touches Pterodactyl.
 */
@Injectable()
export class UpdateService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Updates');
  private timer?: NodeJS.Timeout;
  private firstCheck?: NodeJS.Timeout;
  private restartHandler?: () => Promise<void>;
  private restarting = false;
  private status: UpdateStatus;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly audit: AuditService,
  ) {
    this.status = {
      supported: fs.existsSync(path.join(REPO_ROOT, '.git')),
      branch: config.GIT_BRANCH,
      currentCommit: null,
      latestCommit: null,
      updateAvailable: false,
      localChanges: false,
      autoUpdate: config.AUTO_UPDATE,
      canRestart: config.ICE18_SUPERVISED,
      checking: false,
      lastCheckedAt: null,
      lastError: null,
    };
  }

  /** main.ts provides how to shut down cleanly before exiting for an update. */
  setRestartHandler(handler: () => Promise<void>): void {
    this.restartHandler = handler;
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.status.supported) {
      this.logger.log('Not running from a git checkout; automatic updates are off.');
      return;
    }
    this.status.currentCommit = await this.git('rev-parse', 'HEAD').catch(() => null);
    // start.sh already updated on boot, so the first check can wait a minute.
    this.firstCheck = setTimeout(() => void this.check(), 60_000);
    this.timer = setInterval(() => void this.check(), this.config.UPDATE_CHECK_MINUTES * 60_000);
    this.firstCheck.unref();
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearTimeout(this.firstCheck);
    clearInterval(this.timer);
  }

  getStatus(): UpdateStatus {
    return { ...this.status };
  }

  private async git(...args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', ['-c', `safe.directory=${REPO_ROOT}`, ...args], {
      cwd: REPO_ROOT,
      timeout: 120_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return stdout.trim();
  }

  async check(): Promise<UpdateStatus> {
    if (!this.status.supported || this.status.checking || this.restarting) return this.getStatus();
    this.status.checking = true;
    try {
      await this.git('fetch', '--quiet', '--depth', '1', 'origin', this.config.GIT_BRANCH);
      const [current, latest, changes] = await Promise.all([
        this.git('rev-parse', 'HEAD'),
        this.git('rev-parse', 'FETCH_HEAD'),
        this.git('status', '--porcelain', '--untracked-files=no'),
      ]);
      Object.assign(this.status, {
        currentCommit: current,
        latestCommit: latest,
        updateAvailable: current !== latest,
        localChanges: changes.length > 0,
        lastError: null,
      });
      const failed = readFailedCommit();
      if (failed && failed === latest && latest !== current) {
        this.status.lastError = `Version ${this.short(failed)} failed to install and was rolled back. Staying on ${this.short(current)} until a newer version is pushed.`;
      }
    } catch (error) {
      this.status.lastError = `Could not check for updates: ${(error as Error).message.split('\n')[0]}`;
      this.logger.warn(this.status.lastError);
    } finally {
      this.status.checking = false;
      this.status.lastCheckedAt = new Date().toISOString();
    }

    if (shouldAutoApply(this.status, readFailedCommit())) {
      this.logger.log(`Update available (${this.short(this.status.latestCommit)}); restarting to apply it.`);
      await this.audit.record(null, 'system.auto_update', this.short(this.status.latestCommit));
      this.restart();
    } else if (this.status.updateAvailable && this.status.localChanges) {
      this.logger.warn('Update available, but ICE18 files were edited by hand. Not updating automatically.');
    }
    return this.getStatus();
  }

  /** Admin clicked "Update & restart". */
  async apply(userId: number): Promise<void> {
    if (!this.status.canRestart || !this.restartHandler) {
      throw new BadRequestException(
        "ICE18 wasn't started with scripts/start.sh, so it can't restart itself. Update it with `bash scripts/update.sh` and restart it.",
      );
    }
    if (this.status.localChanges) {
      throw new BadRequestException('ICE18 files were edited by hand. Commit or discard those changes before updating.');
    }
    // An admin retrying a version that failed before: let update.sh try it again.
    fs.rmSync(FAILED_MARKER, { force: true });
    await this.audit.record(userId, 'system.update', this.short(this.status.latestCommit));
    this.restart();
  }

  private restart(): void {
    if (this.restarting || !this.restartHandler) return;
    this.restarting = true;
    // Give the HTTP response a moment to go out before shutting down.
    setTimeout(() => void this.restartHandler!(), 500);
  }

  private short(commit: string | null): string {
    return commit ? commit.slice(0, 7) : 'unknown';
  }
}
