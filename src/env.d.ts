/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly RECOVERY_ENABLED: string;
  readonly RECOVERY_EMAIL_ENABLED: string;
  readonly RECOVERY_ENCRYPTION_KEY: string;
  readonly UPSTASH_REDIS_REST_URL: string;
  readonly UPSTASH_REDIS_REST_TOKEN: string;
  readonly RESEND_API_KEY: string;
  readonly RECOVERY_EMAIL_FROM: string;
  readonly RECOVERY_NOTIFY_TO: string;
  readonly CRON_SECRET: string;
  readonly MERCANTIL_API_URL: string;
  readonly MERCANTIL_API_KEY: string;
  readonly PUBLIC_APP_URL: string;
  readonly ADMIN_SYNC_URL: string;
  readonly ADMIN_SYNC_SECRET: string;
  readonly CART_ACCESS_SECRET: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
