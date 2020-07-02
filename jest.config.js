module.exports = {
  roots: ['<rootDir>/src'],
  transform: {
    '.(ts|tsx)': 'ts-jest',
  },
  testMatch: ['**/__test?(s)__/**/*.ts?(x)', '**/?(*.)(spec|test).ts?(x)'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  collectCoverageFrom: [
    'src/**/*.ts?(x)',
    '!**/*.d.ts?(x)',
    '!**/__*__/**',
    '!**/bin/**',
    '!src/*.ts',
    '!src/rocket-punch/message-handlers/**',
    '!src/rocket-punch/bin.ts',
    '!src/**/.package.json.ts',
  ],
  globals: {
    'ts-jest': {
      tsConfig: 'tsconfig.json',
    },
  },
  modulePaths: ['<rootDir>/src/'],
};
