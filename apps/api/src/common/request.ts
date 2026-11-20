import type { Request } from 'express';
import type { UserRow } from '../db/schema';

export interface AppRequest extends Request {
  user?: UserRow;
}
