import { HttpException, HttpStatus } from '@nestjs/common';

export class ApiException extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    status: HttpStatus,
  ) {
    super({ code, message }, status);
  }
}

export function unauthorized(message = 'Authentication required'): ApiException {
  return new ApiException('UNAUTHORIZED', message, HttpStatus.UNAUTHORIZED);
}

export function tokenInvalid(message: string): ApiException {
  return new ApiException('TOKEN_INVALID', message, HttpStatus.UNAUTHORIZED);
}
