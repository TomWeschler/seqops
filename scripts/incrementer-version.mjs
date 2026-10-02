// Incrémente le dernier chiffre de la version (0.1.4 → 0.1.5) dans package.json
// et package-lock.json, qui doivent rester d'accord : npm refuse un verrou dont
// la version contredit celle du paquet.
//
// Appelé par .githooks/pre-commit à chaque commit. Écrit à la main plutôt que
// par `npm version patch` : plus rapide, sans réseau, et sans les scripts de
// cycle de vie que npm déclencherait au passage.
import {readFileSync, writeFileSync} from 'node:fs';

const lire = (chemin) => JSON.parse(readFileSync(chemin, 'utf-8'));
const ecrire = (chemin, objet) => writeFileSync(chemin, JSON.stringify(objet, null, 2) + '\n');

const paquet = lire('package.json');
const morceaux = String(paquet.version).split('.').map(Number);
if (morceaux.length !== 3 || morceaux.some((n) => !Number.isInteger(n) || n < 0)) {
  console.error(`Version illisible dans package.json : « ${paquet.version} »`);
  process.exit(1);
}
morceaux[2] += 1;
const suivante = morceaux.join('.');

paquet.version = suivante;
ecrire('package.json', paquet);

const verrou = lire('package-lock.json');
verrou.version = suivante;
if (verrou.packages?.['']) verrou.packages[''].version = suivante;
ecrire('package-lock.json', verrou);

console.log(`seqops ${suivante}`);
