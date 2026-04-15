import { defineConfig } from "cypress";

export default defineConfig({
  numTestsKeptInMemory: 0,
  experimentalMemoryManagement: true,
  video: false,
  e2e: {
    setupNodeEvents(on, config) {
      // implement node event listeners here
    },
    baseUrl: 'http://localhost:3000'
  },
});
