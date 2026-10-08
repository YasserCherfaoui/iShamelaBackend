import { z } from 'zod';

const duration = z.string().regex(/^\d+[smhd]$/);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL: duration.default('15m'),
  REFRESH_TOKEN_TTL: duration.default('60d'),
  APPLE_CLIENT_IDS: z.string().min(1),
  APPLE_TEAM_ID: z.string().min(1),
  APPLE_KEY_ID: z.string().min(1),
  APPLE_PRIVATE_KEY: z.string().min(1),
  GOOGLE_CLIENT_IDS: z.string().min(1),
  RESEND_API_KEY: z.string().min(1),
  MAIL_FROM: z.string().min(1),
  MAIL_SMTP_HOST: z.string().min(1).default('localhost'),
  MAIL_SMTP_PORT: z.coerce.number().int().positive().default(1025),
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  FIREBASE_PROJECT_ID: z.string().min(1).default('shamelaonline'),
  CORS_ORIGINS: z.string().min(1),
  PUBLIC_BASE_URL: z.string().url(),
});

export type Env = z.infer<typeof EnvSchema> & {
  appleClientIds: string[];
  googleClientIds: string[];
  corsOrigins: string[];
  applePrivateKey: string;
};

export const ENV = Symbol('ENV');

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment: ${details}`);
  }
  const data = parsed.data;
  return {
    ...data,
    appleClientIds: splitList(data.APPLE_CLIENT_IDS),
    googleClientIds: splitList(data.GOOGLE_CLIENT_IDS),
    corsOrigins: splitList(data.CORS_ORIGINS),
    applePrivateKey: data.APPLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  };
}

function splitList(value: string): string[] {
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (items.length === 0) {
    throw new Error('Invalid environment: expected a comma-separated list');
  }
  return items;
}

export function addDuration(from: Date, ttl: string): Date {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match) {
    throw new Error(`Invalid duration: ${ttl}`);
  }
  const amount = Number(match[1]);
  const unit = match[2];
  const ms =
    unit === 's'
      ? amount * 1000
      : unit === 'm'
        ? amount * 60_000
        : unit === 'h'
          ? amount * 3_600_000
          : amount * 86_400_000;
  return new Date(from.getTime() + ms);
}
