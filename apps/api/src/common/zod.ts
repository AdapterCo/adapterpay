import { applyDecorators, Body, Injectable, type PipeTransform, Query } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import type { ZodTypeAny, z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/** Validação rigorosa: o corpo é substituído pelo resultado do parse (campos desconhecidos são descartados). */
@Injectable()
export class ZodPipe<T extends ZodTypeAny> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    return this.schema.parse(value ?? {});
  }
}

export const ZBody = <T extends ZodTypeAny>(schema: T) => Body(new ZodPipe(schema));
export const ZQuery = <T extends ZodTypeAny>(schema: T) => Query(new ZodPipe(schema));

/** Documenta o corpo no OpenAPI a partir do schema zod compartilhado. */
export const ApiZodBody = (schema: ZodTypeAny) =>
  applyDecorators(ApiBody({ schema: zodToJsonSchema(schema, { target: 'openApi3' }) as Record<string, unknown> }));
