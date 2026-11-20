import { BadRequestException } from '@nestjs/common';
import type { z } from 'zod';

/** Validates a request body with zod and returns a readable 400 when it doesn't fit. */
export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.join('.');
    throw new BadRequestException(field ? `${field}: ${issue?.message}` : (issue?.message ?? 'Invalid request'));
  }
  return result.data;
}
