/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  globals: {
    'ts-jest': {
      tsconfig: '<rootDir>/tests/tsconfig.json'
    }
  },
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    // GitHub client and sync modules make live network calls to GitHub's API
    // and require integration tests with a real repo — excluded from unit coverage.
    '!src/github/client.ts',
    '!src/github/sync.ts'
  ],
  // Thresholds track the suite's current floor (kept a point or two under measured
  // coverage so incidental churn doesn't redden CI). Raise as coverage improves —
  // the largest remaining gaps are prompts.ts, schema-registry.ts, personalization.ts.
  coverageThreshold: {
    global: {
      lines: 76,
      functions: 68,
      branches: 52,
      statements: 74
    }
  },
  moduleNameMapper: {
    '^(\\.{1,2}\\/.+)\\.js$': '$1'
  }
};
