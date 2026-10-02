import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

const lire = (chemin: string) => JSON.parse(readFileSync(chemin, 'utf-8')) as
  {version: string; packages?: Record<string, {version?: string}>};

describe('numéro de version', () => {
  it('est le même dans le paquet, le verrou et l’application construite', () => {
    const paquet = lire('package.json');
    const verrou = lire('package-lock.json');
    // Le pied de page lit ce que Vite a injecté depuis package.json : s'ils
    // différaient, l'écran annoncerait une version qui n'est pas celle du code.
    expect(__VERSION_SEQOPS__).toBe(paquet.version);
    expect(verrou.version).toBe(paquet.version);
    expect(verrou.packages?.['']?.version).toBe(paquet.version);
    expect(paquet.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('s’incrémente d’un cran, dans les deux fichiers à la fois', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'version-'));
    writeFileSync(join(dossier, 'package.json'), JSON.stringify({name: 'x', version: '0.1.9'}));
    writeFileSync(join(dossier, 'package-lock.json'),
                  JSON.stringify({name: 'x', version: '0.1.9', packages: {'': {version: '0.1.9'}}}));
    const sortie = execFileSync('node', [resolve('scripts/incrementer-version.mjs')],
                                {cwd: dossier, encoding: 'utf-8'});
    expect(sortie.trim()).toBe('seqops 0.1.10');
    expect(lire(join(dossier, 'package.json')).version).toBe('0.1.10');
    const verrou = lire(join(dossier, 'package-lock.json'));
    expect(verrou.version).toBe('0.1.10');
    expect(verrou.packages?.['']?.version).toBe('0.1.10');
  });

  it('refuse une version qu’il ne sait pas lire, plutôt que d’écrire n’importe quoi', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'version-'));
    writeFileSync(join(dossier, 'package.json'), JSON.stringify({version: '1.0-beta'}));
    writeFileSync(join(dossier, 'package-lock.json'), JSON.stringify({version: '1.0-beta'}));
    expect(() => execFileSync('node', [resolve('scripts/incrementer-version.mjs')],
                              {cwd: dossier, stdio: 'pipe'})).toThrow();
    expect(lire(join(dossier, 'package.json')).version).toBe('1.0-beta');
  });
});
