import { Inject, Injectable } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { Resend } from 'resend';

import { ENV, type Env } from '../config/env';

export const MAIL = Symbol('MAIL');

export interface MailSender {
  sendOtp(to: string, code: string): Promise<void>;
}

export class InMemoryMailSender implements MailSender {
  readonly sent: { to: string; code: string }[] = [];

  async sendOtp(to: string, code: string): Promise<void> {
    this.sent.push({ to: to.toLowerCase(), code });
  }

  latest(to: string): string | undefined {
    return this.sent.filter((row) => row.to === to.toLowerCase()).at(-1)?.code;
  }
}

@Injectable()
export class SmtpMailSender implements MailSender {
  constructor(@Inject(ENV) private readonly env: Env) {}

  async sendOtp(to: string, code: string): Promise<void> {
    const transport = nodemailer.createTransport({
      host: this.env.MAIL_SMTP_HOST,
      port: this.env.MAIL_SMTP_PORT,
      secure: false,
    });
    await transport.sendMail({
      from: this.env.MAIL_FROM,
      to,
      subject: 'Your iShamela sign-in code',
      text: `Your sign-in code is ${code}. It expires in ${this.env.OTP_TTL_SECONDS / 60} minutes.`,
    });
  }
}

@Injectable()
export class ResendMailSender implements MailSender {
  private readonly client: Resend;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.client = new Resend(env.RESEND_API_KEY);
  }

  async sendOtp(to: string, code: string): Promise<void> {
    const result = await this.client.emails.send({
      from: this.env.MAIL_FROM,
      to,
      subject: 'Your iShamela sign-in code',
      text: `Your sign-in code is ${code}. It expires in ${this.env.OTP_TTL_SECONDS / 60} minutes.`,
    });
    if (result.error) {
      throw new Error('Mail delivery failed');
    }
  }
}

export function mailSenderFor(env: Env): MailSender {
  if (env.NODE_ENV === 'test') return new InMemoryMailSender();
  if (env.NODE_ENV === 'development') return new SmtpMailSender(env);
  return new ResendMailSender(env);
}
