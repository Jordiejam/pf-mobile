import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], env: { TZ: 'Europe/London' } },
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
});
