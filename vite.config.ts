/// <reference types="vitest/config" />
import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import dts from 'vite-plugin-dts';
import {
  peerDependencies,
  name as packageName,
} from "./package.json";
import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
const dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

const libMode = true;
const devMode = true;

export default defineConfig({
  // NOTE: Using relative path so that assets can be found no matter the absolute path
  base: "./",
  plugins: [react(), tailwindcss(), libMode && dts({
    tsconfigPath: './tsconfig.app.json',
    rollupTypes: true
  })],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  },
  ...(libMode ? {
    build: {
      lib: {
        entry: path.resolve(__dirname, "./src/lib_index.ts"),
        name: packageName,
        fileName: packageName,
      },
      rollupOptions: {
        external: [...Object.keys(peerDependencies)]
      },
      // NOTE: If dev mode enabled, don't minify, otherwise keep the default setting
      minify: devMode ? false : "esbuild"
    }
  } : {}),
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.{ts,tsx}', '!src/**/*.integration.test.{ts,tsx}'],
          setupFiles: ['./testSetup.js'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          include: ['src/**/*.integration.test.{ts,tsx}'],
          setupFiles: ['./testSetup.js'],
        },
      },
      {
        extends: true,
        plugins: [
          // The plugin will run tests for the stories defined in your Storybook config
          // See options at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon#storybooktest
          storybookTest({
            configDir: path.join(dirname, '.storybook')
          })],
        test: {
          name: 'storybook',
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({}),
            instances: [{
              browser: 'chromium'
            }]
          }
        }
      }]
  }
});
