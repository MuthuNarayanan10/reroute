import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: 'postgres://test:test@localhost:5432/test',
      REDIS_URL: 'redis://localhost:6379',
      APP_URL: 'https://app.example.com',
      ENCRYPTION_KEY: '0000000000000000000000000000000000000000000000000000000000000000',
      SHOPIFY_API_KEY: 'test_key',
      SHOPIFY_API_SECRET: 'test_secret',
      RAZORPAY_KEY_ID: 'rzp_test',
      RAZORPAY_KEY_SECRET: 'rzp_secret',
      RAZORPAY_WEBHOOK_SECRET: 'rzp_webhook_secret',
      WHATSAPP_TOKEN: 'wa_token',
      WHATSAPP_PHONE_NUMBER_ID: '123',
      COURIER_WEBHOOK_SECRET: 'courier_secret',
      SHIPROCKET_EMAIL: 'ops@example.com',
      SHIPROCKET_PASSWORD: 'test-password',
    },
  },
});
