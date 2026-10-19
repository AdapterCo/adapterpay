import { ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import {
  BillingError,
  CircuitOpenError,
  ConcurrencyLimitError,
  MpApiError,
  MpReconnectRequiredError,
  PlatformCredentialsError,
  PlanLimitError,
  SubscriptionInactiveError,
  type Logger,
} from '@adapterpay/core';
import { ERROR_CODES, type ApiErrorBody } from '@adapterpay/shared';
import { AppError } from './errors';

/** Converte qualquer erro no formato estável `{ error: { code, message, details, correlationId } }`. */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { correlationId?: string }>();
    if (res.headersSent) return;

    const { status, body, headers } = this.map(exception);
    body.error.correlationId = req.correlationId;
    if (status >= 500) {
      this.logger.error({ err: exception, correlation_id: req.correlationId, path: req.path }, 'erro na requisição');
    }
    for (const [k, v] of Object.entries(headers ?? {})) res.setHeader(k, v);
    res.status(status).json(body);
  }

  private map(e: unknown): { status: number; body: ApiErrorBody; headers?: Record<string, string> } {
    const out = (status: number, code: string, message: string, details?: unknown, headers?: Record<string, string>) => ({
      status,
      body: { error: { code, message, ...(details !== undefined ? { details } : {}) } },
      headers,
    });

    if (e instanceof AppError) return out(e.status, e.code, e.message, e.details, e.headers);
    if (e instanceof ZodError) {
      return out(422, ERROR_CODES.VALIDATION_FAILED, 'Dados inválidos', e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    }
    if (e instanceof PlanLimitError) {
      return out(422, ERROR_CODES.PLAN_LIMIT_REACHED, 'Limite do plano atingido. Faça upgrade ou desative itens.', {
        resource: e.resource,
        used: e.used,
        limit: e.limit,
      });
    }
    if (e instanceof SubscriptionInactiveError) {
      return out(403, ERROR_CODES.SUBSCRIPTION_INACTIVE, 'Assinatura inativa: novas cobranças e ativações estão bloqueadas.', {
        tenantStatus: e.tenantStatus,
      });
    }
    if (e instanceof BillingError) {
      const status = e.code === 'ALREADY_ACTIVE' ? 409 : e.code === 'PROVIDER_ERROR' ? 502 : 422;
      return out(status, e.code, e.message, e.details);
    }
    if (e instanceof PlatformCredentialsError) {
      return out(503, 'PLATFORM_NOT_CONFIGURED', 'Pagamento do plano indisponível no momento: a cobrança da plataforma não está configurada. Avise o suporte da Adapter Co.');
    }
    if (e instanceof MpReconnectRequiredError) {
      return out(409, ERROR_CODES.MP_RECONNECT_REQUIRED, 'A conta Mercado Pago precisa ser reconectada.');
    }
    if (e instanceof CircuitOpenError || e instanceof ConcurrencyLimitError) {
      return out(503, ERROR_CODES.MP_UPSTREAM_ERROR, 'Mercado Pago temporariamente indisponível. Tente novamente.', undefined, {
        'Retry-After': '5',
      });
    }
    if (e instanceof MpApiError) {
      if (e.rateLimited) {
        return out(503, ERROR_CODES.MP_UPSTREAM_ERROR, 'Limite de requisições do Mercado Pago atingido.', undefined, {
          'Retry-After': String(Math.ceil((e.retryAfterMs ?? 5000) / 1000)),
        });
      }
      const b = e.body as { message?: unknown } | null;
      const providerMessage = b && typeof b.message === 'string' ? b.message.slice(0, 300) : null;
      return out(502, ERROR_CODES.MP_UPSTREAM_ERROR, providerMessage ? `O Mercado Pago recusou a operação: ${providerMessage}` : 'Falha na comunicação com o Mercado Pago.', {
        providerStatus: e.status,
        providerCode: e.providerCode,
        providerMessage,
      });
    }
    if (e instanceof HttpException) {
      const status = e.getStatus();
      const code =
        status === 404 ? ERROR_CODES.NOT_FOUND : status === 401 ? ERROR_CODES.UNAUTHENTICATED : status === 403 ? ERROR_CODES.FORBIDDEN : 'HTTP_ERROR';
      return out(status, code, status === 404 ? 'Rota não encontrada' : e.message);
    }
    return out(500, ERROR_CODES.INTERNAL, 'Erro interno. Tente novamente em instantes.');
  }
}
