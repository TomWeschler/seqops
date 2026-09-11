import {describe, expect, it} from 'vitest';
import {ambiguites, chercherMotif, complementInverse, composition, corriger, gcGlissant, masse,
        motifEnRegex, orfs, prochaineAmbiguite, tmPlusProcheVoisin, tmWallace, traduire,
        traduireCodon} from '../../src/core/sequence.js';

const ADN = {prochaineAmbiguite, ambiguites};

describe('correction', () => {
  it('nettoie une séquence recopiée d’un PDF sans rien inventer', () => {
    const r = corriger('  1 augc gua\n 11 ACGT\n');
    expect(r.seq).toBe('ATGCGTAACGT');
    expect(r.comptes.uracile).toBe(2);
    expect(r.comptes.numerotation).toBe(3);
    expect(r.comptes.miseEnForme).toBeGreaterThan(0);
  });

  it('journalise chaque intervention, à la position de la séquence rendue', () => {
    const r = corriger('  ACGT u\n');
    expect(r.journal).toHaveLength(1);
    expect(r.journal[0]).toMatchObject({pos: 5, avant: 'u', apres: 'T', type: 'uracile'});
  });

  it('retire un caractère invalide, ou le remplace par N pour garder les coordonnées', () => {
    expect(corriger('ACxGT').seq).toBe('ACGT');
    expect(corriger('ACxGT', {retirerInvalides: false}).seq).toBe('ACNGT');
    expect(corriger('ACxGT').journal[0]?.type).toBe('invalide');
  });

  it('ramène les codes ambigus à N par défaut, sans rien taire', () => {
    const r = corriger('ACRYGT');
    expect(r.seq).toBe('ACNNGT');
    // Ce qui a été écrasé reste lisible : le code d'origine et ce qu'il désignait.
    expect(r.journal.map((e) => e.quoi)).toEqual([
      'code ambigu R (AG) ramené à N',
      'code ambigu Y (CT) ramené à N'
    ]);
    expect(r.comptes.ambigus).toBe(2);
  });

  it('...et les conserve si on le demande explicitement', () => {
    expect(corriger('ACRYGT', {ambigusEnN: false}).seq).toBe('ACRYGT');
  });

  it('un N reste un N : rien à convertir, mais il est compté', () => {
    const r = corriger('ACNGT');
    expect(r.seq).toBe('ACNGT');
    expect(r.comptes.ambigus).toBe(1);
  });

  it('déclare propre une séquence propre, sans journal', () => {
    const r = corriger('ACGTACGT');
    expect(r.propre).toBe(true);
    expect(r.journal).toHaveLength(0);
  });
});

describe('chiffres', () => {
  it('compte les bases et ne met que les définies au dénominateur du GC', () => {
    const c = composition('AACCGGTTNN');
    expect(c.longueur).toBe(10);
    expect(c.autres).toBe(2);
    expect(c.gc).toBe(50);
  });

  it('rend L − fenêtre + 1 points de GC glissant, qui suivent la séquence', () => {
    const g = gcGlissant('GGGGCCCCAAAATTTT', 4);
    expect(g).toHaveLength(13);
    expect(g[0]?.gc).toBe(100);
    expect(g[g.length - 1]?.gc).toBe(0);
  });

  it('calcule les Tm, et refuse de les calculer hors domaine', () => {
    expect(tmWallace('ATGC')).toBe(12);
    const riche = tmPlusProcheVoisin('GCGCGCGCGCGCGCGCGCGC') as number;
    const pauvre = tmPlusProcheVoisin('ATATATATATATATATATAT') as number;
    expect(riche).toBeGreaterThan(pauvre + 10);
    const amorce = tmPlusProcheVoisin('ACGTCAGGTCTTTCACCAGT') as number;
    expect(amorce).toBeGreaterThan(45);
    expect(amorce).toBeLessThan(70);
    expect(tmPlusProcheVoisin('ACGTCAGGTCTTTCACCAGT', 500, 10)).toBeLessThan(amorce - 3);
    expect(tmPlusProcheVoisin('ACGTAC')).toBeNull();
    expect(tmPlusProcheVoisin('ACGTNACGTACGT')).toBeNull();
  });

  it('calcule la masse d’un oligonucléotide', () => {
    expect(masse('A')).toBeCloseTo(251.25, 2);
    expect(masse('NNN')).toBeNull();
  });
});

