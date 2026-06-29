/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Pass the test tsconfig via the transform options (the `globals['ts-jest']` form
  // is deprecated in ts-jest 29). Overrides the preset's default transform.
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tests/tsconfig.json' }]
  },
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    // GitHub client and sync modules make live network calls to GitHub's API
    // and require integration tests with a real repo — excluded from unit coverage.
    '!src/github/client.ts',
    '!src/github/sync.ts',
    // Cross-sandbox promotion: the engine and tool orchestrate live AJO + GitHub
    // calls across two sandboxes (graph build, phased PRs, deploy) and need
    // integration tests against real sandboxes. The pure transforms they rely on
    // (in tools/utils.ts) ARE unit-tested — see promotion-transforms.test.ts.
    '!src/promotion/engine.ts',
    '!src/tools/promotion.ts'
  ],
  // Thresholds track the suite's current floor (kept a point or two under measured
  // coverage so incidental churn doesn't redden CI). Raise as coverage improves —
  // the largest remaining gaps are prompts.ts, schema-registry.ts, personalization.ts.
  coverageThreshold: {
    global: {
      lines: 75,
      functions: 67,
      branches: 52,
      statements: 72
    }
  },
  moduleNameMapper: {
    '^(\\.{1,2}\\/.+)\\.js$': '$1'
  }
};
