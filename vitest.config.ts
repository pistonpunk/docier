import { defineConfig } from 'vitest/config';

const shared = {
  testTimeout: 30000,
  hookTimeout: 30000,
  expect: { requireAssertions: false },
};

export default defineConfig({
  test: {
    ...shared,
    projects: [
      {
        test: {
          ...shared,
          name: 'node',
          include: ['test/**/*.test.ts'],
          exclude: ['test/render/**', 'test/edit/**', 'test/api/**', 'test/ui/**'],
          environment: 'node',
        },
      },
      {
        test: {
          ...shared,
          name: 'dom',
          include: [
            'test/render/**/*.test.ts',
            'test/edit/**/*.test.ts',
            'test/api/**/*.test.ts',
            'test/ui/**/*.test.ts',
          ],
          environment: 'jsdom',
        },
      },
    ],
  },
});
