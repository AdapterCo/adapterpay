import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { raw, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { safeEqual, type CoreDeps } from '@adapterpay/core';
import { AppModule } from './app.module';
import { CORE } from './common/tokens';
import { AppExceptionFilter } from './common/exception.filter';

const REQUEST_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn'] });
  const deps = app.get<CoreDeps>(CORE);
  const { config, logger } = deps;

  // Confia apenas no proxy conhecido (Traefik). Nunca confiar cegamente em X-Forwarded-* externos.
  app.set('trust proxy', config.TRUSTED_PROXIES.split(',').map((s) => s.trim()).filter(Boolean));
  app.disable('x-powered-by');

  const apiHelmet = helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    hsts: { maxAge: 31_536_000, includeSubDomains: true },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });
  const docsHelmet = helmet({ contentSecurityPolicy: false, hsts: { maxAge: 31_536_000, includeSubDomains: true } });
  app.use((req: Request, res: Response, next: NextFunction) =>
    req.path.startsWith('/api/v1/docs') ? docsHelmet(req, res, next) : apiHelmet(req, res, next),
  );
  app.use(cookieParser());
  // Foto de produto: corpo binário só nesta rota (o restante da API continua só JSON).
  app.use(/^\/api\/v1\/products\/[0-9a-f-]{36}\/image$/, raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '3mb' }));
  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id = typeof incoming === 'string' && REQUEST_ID_RE.test(incoming) ? incoming : randomUUID();
        res.setHeader('X-Request-Id', id);
        (req as Request & { correlationId?: string }).correlationId = id;
        return id;
      },
      customProps: (req) => ({ correlation_id: (req as Request & { correlationId?: string }).correlationId }),
      autoLogging: { ignore: (req) => (req.url ?? '').startsWith('/api/v1/health') },
      serializers: {
        req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url?.split('?')[0] }),
      },
    }),
  );

  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new AppExceptionFilter(logger));
  app.enableShutdownHooks();

  // OpenAPI protegido por HTTP Basic; não publicado sem credenciais configuradas.
  if (config.SWAGGER_USER && config.SWAGGER_PASSWORD) {
    const expected = `Basic ${Buffer.from(`${config.SWAGGER_USER}:${config.SWAGGER_PASSWORD}`).toString('base64')}`;
    app.use('/api/v1/docs', (req: Request, res: Response, next: NextFunction) => {
      const got = req.headers.authorization ?? '';
      if (!safeEqual(got, expected)) {
        res.setHeader('WWW-Authenticate', 'Basic realm="AdapterPay API"');
        res.status(401).end();
        return;
      }
      next();
    });
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('AdapterPay API')
        .setDescription('Seu negócio recebe. Você acompanha. — API REST v1')
        .setVersion('1.0.0')
        .addCookieAuth('__Host-ap_session')
        .build(),
    );
    SwaggerModule.setup('api/v1/docs', app, doc, { useGlobalPrefix: false });
  }

  await app.listen(config.API_PORT, '0.0.0.0');
  logger.info({ port: config.API_PORT }, 'AdapterPay API iniciada');
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
