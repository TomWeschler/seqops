import {defineConfig} from 'vitest/config';

// Base relative : l'application doit tourner aussi bien à la racine d'un
// domaine (Cloudflare Pages) que dans un sous-répertoire d'un serveur interne,
// voire depuis un partage réseau ouvert en file://. Un chemin absolu casserait
// les deux derniers cas.
export default defineConfig({
  base: './',
  build: {target: 'es2022', outDir: 'dist', sourcemap: true},
  worker: {format: 'es'},
  server: {port: 5173, strictPort: true},
  test: {environment: 'node', include: ['tests/unit/**/*.test.ts']}
});
