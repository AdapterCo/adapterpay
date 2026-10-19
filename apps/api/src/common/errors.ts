import { ERROR_CODES, type ErrorCode } from '@adapterpay/shared';

/** Erro de aplicação com status HTTP e código estável. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | string,
    message: string,
    readonly details?: unknown,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errors = {
  unauthenticated: () => new AppError(401, ERROR_CODES.UNAUTHENTICATED, 'Faça login para continuar'),
  forbidden: (msg = 'Você não tem permissão para esta operação') => new AppError(403, ERROR_CODES.FORBIDDEN, msg),
  notFound: (what = 'Recurso') => new AppError(404, ERROR_CODES.NOT_FOUND, `${what} não encontrado`),
  validation: (msg: string, details?: unknown) => new AppError(422, ERROR_CODES.VALIDATION_FAILED, msg, details),
  conflict: (msg: string, details?: unknown) => new AppError(409, ERROR_CODES.CONFLICT, msg, details),
  mfaRequired: () => new AppError(403, ERROR_CODES.MFA_REQUIRED, 'Confirme com o código do autenticador'),
  mfaEnrollment: () =>
    new AppError(403, ERROR_CODES.MFA_ENROLLMENT_REQUIRED, 'Ative a autenticação em dois fatores para continuar'),
  notImplemented: (msg: string) => new AppError(501, ERROR_CODES.NOT_IMPLEMENTED, msg),
};
