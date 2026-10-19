/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: "src",
  // Load .env before any module — required because env.ts validates at import time
  setupFiles: ["dotenv/config"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  collectCoverageFrom: [
    "**/*.ts",
    "!**/*.d.ts",
    "!**/node_modules/**",
    "!index.ts",
    "!seed/**",
  ],
};
