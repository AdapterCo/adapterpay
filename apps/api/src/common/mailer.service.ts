import { Inject, Injectable } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import type { CoreDeps } from '@adapterpay/core';
import { CORE } from './tokens';

/** Email transacional (verificação, recuperação de senha, convites). Não envia dados financeiros. */
@Injectable()
export class MailerService {
  private readonly transport: Transporter | null;

  constructor(@Inject(CORE) private readonly deps: CoreDeps) {
    const c = deps.config;
    this.transport =
      c.SMTP_HOST && c.SMTP_HOST !== 'CHANGE_ME'
        ? nodemailer.createTransport({
            host: c.SMTP_HOST,
            port: c.SMTP_PORT ?? 587,
            secure: c.SMTP_SECURE,
            auth: c.SMTP_USER ? { user: c.SMTP_USER, pass: c.SMTP_PASSWORD } : undefined,
          })
        : null;
  }

  async send(to: string, subject: string, text: string): Promise<void> {
    if (!this.transport) {
      if (this.deps.config.NODE_ENV === 'production') throw new Error('SMTP não configurado');
      // Desenvolvimento local sem SMTP: o link é exibido no log para teste manual.
      this.deps.logger.warn({ to, subject, text }, 'SMTP não configurado (desenvolvimento): email não enviado');
      return;
    }
    await this.transport.sendMail({
      from: this.deps.config.SMTP_FROM,
      to,
      subject: `AdapterPay — ${subject}`,
      text: `${text}\n\n—\nAdapterPay · Seu negócio recebe. Você acompanha.\nUma plataforma da Adapter Co.`,
    });
  }
}
