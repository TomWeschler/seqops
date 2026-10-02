import {readFileSync} from 'node:fs';
import {defineConfig} from 'vitest/config';

// Le numéro de version n'est écrit qu'à UN endroit : package.json. Le pied de
// page, les rapports et les FASTA exportés le lisent d'ici, à la construction ;
// un second exemplaire recopié à la main finirait par diverger du premier.
const {version} = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as
  {version: string};

// Base relative : l'application doit tourner aussi bien à la racine d'un
// domaine (Cloudflare Pages) que dans un sous-répertoire d'un serveur interne,
// voire depuis un partage réseau ouvert en file://. Un chemin absolu casserait
// les deux derniers cas.
export default defineConfig({
  base: './',
  define: {__VERSION_SEQOPS__: JSON.stringify(version)},
  build: {target: 'es2022', outDir: 'dist', sourcemap: true},
  worker: {format: 'es'},
  server: {port: 5173, strictPort: true},
  test: {environment: 'node', include: ['tests/unit/**/*.test.ts']}
});