describe('brins, traduction, cadres', () => {
  it('complémente à l’envers, codes ambigus compris', () => {
    expect(complementInverse('ATGC')).toBe('GCAT');
    expect(complementInverse('RYKMN')).toBe('NKMRY');
  });

  it('ne traduit un codon ambigu que s’il ne laisse aucun doute', () => {
    expect(traduire('ATGGCCTGGTAA')).toBe('MAW*');
    expect(traduireCodon('GGN')).toBe('G');
    expect(traduireCodon('YTA')).toBe('L');
    expect(traduireCodon('NNN')).toBe('X');
    expect(traduireCodon('ATN')).toBe('X');
  });

  it('rend les ORF du brin inverse en coordonnées du brin direct', () => {
    const direct = orfs('AAAATGAAATTTTAA', {minAA: 3, inverse: false})[0];
    expect(direct).toMatchObject({debut: 4, fin: 15, longueurAA: 3, prot: 'MKF*', avecStop: true});
    const inverse = orfs('TTAAAATTTCAT', {minAA: 3})[0];
    expect(inverse).toMatchObject({brin: '−', debut: 1, fin: 12, prot: 'MKF*'});
    expect(orfs('TTAAAATTTCAT', {minAA: 3, inverse: false})).toHaveLength(0);
  });
});

describe('motifs', () => {
  it('compte les occurrences chevauchantes, une seule fois par brin', () => {
    expect(chercherMotif('TATATA', 'TATA')).toHaveLength(2);
    expect(chercherMotif('TATATA', 'TATA', true)).toHaveLength(2);
    expect(chercherMotif('AAAGGGGCCCCTTT', 'GGGG', true)?.map((h) => h.brin + h.debut))
      .toEqual(['+4', '−8']);
  });

  it('accepte les codes IUPAC et refuse le reste', () => {
    expect(chercherMotif('GGACCGGTCC', 'GGWCC')).toHaveLength(2);
    expect(motifEnRegex('GGZCC')).toBeNull();
    expect(motifEnRegex('')).toBeNull();
  });
});

describe('ambiguïtés', () => {
  it('trouve la suivante, et dit quand il n’y en a plus', () => {
    const {prochaineAmbiguite, ambiguites} = ADN;
    expect(prochaineAmbiguite('ACGTNACGTRACGT')).toBe(4);
    expect(prochaineAmbiguite('ACGTNACGTRACGT', 4)).toBe(9);
    expect(prochaineAmbiguite('ACGTNACGTRACGT', 9)).toBe(-1);
    expect(prochaineAmbiguite('ACGTACGT')).toBe(-1);
    expect(ambiguites('ACGTNACGTRACGT')).toEqual([4, 9]);
    expect(ambiguites('')).toEqual([]);
  });

  it('ne boucle pas toute seule sur le début', () => {
    expect(ADN.prochaineAmbiguite('NACGT', 0)).toBe(-1);
  });
});

describe('traçabilité des positions', () => {
  it('chaque base rendue sait d’où elle vient', () => {
    const brut = '  ac 12 xgu-t ';
    const r = corriger(brut);
    expect(r.seq).toBe('ACGTT');
    expect(r.sources).toHaveLength(r.seq.length);
    // La source rend bien le caractère d'origine, casse et U compris.
    expect(r.sources.map((i) => brut[i])).toEqual(['a', 'c', 'g', 'u', 't']);
    // Les index sont strictement croissants : on ne remonte jamais en arrière.
    expect([...r.sources].sort((a, b) => a - b)).toEqual([...r.sources]);
  });
});
