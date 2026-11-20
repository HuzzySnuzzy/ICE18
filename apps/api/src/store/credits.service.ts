import { BadRequestException, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { CreditTransaction, Wallet } from '@ice18/shared';
import { DatabaseService } from '../db/database.service';
import { creditTransactions, users } from '../db/schema';

export class InsufficientCreditsError extends BadRequestException {
  constructor(needed: number, balance: number) {
    super(`Not enough credits: this costs ${needed}, your balance is ${balance}. Ask an admin to top up your credits.`);
  }
}

/**
 * The only place credits change. Every change is atomic (the balance can never go below
 * zero, even with two orders at once) and recorded in credit_transactions.
 */
@Injectable()
export class CreditsService {
  constructor(private readonly database: DatabaseService) {}

  async balance(userId: number): Promise<number> {
    const [row] = await this.database.db.select({ credits: users.credits }).from(users).where(eq(users.id, userId)).limit(1);
    return row?.credits ?? 0;
  }

  /** Adds (positive) or takes (negative) credits. Throws InsufficientCreditsError instead of going negative. */
  async adjust(
    userId: number,
    amount: number,
    reason: string,
    options: { createdBy?: number; subscriptionId?: number } = {},
  ): Promise<{ transactionId: number; balance: number }> {
    if (!Number.isInteger(amount)) throw new BadRequestException('Credit amounts must be whole numbers.');
    return this.database.db.transaction(async (tx) => {
      const [result] = await tx
        .update(users)
        .set({ credits: sql`${users.credits} + ${amount}` })
        .where(and(eq(users.id, userId), sql`${users.credits} + ${amount} >= 0`));
      if ((result as unknown as { affectedRows: number }).affectedRows !== 1) {
        const [row] = await tx.select({ credits: users.credits }).from(users).where(eq(users.id, userId)).limit(1);
        if (!row) throw new BadRequestException('No such user.');
        throw new InsufficientCreditsError(-amount, row.credits);
      }
      const [row] = await tx.select({ credits: users.credits }).from(users).where(eq(users.id, userId)).limit(1);
      const balance = row!.credits;
      const [inserted] = await tx
        .insert(creditTransactions)
        .values({
          userId,
          amount,
          balanceAfter: balance,
          reason: reason.slice(0, 255),
          createdBy: options.createdBy ?? null,
          subscriptionId: options.subscriptionId ?? null,
        })
        .$returningId();
      return { transactionId: inserted!.id, balance };
    });
  }

  async linkTransaction(transactionId: number, subscriptionId: number): Promise<void> {
    await this.database.db.update(creditTransactions).set({ subscriptionId }).where(eq(creditTransactions.id, transactionId));
  }

  async wallet(userId: number): Promise<Wallet> {
    const rows = await this.database.db
      .select()
      .from(creditTransactions)
      .where(eq(creditTransactions.userId, userId))
      .orderBy(desc(creditTransactions.id))
      .limit(100);
    const transactions: CreditTransaction[] = rows.map((row) => ({
      id: row.id,
      amount: row.amount,
      balanceAfter: row.balanceAfter,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
    }));
    return { credits: await this.balance(userId), transactions };
  }
}
