import {describe, expect, it} from 'vitest';
import {CONDITIONS_PCR, dg37, dimere, epingle, equivalentSodium, tm, tmAjusteAuSel, tmSelon}
  from '../../src/core/thermo.js';
import {tmPlusProcheVoisin} from '../../src/core/sequence.js';

const AMORCE = 'ACGTCAGGTCTTTCACCAGT';

describe('les sels d’une vraie PCR', () => {
  it('convertit tous les ions en équivalent sodium', () => {
    // 50 mM K + 10/2 mM Tris + 120·√(1,5 − 0,8) ≈ 55 + 100 mM
    const eq = equivalentSodium();
    expect(eq).toBeGreaterThan(0.14);
    expect(eq).toBeLessThan(0.17);
  });

  it('les dNTP chélatent le magnésium : sans magnésium libre, pas d’apport', () => {
    const avec = equivalentSodium({mgMM: 3, dntpMM: 0.8});
    const sans = equivalentSodium({mgMM: 0.5, dntpMM: 0.8});
    expect(avec).toBeGreaterThan(sans);
    expect(sans).toBeCloseTo((50 + 5) / 1000, 6);      // K + Tris/2 seulement
  });

  it('plus de magnésium, Tm plus haute', () => {
    const bas = tm(AMORCE, {mgMM: 1.5}) as number;
    const haut = tm(AMORCE, {mgMM: 4}) as number;
    expect(haut).toBeGreaterThan(bas);
  });

  it('la Tm de PCR dépasse celle calculée à 50 mM de sodium seul', () => {
    // C'est tout l'enjeu : l'ancienne valeur sous-estimait la réalité.
    const ancienne = tmPlusProcheVoisin(AMORCE, 500, 50) as number;
    const pcr = tm(AMORCE, CONDITIONS_PCR) as number;
    expect(pcr).toBeGreaterThan(ancienne + 2);
    expect(pcr).toBeLessThan(ancienne + 12);           // et pas n'importe quoi
  });

  it('refuse de calculer hors de son domaine', () => {
    expect(tm('ACGTAC')).toBeNull();
    expect(tm('ACGTNACGTACGT')).toBeNull();
  });
});

describe('ΔG des duplex', () => {
  it('un duplex GC tient mieux qu’un duplex AT', () => {
    expect(dg37('GCGCGCGC') as number).toBeLessThan(dg37('ATATATAT') as number);
  });

  it('est cohérent avec ΔH et ΔS : plus long, plus stable', () => {
    expect(dg37('GCGCGCGCGC') as number).toBeLessThan(dg37('GCGCGC') as number);
  });
});

describe('dimères', () => {
  it('trouve l’appariement de deux amorces complémentaires', () => {
    const d = dimere('GGGGCCCCAAAA', 'TTTTGGGGCCCC');
    expect(d.apparie).toBeGreaterThanOrEqual(8);
    expect(d.dg).toBeLessThan(-8);
  });

  it('signale quand l’appariement touche l’extrémité 3’ — celui qui amorce', () => {
    // Les huit dernières bases de l'amorce s'apparient : dimère en 3'.
    const d = dimere('AAAAAAAAGGGGCCCC', 'GGGGCCCCTTTTTTTT');
    expect(d.touche3).toBe(true);
  });

  it('ne voit rien entre deux oligonucléotides sans complémentarité', () => {
    const d = dimere('AAAAAAAAAAAA', 'AAAAAAAAAAAA');
    expect(d.dg).toBe(0);
  });

  it('refuse les séquences ambiguës plutôt que de deviner', () => {
    expect(dimere('ACGTNACGT', 'ACGTACGT').dg).toBe(0);
  });
});

describe('épingles à cheveux', () => {
  it('trouve une tige-boucle franche', () => {
    // Tige de 6 pb, boucle de 4.
    const e = epingle('GGGGCCTTTTGGCCCC');
    expect(e.apparie).toBeGreaterThanOrEqual(4);
    expect(e.dg).toBeLessThan(0);
  });

  it('ne voit pas d’épingle là où il n’y en a pas', () => {
    expect(epingle('AAAAAAAAAAAAAAAAAAAA').dg).toBe(0);
  });

  it('une tige plus riche en GC tient mieux', () => {
    const gc = epingle('GGGGGGTTTTCCCCCC').dg;
    const at = epingle('AAAAAATTTTTTTTTT').dg;
    expect(gc).toBeLessThan(at);
  });
});

describe('Tm ajustée au sel (OligoCalc)', () => {
  it('suit la formule des oligonucléotides de 14 bases et plus', () => {
    // 100,5 + 41·GC/N − 820/N + 16,6·log₁₀(0,05), vérifié à la main.
    const seq = 'ACGTCAGGTCTTTCACCAGT';                    // 20 nt, 10 GC
    const attendu = 100.5 + (41 * 10) / 20 - 820 / 20 + 16.6 * Math.log10(0.05);
    expect(tmAjusteAuSel(seq, 50)).toBeCloseTo(attendu, 6);
  });

  it('bascule sur la règle de Wallace corrigée en dessous de 14 bases', () => {
    const court = 'ACGTACGTACGT';                          // 12 nt, 6 GC
    const attendu = 6 * 2 + 6 * 4 - 16.6 * Math.log10(0.05) + 16.6 * Math.log10(0.05);
    expect(tmAjusteAuSel(court, 50)).toBeCloseTo(attendu, 6);
    // À 50 mM, les deux termes de sel s'annulent : on retombe sur Wallace.
    expect(tmAjusteAuSel(court, 50)).toBeCloseTo(36, 6);
  });

  it('plus de sodium, Tm plus haute', () => {
    const seq = 'ACGTCAGGTCTTTCACCAGT';
    expect(tmAjusteAuSel(seq, 200) as number).toBeGreaterThan(tmAjusteAuSel(seq, 50) as number);
  });

  it('refuse une séquence ambiguë', () => {
    expect(tmAjusteAuSel('ACGTNACGTACGTAC')).toBeNull();
  });

  it('les deux méthodes se choisissent, et ne disent pas la même chose', () => {
    const seq = 'ACGTCAGGTCTTTCACCAGT';
    const ppv = tmSelon('ppv', seq) as number;
    const sel = tmSelon('sel', seq, {}, 50) as number;
    expect(ppv).not.toBeCloseTo(sel, 1);
    // Chacune reste dans un domaine plausible pour une amorce de 20 bases.
    for (const v of [ppv, sel]) {
      expect(v).toBeGreaterThan(40);
      expect(v).toBeLessThan(75);
    }
  });
});
