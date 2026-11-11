import { z } from 'zod';

const DEFAULT_SESSION_SECRET = 'dev-only-secret-change-me';
const DEFAULT_APP_URL = 'http://localhost:5173';
const publicUrl = z.url().refine((url) => !url.endsWith('/'), 'Must not end with a slash');

export const EnvSchema = z
  .object({
    /** sandbox without credentials falls back to simulated at runtime, with a notice. */
    PAYPAL_MODE: z.enum(['mock', 'sandbox']).default('mock'),
    PAYPAL_CLIENT_ID: z.string().optional(),
    PAYPAL_CLIENT_SECRET: z.string().optional(),
    PAYPAL_WEBHOOK_ID: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    REVIEW_MODEL: z.string().trim().min(1).default('claude-sonnet-5-5'),
    LLM_PROVIDER: z.enum(['mock', 'anthropic']).default('mock'),
    CHANNEL3_MODE: z.enum(['recorded', 'live']).default('recorded'),
    CHANNEL3_API_KEY: z.string().optional(),
    CHANNEL3_DAILY_SEARCH_LIMIT: z.coerce.number().int().min(0).default(2000),
    DATABASE_URL: z.string().default('pglite://.data/dev'),
    /**
     * Public origin, used for PayPal return URLs and the cookie's Secure flag. Unset,
     * it falls back to Render's RENDER_EXTERNAL_URL and then to the local default.
     */
    APP_URL: publicUrl.optional(),
    /** Injected by Render on every web service; a trailing slash is normalised. */
    RENDER_EXTERNAL_URL: z
      .url()
      .transform((url) => url.replace(/\/$/, ''))
      .optional(),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    SESSION_SECRET: z.string().min(1).default(DEFAULT_SESSION_SECRET),
    CAP_AMOUNT_CENTS: z.coerce.number().int().positive().default(300000),
    SANDBOX_BUYER_EMAIL: z.string().optional(),
    SANDBOX_BUYER_PASSWORD: z.string().optional(),
    WEB_DIST_DIR: z.string().optional(),
  })
  .transform(({ APP_URL, RENDER_EXTERNAL_URL, ...rest }) => ({
    ...rest,
    APP_URL: APP_URL ?? RENDER_EXTERNAL_URL ?? DEFAULT_APP_URL,
    ...(RENDER_EXTERNAL_URL ? { RENDER_EXTERNAL_URL } : {}),
  }))
  .superRefine((env, ctx) => {
    if (env.APP_URL.startsWith('https:') && env.SESSION_SECRET === DEFAULT_SESSION_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['SESSION_SECRET'],
        message: 'Use a custom session secret for HTTPS',
      });
    }
    if (env.RENDER_EXTERNAL_URL && !env.APP_URL.startsWith('https:')) {
      ctx.addIssue({ code: 'custom', path: ['APP_URL'], message: 'Must be https on Render' });
    }
  });
export type Env = z.infer<typeof EnvSchema>;

export class InvalidEnvError extends Error {
  constructor(readonly variables: string[]) {
    super(`Invalid environment variables: ${variables.join(', ')}`);
    this.name = 'InvalidEnvError';
  }
}

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  // An empty value (KEY= in a .env, a blank field in a dashboard) means "unset".
  const defined = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ''),
  );
  const result = EnvSchema.safeParse(defined);
  if (!result.success) {
    throw new InvalidEnvError([
      ...new Set(result.error.issues.map((issue) => issue.path.join('.'))),
    ]);
  }
  return result.data;
}

/** True when sandbox mode has the credentials it needs; otherwise sessions run simulated. */
export function hasSandboxCredentials(env: Env): boolean {
  return Boolean(env.PAYPAL_CLIENT_ID?.trim() && env.PAYPAL_CLIENT_SECRET?.trim());
}
