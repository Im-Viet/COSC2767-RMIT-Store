module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  setupFiles: ['<rootDir>/tests/jest.env.js'], // runs before imports
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  reporters: [
    'default',
    ['jest-junit', { outputDirectory: './reports/junit', outputName: 'js-test-results.xml' }],
  ],
  verbose: true,
  forceExit: true,
  detectOpenHandles: true,
};
