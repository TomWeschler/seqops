import {describe, expect, it} from 'vitest';
import {ajouter, ecrireFasta, lireFasta, remplacerSegment, remplacerSequence, renommer, supprimer}
  from '../../src/core/fasta.js';

const FICHIER = '>seq1 première séquence\nACGTACGTAC\nGTACGT\n>seq2\nTTTTAAAA\n';

describe('lecture', () => {
  it('sépare identifiant et description, recolle les lignes', () => {
    const e = lireFasta(FICHIER);
    expect(e).toHaveLength(2);
    expect(e[0]).toMatchObject({id: 'seq1', description: 'première séquence', seq: 'ACGTACGTACGTACGT'});
    expect(e[1]).toMatchObject({id: 'seq2', description: '', seq: 'TTTTAAAA'});
  });

  it('accepte une séquence nue, sans en-tête', () => {
    expect(lireFasta('ACGT\nACGT')[0]).toMatchObject({id: 'sans_nom', seq: 'ACGTACGT'});
  });

  it('garde la séquence telle qu’écrite : ni majuscules, ni correction', () => {
    expect(lireFasta('>x\nacgt-n\n')[0]?.seq).toBe('acgt-n');
  });

  it('supporte les fins de ligne Windows', () => {
    expect(lireFasta('>x\r\nACGT\r\n>y\r\nTTTT\r\n')).toHaveLength(2);
  });
});

describe('écriture', () => {
  it('fait un aller-retour sans rien perdre', () => {
    expect(lireFasta(ecrireFasta(lireFasta(FICHIER)))).toEqual(lireFasta(FICHIER));
  });

  it('replie les lignes à 60 bases', () => {
    const long = 'A'.repeat(130);
    const lignes = ecrireFasta([{id: 'x', description: '', seq: long}]).trim().split('\n');
    expect(lignes.slice(1).map((l) => l.length)).toEqual([60, 60, 10]);
  });
});

describe('modification', () => {
  const enrs = lireFasta(FICHIER);

  it('remplace une séquence sans toucher aux autres', () => {
    const apres = remplacerSequence(enrs, 0, 'GGGG');
    expect(apres[0]?.seq).toBe('GGGG');
    expect(apres[1]).toEqual(enrs[1]);
    expect(enrs[0]?.seq).toBe('ACGTACGTACGTACGT');   // la source n'est pas mutée
  });

  it('remplace un segment en coordonnées affichées, bornes comprises', () => {
    const apres = remplacerSegment(enrs, 1, 1, 4, 'CC');
    expect(apres[1]?.seq).toBe('CCAAAA');
  });

  it('renomme, ajoute, supprime', () => {
    expect(renommer(enrs, 0, 'nouveau nom')[0]?.id).toBe('nouveau_nom');
    expect(ajouter(enrs, {id: 'z', description: '', seq: 'A'})).toHaveLength(3);
    expect(supprimer(enrs, 0)).toHaveLength(1);
  });

  it('refuse ce qui sortirait de la séquence, plutôt que d’écrire à côté', () => {
    expect(() => remplacerSegment(enrs, 0, 1, 999, 'A')).toThrow(RangeError);
    expect(() => remplacerSequence(enrs, 9, 'A')).toThrow(RangeError);
    expect(() => renommer(enrs, 0, '   ')).toThrow(RangeError);
  });
});
