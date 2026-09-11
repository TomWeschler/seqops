import {describe, expect, it} from 'vitest';
import {ampliconsParasites, sitesHybridation} from '../../src/core/specificite.js';
import {complementInverse} from '../../src/core/sequence.js';

const OLIGO = 'ACGTTCAGGTCTTTCACCAG';

/** Une séquence qui porte l'oligonucléotide aux endroits demandés. */
function porteur(longueur: number, implants: {a: number; seq: string}[]): string {
  let x = 5;
  const lettres: string[] = [];
  for (let i = 0; i < longueur; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    lettres.push('ACGT'[(x >>> 16) & 3] as string);
  }
  for (const {a, seq} of implants) {
    for (let k = 0; k < seq.length; k++) lettres[a + k] = seq[k] as string;
  }
  return lettres.join('');
}

describe('sites d’hybridation', () => {
  it('trouve le site parfait, sur le bon brin et à la bonne position', () => {
    const cible = porteur(600, [{a: 199, seq: OLIGO}]);
    const sites = sitesHybridation(cible, 'cible', OLIGO);
    const parfait = sites.find((s) => s.mesappariements === 0);
    expect(parfait).toMatchObject({debut: 200, fin: 219, brin: '+', mesappariements: 0});
  });

  it('trouve aussi le site du brin inverse, en coordonnées du brin direct', () => {
    const cible = porteur(600, [{a: 299, seq: complementInverse(OLIGO)}]);
    const site = sitesHybridation(cible, 'cible', OLIGO).find((s) => s.mesappariements === 0);
    expect(site).toMatchObject({debut: 300, fin: 319, brin: '−'});
  });

  it('un mésappariement en 3’ disqualifie le site, pas un mésappariement en 5’', () => {
    const en5 = 'T' + OLIGO.slice(1);                       // première base changée
    const en3 = OLIGO.slice(0, -1) + (OLIGO.endsWith('G') ? 'A' : 'G');
    const avec5 = porteur(400, [{a: 99, seq: en5}]);
    const avec3 = porteur(400, [{a: 99, seq: en3}]);
    expect(sitesHybridation(avec5, 'c', OLIGO).length).toBeGreaterThan(0);
    expect(sitesHybridation(avec3, 'c', OLIGO)).toHaveLength(0);
  });

  it('la tolérance se règle', () => {
    const trois = OLIGO.slice(0, 3).split('').map((c) => (c === 'A' ? 'C' : 'A')).join('') + OLIGO.slice(3);
    const cible = porteur(400, [{a: 99, seq: trois}]);
    expect(sitesHybridation(cible, 'c', OLIGO, {mesappariementsMax: 3}).length).toBeGreaterThan(0);
    expect(sitesHybridation(cible, 'c', OLIGO, {mesappariementsMax: 1})).toHaveLength(0);
  });

  it('ne trouve rien là où il n’y a rien, et refuse un oligo ambigu', () => {
    expect(sitesHybridation(porteur(500, []), 'c', OLIGO)).toHaveLength(0);
    expect(sitesHybridation(porteur(500, []), 'c', 'ACGTNACGT')).toHaveLength(0);
  });
});

describe('amplicons parasites', () => {
  const F = OLIGO;
  const R = 'TTGCACCAGTTGACCTAGCA';

  it('voit la bande parasite quand les deux amorces retombent ailleurs', () => {
    // La vraie cible, plus un second couple de sites 400 bases plus loin :
    // c'est la deuxième bande sur le gel, celle qu'on ne comprend pas.
    const cible = porteur(2000, [
      {a: 99, seq: F}, {a: 399, seq: complementInverse(R)},
      {a: 999, seq: F}, {a: 1299, seq: complementInverse(R)}
    ]);
    const parasites = ampliconsParasites(
      [{nom: 'F', seq: F}, {nom: 'R', seq: R}], [{nom: 'cible', seq: cible}]);
    expect(parasites.length).toBeGreaterThanOrEqual(2);
    // Les deux produits de 320 pb — le voulu et le parasite — plus le grand
    // produit croisé entre le F du premier site et le R du second.
    const tailles = parasites.map((p) => p.taille);
    expect(tailles.filter((t) => t === 320)).toHaveLength(2);
    expect(tailles).toContain(1220);
  });

  it('voit une amorce qui s’amplifie contre elle-même', () => {
    const cible = porteur(1200, [{a: 99, seq: F}, {a: 599, seq: complementInverse(F)}]);
    const parasites = ampliconsParasites([{nom: 'F', seq: F}], [{nom: 'cible', seq: cible}]);
    expect(parasites.length).toBeGreaterThan(0);
    expect(parasites[0]!.par).toContain('lui-même');
  });

  it('ne rend rien quand chaque amorce n’a qu’un site et qu’ils ne s’opposent pas', () => {
    const cible = porteur(1500, [{a: 99, seq: F}, {a: 199, seq: F}]);
    const parasites = ampliconsParasites([{nom: 'F', seq: F}], [{nom: 'cible', seq: cible}]);
    expect(parasites).toHaveLength(0);
  });

  it('respecte la taille maximale d’amplicon', () => {
    const cible = porteur(5000, [{a: 99, seq: F}, {a: 4499, seq: complementInverse(R)}]);
    const oligos = [{nom: 'F', seq: F}, {nom: 'R', seq: R}];
    expect(ampliconsParasites(oligos, [{nom: 'c', seq: cible}], 3000)).toHaveLength(0);
    expect(ampliconsParasites(oligos, [{nom: 'c', seq: cible}], 5000).length).toBeGreaterThan(0);
  });
});
