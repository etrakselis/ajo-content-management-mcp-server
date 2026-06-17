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
    '!src/**/*.d.ts'
  ],
  // Thresholds track the suite's current floor so CI stays green; raise these as
  // coverage improves (notably prompts.ts, schema-registry.ts, personalization.ts).
  coverageThreshold: {
    global: {
      lines: 70,
      functions: 60,
      branches: 45,
      statements: 70
    }
  },
  moduleNameMapper: {
    '^(\\.{1,2}\\/.+)\\.js$': '$1'
  }
};
