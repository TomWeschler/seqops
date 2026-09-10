import {describe, expect, it} from 'vitest';
import {rapportHtml, rapportTexte} from '../../src/core/rapport.js';
import {composition, corriger} from '../../src/core/sequence.js';

const seq = 'ATGAAACGCATTAGCACCATTACCACCACCATCACCATTACCACAGGTAACGGTGCGGGCTGA';
const contenu = {
  titre: 'Rapport de séquence',
  source: 'essai.ab1',
  version: '0.1.0',
  etabliLe: new Date('2026-09-10T08:30:00Z'),
  options: {uracile: true, ecretage: true},
  seq,
  correction: corriger(seq + 'xx'),
  composition: composition(seq),
  qualite: {moyenne: 52.4, retireDebut: 15, retireFin: 22}
};

describe('rapport', () => {
  const texte = rapportTexte(contenu);

  it('dit d’où viennent les chiffres', () => {
    expect(texte).toContain('essai.ab1');
    expect(texte).toContain('seqops 0.1.0');
    expect(texte).toContain('2026-09-10');
    expect(texte).toContain('uracile=true');
  });

  it('rend compte de l’écrêtage et des corrections', () => {
    expect(texte).toContain('15 bases au début, 22 à la fin');
    expect(texte).toMatch(/caractères invalides/);
  });

  it('porte la séquence, numérotée', () => {
    expect(texte).toContain(seq.slice(0, 60));
    expect(texte).toMatch(/^ +1 {2}ATG/m);
  });

  it('en HTML, échappe et n’appelle aucune ressource extérieure', () => {
    const html = rapportHtml({...contenu, source: '<script>alert(1)</script>'});
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toMatch(/https?:\/\//);
  });
});
