import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'tests/browser',fullyParallel:false,workers:1,timeout:45000,
  use:{baseURL:'http://127.0.0.1:4200',trace:'retain-on-failure',screenshot:'only-on-failure'},
  webServer:[
    {command:'npm run start -w sentinela-api',url:'http://127.0.0.1:3000/health',reuseExistingServer:!process.env.CI,timeout:30000},
    {command:'npm run start -w sentinela-test-api',url:'http://127.0.0.1:3001/health',reuseExistingServer:!process.env.CI,timeout:30000},
    {command:'npm run dev -w sentinela-web',url:'http://127.0.0.1:4200',reuseExistingServer:!process.env.CI,timeout:90000}
  ]});
