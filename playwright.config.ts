import {defineConfig} from '@playwright/test';
import {existsSync} from 'node:fs';

// Le navigateur : celui qu'on désigne, sinon celui de l'environnement, sinon
// celui que Playwright a installé. Sur un poste d'entreprise comme dans une
// intégration continue, `playwright install` n'est pas toujours possible.
const CANDIDATS = [process.env.PW_CHROME, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'];
const CHROME = CANDIDATS.find((c) => c && existsSync(c));

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    locale: 'fr-FR',
    trace: 'retain-on-failure',
    ...(CHROME ? {launchOptions: {executablePath: CHROME}} : {})
  },
  webServer: {
    // --host 127.0.0.1 est indispensable : par défaut vite écoute sur
    // « localhost », que certains environnements (les exécuteurs GitHub) font
    // résoudre en ::1 d'abord. Playwright, lui, sonde 127.0.0.1 et attend
    // trois minutes une adresse qui ne répondra jamais.
    command: 'npm run build && npm run preview',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe'
  }
});
