import { Injectable, Logger } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import type { AuditEntry } from '@ice18/shared';
import { DatabaseService } from '../db/database.service';
import { auditLog, users } from '../db/schema';

/** Records who did what (logins, power actions, console commands, account links). */
@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  constructor(private readonly database: DatabaseService) {}

  async record(userId: number | null, action: string, target?: string | null, detail?: string | null): Promise<void> {
    try {
      await this.database.db.insert(auditLog).values({
        userId,
        action,
        target: target?.slice(0, 128) ?? null,
        detail: detail?.slice(0, 4000) ?? null,
      });
    } catch (error) {
      // Never let a logging failure break the action itself.
      this.logger.error(`Could not write audit entry ${action}: ${(error as Error).message}`);
    }
  }

  async recent(limit = 200): Promise<AuditEntry[]> {
    const rows = await this.database.db
      .select({
        id: auditLog.id,
        userId: auditLog.userId,
        username: users.username,
        action: auditLog.action,
        target: auditLog.target,
        detail: auditLog.detail,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.userId))
      .orderBy(desc(auditLog.id))
      .limit(limit);
    return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  }
}
