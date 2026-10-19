import { Controller, Get, HttpCode, Inject, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { randomToken, type CoreDeps } from '@adapterpay/core';
import {
  forgotPasswordSchema,
  loginSchema,
  mfaChallengeSchema,
  mfaVerifySchema,
  registerSchema,
  resetPasswordSchema,
  switchTenantSchema,
  verifyEmailSchema,
} from '@adapterpay/shared';
import { z } from 'zod';
import { CurrentAuth, Meta, type AuthContext, type RequestMeta } from '../common/request';
import { CORE } from '../common/tokens';
import { ApiZodBody, ZBody } from '../common/zod';
import { AuthService } from './auth.service';
import { clearSessionCookie, setCsrfCookie, setSessionCookie } from './cookies';
import { AllowMfaEnrollment, NoTenant, Public } from './decorators';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(CORE) private readonly deps: CoreDeps,
  ) {}

  /** Emite o token CSRF (double submit). Chamado pelo frontend antes de requisições mutáveis. */
  @Public()
  @Get('csrf')
  csrf(@Res({ passthrough: true }) res: Response): { csrfToken: string } {
    const token = randomToken(24);
    setCsrfCookie(res, this.deps.config, token);
    res.setHeader('Cache-Control', 'no-store');
    return { csrfToken: token };
  }

  @Public()
  @Post('register')
  @ApiZodBody(registerSchema)
  async register(@ZBody(registerSchema) body: z.infer<typeof registerSchema>, @Meta() meta: RequestMeta) {
    return this.auth.register(body, meta);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(204)
  async verifyEmail(@ZBody(verifyEmailSchema) body: z.infer<typeof verifyEmailSchema>): Promise<void> {
    await this.auth.verifyEmail(body.token);
  }

  @Public()
  @Post('resend-verification')
  @HttpCode(204)
  async resend(@ZBody(forgotPasswordSchema) body: z.infer<typeof forgotPasswordSchema>, @Meta() meta: RequestMeta): Promise<void> {
    await this.auth.resendVerification(body.email, meta);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiZodBody(loginSchema)
  async login(
    @ZBody(loginSchema) body: z.infer<typeof loginSchema>,
    @Meta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true; mfaEnrollmentRequired: boolean }> {
    const { token, user } = await this.auth.login(body, meta);
    setSessionCookie(res, this.deps.config, token);
    setCsrfCookie(res, this.deps.config, randomToken(24));
    return { ok: true, mfaEnrollmentRequired: user.isSuperadmin && !user.mfaEnabledAt };
  }

  @NoTenant()
  @AllowMfaEnrollment()
  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentAuth() auth: AuthContext, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(auth);
    clearSessionCookie(res, this.deps.config);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(204)
  async forgot(@ZBody(forgotPasswordSchema) body: z.infer<typeof forgotPasswordSchema>, @Meta() meta: RequestMeta): Promise<void> {
    await this.auth.forgotPassword(body.email, meta);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(204)
  async reset(@ZBody(resetPasswordSchema) body: z.infer<typeof resetPasswordSchema>, @Meta() meta: RequestMeta): Promise<void> {
    await this.auth.resetPassword(body.token, body.password, meta);
  }

  @NoTenant()
  @AllowMfaEnrollment()
  @Get('me')
  async me(@CurrentAuth() auth: AuthContext, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return this.auth.me(auth);
  }

  @NoTenant()
  @Post('switch-tenant')
  @HttpCode(204)
  async switchTenant(@CurrentAuth() auth: AuthContext, @ZBody(switchTenantSchema) body: z.infer<typeof switchTenantSchema>): Promise<void> {
    await this.auth.switchTenant(auth, body.tenantId);
  }

  @NoTenant()
  @AllowMfaEnrollment()
  @Post('mfa/setup')
  async mfaSetup(@CurrentAuth() auth: AuthContext) {
    return this.auth.mfaSetup(auth);
  }

  @NoTenant()
  @AllowMfaEnrollment()
  @Post('mfa/enable')
  async mfaEnable(@CurrentAuth() auth: AuthContext, @ZBody(mfaVerifySchema) body: z.infer<typeof mfaVerifySchema>, @Meta() meta: RequestMeta) {
    return this.auth.mfaEnable(auth, body.code, meta);
  }

  /** Step-up: confirma MFA na sessão para operações críticas. */
  @NoTenant()
  @Post('mfa/challenge')
  @HttpCode(204)
  async mfaChallenge(@CurrentAuth() auth: AuthContext, @ZBody(mfaChallengeSchema) body: z.infer<typeof mfaChallengeSchema>): Promise<void> {
    await this.auth.mfaChallenge(auth, body.code);
  }

  @NoTenant()
  @Post('mfa/disable')
  @HttpCode(204)
  async mfaDisable(@CurrentAuth() auth: AuthContext, @ZBody(mfaChallengeSchema) body: z.infer<typeof mfaChallengeSchema>, @Meta() meta: RequestMeta): Promise<void> {
    await this.auth.mfaDisable(auth, body.code, meta);
  }

  @NoTenant()
  @Post('mfa/recovery-codes')
  async recoveryCodes(@CurrentAuth() auth: AuthContext) {
    return this.auth.regenerateRecoveryCodes(auth);
  }
}
