import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { ZodValidationException } from 'nestjs-zod';
import { ThrottlerException } from '@nestjs/throttler';

import { ApiException } from './api.exception';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof ApiException) {
      const body = exception.getResponse() as { code: string; message: string };
      response.status(exception.getStatus()).json({ error: body });
      return;
    }

    if (exception instanceof ZodValidationException) {
      response.status(HttpStatus.BAD_REQUEST).json({
        error: { code: 'VALIDATION_ERROR', message: 'Request validation failed' },
      });
      return;
    }

    if (exception instanceof ThrottlerException) {
      response.status(HttpStatus.TOO_MANY_REQUESTS).json({
        error: { code: 'RATE_LIMITED', message: 'Too many requests' },
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      response.status(status).json({
        error: {
          code: status === HttpStatus.UNAUTHORIZED ? 'UNAUTHORIZED' : 'HTTP_ERROR',
          message: exception.message,
        },
      });
      return;
    }

    if (process.env.NODE_ENV !== 'test') {
      const message = exception instanceof Error ? exception.message : 'unknown error';
      this.logger.error(message);
    }
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: { code: 'INTERNAL', message: 'Internal server error' },
    });
  }
}
