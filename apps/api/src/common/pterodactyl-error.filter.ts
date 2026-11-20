import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { PterodactylError } from '../pterodactyl/pterodactyl.http';
import { BlockedPterodactylRequestError } from '../pterodactyl/safety';

/** Turns Pterodactyl failures into clear API errors instead of a generic 500. */
@Catch(PterodactylError, BlockedPterodactylRequestError)
export class PterodactylErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('Pterodactyl');

  catch(error: PterodactylError | BlockedPterodactylRequestError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (error instanceof BlockedPterodactylRequestError) {
      // A bug in ICE18 tried something the safety rules forbid. Log loudly.
      this.logger.error(error.message);
      response.status(500).json({ statusCode: 500, message: error.message });
      return;
    }
    this.logger.warn(`${error.request ?? 'Pterodactyl request'} failed: ${error.message}`);
    const status = error.status === 404 ? 404 : 502;
    const message = error.fromWings
      ? `${error.message} — This came from the server's node (Wings), not ICE18. Check the node is online in Pterodactyl (Admin → Nodes); the Wings log on that node has the details.`
      : error.message;
    response.status(status).json({ statusCode: status, message });
  }
}
