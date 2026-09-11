import {describe, expect, it} from 'vitest';
import {ecreterMott, lireAbif, picLePlusHaut, ErreurAbif} from '../../src/core/abif.js';
import {chromatogrammeJouet, entreeChar, fabriquerAbif} from './_abif.js';

const BASES = 'ACGTACGTACGTAAGGCCTTAACCGGTTACGTACGTACGTGGCCAATTCCGGATCGATCGA';

describe('lecture d’un .ab1', () => {
  it('rend les bases, les qualités et les pics', () => {
    const a = lireAbif(chromatogrammeJouet(BASES));
    expect(a.bases).toBe(BASES);
    expect(a.qualites).toHaveLength(BASES.length);
    expect(a.pics).toHaveLength(BASES.length);
    expect(a.echantillon).toBe('échantillon-test');
    expect(a.modele).toBe('3730xl');
    expect(a.date).toBe('2026-09-10');
  });

  it('range les traces par base, et non dans l’ordre du fichier', () => {
    // Le fichier jouet range ses traces G,A,T,C : lire DATA.9 comme « A »
    // afficherait un G à la place d'un A une fois sur deux.
    const a = lireAbif(chromatogrammeJouet('GGGG'));
    expect(a.ordreBases).toBe('GATC');
    const sommet = (t: readonly number[]) => Math.max(...t);
    expect(sommet(a.traces.G)).toBeGreaterThan(0);
    expect(sommet(a.traces.A)).toBe(0);
    expect(sommet(a.traces.C)).toBe(0);
    expect(sommet(a.traces.T)).toBe(0);
  });

  it('préfère l’appel de bases corrigé quand il existe, et le dit', () => {
    const brut = lireAbif(chromatogrammeJouet('ACGT'));
    expect(brut.corrige).toBe(false);
    const avecCorrection = lireAbif(fabriquerAbif([
      entreeChar('FWO_', 1, 'GATC'),
      entreeChar('PBAS', 1, 'ACGT'),
      entreeChar('PBAS', 2, 'ACNT')
    ]));
    expect(avecCorrection.corrige).toBe(true);
    expect(avecCorrection.bases).toBe('ACNT');
  });

  it('refuse ce qui n’est pas un .ab1, avec un message et non un tableau vide', () => {
    const faux = new TextEncoder().encode('>une séquence FASTA déguisée en .ab1\nACGT'.padEnd(200, 'A'));
    expect(() => lireAbif(faux.buffer as ArrayBuffer)).toThrow(ErreurAbif);
    expect(() => lireAbif(new ArrayBuffer(12))).toThrow(/trop court/i);
  });

  it('ne s’effondre pas sur un fichier tronqué', () => {
    const entier = chromatogrammeJouet(BASES);
    const coupe = entier.slice(0, Math.floor(entier.byteLength / 2));
    expect(() => lireAbif(coupe)).toThrow(ErreurAbif);
  });
});

describe('écrêtage des extrémités', () => {
  it('coupe les bords médiocres et garde le cœur de la lecture', () => {
    const q = [...new Array(15).fill(6), ...new Array(60).fill(55), ...new Array(20).fill(5)];
    const e = ecreterMott(q);
    expect(e.retireDebut).toBeGreaterThanOrEqual(10);
    expect(e.retireFin).toBeGreaterThanOrEqual(15);
    expect(e.fin - e.debut).toBeGreaterThan(50);
    expect(e.qualiteMoyenne).toBeGreaterThan(50);
  });

  it('ne coupe pas au premier creux isolé', () => {
    const q = new Array(100).fill(55);
    q[50] = 4;
    const e = ecreterMott(q);
    expect(e.debut).toBe(0);
    expect(e.fin).toBe(100);
  });

  it('rend une plage vide quand rien n’est exploitable', () => {
    const e = ecreterMott(new Array(40).fill(3));
    expect(e.fin - e.debut).toBe(0);
    expect(e.retireFin).toBe(40);
  });

  it('supporte une lecture sans qualités', () => {
    expect(ecreterMott([])).toMatchObject({debut: 0, fin: 0});
  });
});

describe('pic le plus haut', () => {
  it('rend la base dominante et le rapport au second', () => {
    const a = lireAbif(chromatogrammeJouet('ACGT'));
    for (const [i, base] of [...'ACGT'].entries()) {
      const pic = picLePlusHaut(a, i);
      expect(pic?.base).toBe(base);
      expect(pic?.rapport).toBe(Infinity);       // le jouet n'a qu'une trace par base
      expect(pic?.hauteurs[base as 'A']).toBeGreaterThan(0);
    }
  });

  it('rend null hors de la lecture', () => {
    const a = lireAbif(chromatogrammeJouet('ACGT'));
    expect(picLePlusHaut(a, 99)).toBeNull();
  });
});
