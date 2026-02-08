/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^obsidian$': '<rootDir>/src/test/mocks/obsidian.ts',
  },
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts'],
};
