import {describe, expect, it} from 'vitest';
import {ecreterMott, lireAbif, picLePlusHaut, picsDoubles, qualiteParTrace, zoneExploitable,
        ErreurAbif} from '../../src/core/abif.js';
import {chromatogrammeJouet, entreeChar, entreeCourts, fabriquerAbif} from './_abif.js';

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

describe('pics doubles (hétérozygotes)', () => {
  // Une lecture propre, dans laquelle on plante deux hétérozygotes : la trace
  // d'une seconde base culmine au même endroit que celle de la base appelée.
  const poserSecond = (buf: ArrayBuffer, positions: number[], base: string, part: number) => {
    const a = lireAbif(buf);
    const traces: Record<string, number[]> = {
      A: [...a.traces.A], C: [...a.traces.C], G: [...a.traces.G], T: [...a.traces.T]
    };
    for (const p of positions) {
      const x = a.pics[p]!;
      const sommet = Math.max(...(['A', 'C', 'G', 'T'] as const).map((b) => traces[b]![x] ?? 0));
      for (let d = -5; d <= 5; d++) {
        traces[base]![x + d] = Math.round(sommet * part * Math.exp(-(d * d) / 6));
      }
    }
    const ordre = 'GATC';
    return fabriquerAbif([
      entreeChar('FWO_', 1, ordre),
      entreeChar('PBAS', 1, a.bases),
      entreeCourts('PLOC', 1, [...a.pics]),
      ...ordre.split('').map((b, i) => entreeCourts('DATA', 9 + i, traces[b]!))
    ]);
  };

  const propre = chromatogrammeJouet('ACGTACGTACGTAAGGCCTTAACCGGTTACGTACGTACGTGGCCAATTCCGGATCGATCGA');

  it('trouve un second pic net, et propose le bon code IUPAC', () => {
    // Position 20 : la base appelée est A, on y ajoute un G à 60 % → R.
    const avecHet = poserSecond(propre, [20], 'G', 0.6);
    const doubles = picsDoubles(lireAbif(avecHet));
    const ici = doubles.find((d) => d.index === 20);
    expect(ici).toBeDefined();
    expect(ici!.seconde).toBe('G');
    expect(ici!.rapport).toBeGreaterThan(0.5);
    expect(ici!.iupac).toBe(CODE_ATTENDU[ici!.appelee + 'G'] ?? ici!.iupac);
  });

  it('ne signale rien sur une lecture sans second pic', () => {
    expect(picsDoubles(lireAbif(propre))).toHaveLength(0);
  });

  it('le seuil commande : un pic à 30 % passe à 0,25 et pas à 0,5', () => {
    const avecHet = poserSecond(propre, [25], 'C', 0.3);
    expect(picsDoubles(lireAbif(avecHet), {seuil: 0.25}).some((d) => d.index === 25)).toBe(true);
    expect(picsDoubles(lireAbif(avecHet), {seuil: 0.5}).some((d) => d.index === 25)).toBe(false);
  });

  it('ignore le bruit des zones effondrées', () => {
    // Les quinze premières bases du jouet sont de qualité 8, donc de faible
    // amplitude : un second pic proportionnellement haut y reste du bruit.
    const faible = poserSecond(propre, [3], 'C', 0.6);
    const doubles = picsDoubles(lireAbif(faible), {seuilSignal: 0.5});
    expect(doubles.some((d) => d.index === 3)).toBe(false);
  });

  it('écarte la traîne d’un voisin de même base', () => {
    // Une crête large qui couvre la base et ses deux voisines : c'est ce que
    // produit une suite AAA, où la trace de A ne redescend pas entre les pics.
    // Elle ressemble à un second pic ; elle n'en est pas un.
    const creteLarge = (positions: number[], base: string, part: number) => {
      const a = lireAbif(propre);
      const traces: Record<string, number[]> = {
        A: [...a.traces.A], C: [...a.traces.C], G: [...a.traces.G], T: [...a.traces.T]
      };
      for (const p of positions) {
        const x = a.pics[p]!;
        const sommet = Math.max(...(['A', 'C', 'G', 'T'] as const).map((b) => traces[b]![x] ?? 0));
        // Large : 30 échantillons, soit plus de deux intervalles entre pics.
        for (let d = -30; d <= 30; d++) {
          traces[base]![x + d] = Math.max(traces[base]![x + d] ?? 0,
                                          Math.round(sommet * part * Math.exp(-(d * d) / 900)));
        }
      }
      const ordre = 'GATC';
      return fabriquerAbif([
        entreeChar('FWO_', 1, ordre),
        entreeChar('PBAS', 1, a.bases),
        entreeCourts('PLOC', 1, [...a.pics]),
        ...ordre.split('').map((b, i) => entreeCourts('DATA', 9 + i, traces[b]!))
      ]);
    };
    const large = picsDoubles(lireAbif(creteLarge([30], 'A', 0.6)));
    expect(large.some((d) => d.index === 30)).toBe(false);

    // Le même second pic, mais étroit : lui compte.
    const etroit = picsDoubles(lireAbif(poserSecond(propre, [30], 'A', 0.6)));
    expect(etroit.some((d) => d.index === 30)).toBe(true);
  });

  it('signale quand la base appelée n’est pas la plus haute', () => {
    const avecHet = poserSecond(propre, [22], 'G', 1.4);
    const pic = picsDoubles(lireAbif(avecHet)).find((d) => d.index === 22);
    expect(pic?.appelDouteux).toBe(true);
    expect(pic!.rapport).toBeGreaterThan(1);
  });

  it('se limite à la plage demandée', () => {
    const avecHet = poserSecond(propre, [20, 40], 'G', 0.6);
    const doubles = picsDoubles(lireAbif(avecHet), {debut: 30});
    expect(doubles.every((d) => d.index >= 30)).toBe(true);
  });
});

