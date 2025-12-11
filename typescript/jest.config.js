// ESM-aware Jest config using ts-jest ESM preset.
// Place at typescript/jest.config.js

module.exports = {
  // Use the ts-jest ESM-aware preset
  preset: 'ts-jest/presets/js-with-ts-esm',

  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts', '**/?(*.)+(spec|test).ts'],
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],

  // Transform TypeScript files with ts-jest and provide ts-jest options inline.
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.json',
        useESM: true,
        diagnostics: false
      }
    ]
  },

  // Allow transforming ESM-only node_modules packages such as @noble and node-fetch.
  // Add additional modules if other ESM-only deps show up in errors.
  transformIgnorePatterns: [
    'node_modules/(?!(?:@noble|node-fetch|@scure|@walletadapter)/)'
  ],

  // Some ESM packages use named exports — enable these extensions to be treated as ESM
  extensionsToTreatAsEsm: ['.ts'],

  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],

  // If you still see issues with node-fetch import paths, you can map the package:
  // moduleNameMapper: { '^node-fetch$': 'node-fetch' },

  // Jest + ts-jest runtime options (now in transform entry; keep globals minimal)
  globals: {}
};