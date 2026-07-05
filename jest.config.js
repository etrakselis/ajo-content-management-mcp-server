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
    // Cross-sandbox promotion: engine.ts (graph build, phasing, the phased-PR executor,
    // and same-sandbox deploy) is now unit-tested with GitHub + AJO mocked — see
    // promotion-plan.test.ts, promotion-execute.test.ts, and the pure transforms in
    // promotion-transforms.test.ts — so it counts toward coverage. The thin tool wrapper
    // (tools/promotion.ts) still orchestrates live dispatch (read-only + confirm gates)
    // and is covered by integration, not unit tests, so it stays excluded here.
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