const CODE_ATTENDU: Record<string, string> = {AG: 'R', GA: 'R', CG: 'S', GC: 'S', TG: 'K', GT: 'K'};

describe('zone exploitable déduite de la trace', () => {
  /** Éteint la trace à partir d'une base : c'est ce que fait une vraie lecture
   *  Sanger passé 800 bases — sur le fichier de référence, la hauteur médiane
   *  tombe de 500 à 2. */
  const queueEffondree = (bases: string, depuis: number) => {
    const a = lireAbif(chromatogrammeJouet(bases));
    const traces: Record<string, number[]> = {
      A: [...a.traces.A], C: [...a.traces.C], G: [...a.traces.G], T: [...a.traces.T]
    };
    const xDepuis = a.pics[depuis]!;
    for (const b of ['A', 'C', 'G', 'T'] as const) {
      for (let x = xDepuis; x < traces[b]!.length; x++) {
        traces[b]![x] = Math.round((traces[b]![x] ?? 0) * 0.004);
      }
      // ...et du bruit à la place du signal, sinon la pureté resterait parfaite.
      for (let x = xDepuis; x < traces[b]!.length; x++) {
        traces[b]![x] = (traces[b]![x] ?? 0) + ((x * 7 + b.charCodeAt(0)) % 5);
      }
    }
    const ordre = 'GATC';
    return fabriquerAbif([
      entreeChar('FWO_', 1, ordre),
      entreeChar('PBAS', 1, a.bases),
      entreeCourts('PLOC', 1, [...a.pics]),
      ...ordre.split('').map((b, i) => entreeCourts('DATA', 9 + i, traces[b]!))
    ]);
  };

  it('écarte la queue de lecture effondrée', () => {
    const bases = 'ACGTACGTACGTAAGGCCTTAACCGGTTACGTACGTACGTGGCCAATTCCGGATCGATCGA';
    const a = lireAbif(queueEffondree(bases, 40));
    const z = zoneExploitable(a);
    expect(z.fin).toBeLessThanOrEqual(42);       // la trace meurt à la base 40
    expect(z.fin - z.debut).toBeGreaterThan(20);
  });

  it('garde tout quand tout est lisible', () => {
    const a = lireAbif(chromatogrammeJouet('ACGTACGTACGTAAGGCCTTAACCGGTTACGTACGTACGT'));
    const z = zoneExploitable(a);
    expect(z.debut).toBe(0);
    expect(z.fin).toBe(a.bases.length);
  });

  it('ne rend rien d’exploitable sur une lecture sans trace', () => {
    const a = lireAbif(fabriquerAbif([
      entreeChar('FWO_', 1, 'GATC'),
      entreeChar('PBAS', 1, 'ACGT')
    ]));
    expect(zoneExploitable(a)).toEqual({debut: 0, fin: 0});
  });

  it('la pureté distingue un pic net d’un pic noyé', () => {
    const a = lireAbif(chromatogrammeJouet('ACGTACGTACGTACGT'));
    const q = qualiteParTrace(a);
    expect(q.purete).toHaveLength(16);
    // Le jouet ne pose qu'une trace par base : la pureté doit être maximale.
    expect(Math.max(...q.purete)).toBeCloseTo(1, 5);
    expect(q.hauteurMediane).toBeGreaterThan(0);
  });
});
