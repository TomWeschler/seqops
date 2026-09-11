/** Opérations de base sur une séquence d'ADN : correction, composition,
 *  brins dérivés, traduction, températures de fusion.
 *
 *  Tout est pur et sans DOM : ces fonctions tournent aussi bien dans la page
 *  que dans un travailleur, et se testent sans navigateur. */

export const IUPAC: Record<string, string> = {
  A: 'A', C: 'C', G: 'G', T: 'T',
  R: 'AG', Y: 'CT', S: 'CG', W: 'AT', K: 'GT', M: 'AC',
  B: 'CGT', D: 'AGT', H: 'ACT', V: 'ACG', N: 'ACGT'
};
export const BASES = ['A', 'C', 'G', 'T'] as const;
export const AMBIGUS = ['R', 'Y', 'S', 'W', 'K', 'M', 'B', 'D', 'H', 'V', 'N'] as const;

const COMPLEMENT: Record<string, string> = {
  A: 'T', T: 'A', C: 'G', G: 'C', R: 'Y', Y: 'R', S: 'S', W: 'W', K: 'M', M: 'K',
  B: 'V', V: 'B', D: 'H', H: 'D', N: 'N', '-': '-', '.': '.'
};

export type TypeCorrection = 'uracile' | 'lacune' | 'ambigu' | 'invalide';

export interface EntreeJournal {
  /** Position dans la séquence rendue, à partir de 1. */
  readonly pos: number;
  readonly avant: string;
  readonly apres: string;
  readonly type: TypeCorrection;
  readonly quoi: string;
}

export interface OptionsCorrection {
  /** U d'ARN converti en T. */
  uracile?: boolean;
  /** Lacunes d'alignement (- .) retirées. */
  lacunes?: boolean;
  /** Codes IUPAC ambigus ramenés à N. Vrai par défaut : dans un rapport de
   *  séquençage, un R ou un Y se recopie trop facilement comme s'il valait une
   *  base lue. Les ramener à N dit ce qui est vrai — cette position n'est pas
   *  tranchée — et chaque conversion reste inscrite au journal, avec le code
   *  d'origine et ce qu'il désignait. Passer `false` les conserve tels quels. */
  ambigusEnN?: boolean;
  /** Caractères invalides retirés (sinon remplacés par N, ce qui garde les
   *  coordonnées de tout ce qui suit). */
  retirerInvalides?: boolean;
}

export interface Correction {
  readonly seq: string;
  readonly journal: readonly EntreeJournal[];
  readonly comptes: Readonly<Record<
    'miseEnForme' | 'numerotation' | 'casse' | 'uracile' | 'lacunes' | 'ambigus' | 'invalides', number>>;
  /** Positions (à partir de 0) touchées dans la séquence rendue. */
  readonly reparees: ReadonlySet<number>;
  /** Pour chaque base rendue, son index dans le texte d'entrée. C'est ce qui
   *  permet de revenir d'une position affichée au pic du chromatogramme dont
   *  elle vient, même quand la correction a retiré des caractères. */
  readonly sources: readonly number[];
  readonly propre: boolean;
}

/** Nettoie une séquence ET rend le compte rendu de ce qui a été touché.
 *  Une correction muette est une falsification : c'est la règle du module. */
export function corriger(brut: string, opts: OptionsCorrection = {}): Correction {
  const o = {uracile: true, lacunes: true, ambigusEnN: true, retirerInvalides: true, ...opts};
  const src = String(brut ?? '');
  const sortie: string[] = [];
  const journal: EntreeJournal[] = [];
  const comptes = {miseEnForme: 0, numerotation: 0, casse: 0, uracile: 0, lacunes: 0, ambigus: 0, invalides: 0};
  const reparees = new Set<number>();
  const sources: number[] = [];

  for (let i = 0; i < src.length; i++) {
    const c = src[i] as string;
    if (/\s/.test(c)) { comptes.miseEnForme++; continue; }
    if (/[0-9]/.test(c)) { comptes.numerotation++; continue; }

    const h = c.toUpperCase();
    if (h !== c && /[A-Z]/.test(h)) comptes.casse++;

    if (h === 'U') {
      comptes.uracile++;
      reparees.add(sortie.length);
      journal.push({pos: sortie.length + 1, avant: c, apres: o.uracile ? 'T' : 'U', type: 'uracile',
                    quoi: o.uracile ? 'U d’ARN converti en T' : 'U d’ARN laissé tel quel'});
      sources.push(i);
      sortie.push(o.uracile ? 'T' : 'U');
      continue;
    }
    if (c === '-' || c === '.') {
      comptes.lacunes++;
      if (o.lacunes) {
        journal.push({pos: sortie.length + 1, avant: c, apres: '', type: 'lacune',
                      quoi: 'lacune d’alignement retirée'});
      } else {
        reparees.add(sortie.length);
        sources.push(i);
        sortie.push(c);
      }
      continue;
    }
    if ((BASES as readonly string[]).includes(h)) { sources.push(i); sortie.push(h); continue; }
    if ((AMBIGUS as readonly string[]).includes(h)) {
      comptes.ambigus++;
      reparees.add(sortie.length);
      if (o.ambigusEnN && h !== 'N') {
        journal.push({pos: sortie.length + 1, avant: c, apres: 'N', type: 'ambigu',
                      quoi: `code ambigu ${h} (${IUPAC[h]}) ramené à N`});
        sources.push(i);
        sortie.push('N');
      } else {
        journal.push({pos: sortie.length + 1, avant: c, apres: h, type: 'ambigu',
                      quoi: `code ambigu ${h} = ${(IUPAC[h] as string).split('').join('/')}`});
        sources.push(i);
        sortie.push(h);
      }
      continue;
    }
    comptes.invalides++;
    if (o.retirerInvalides) {
      journal.push({pos: sortie.length + 1, avant: c, apres: '', type: 'invalide',
                    quoi: `caractère invalide retiré (position source ${i + 1})`});
    } else {
      reparees.add(sortie.length);
      journal.push({pos: sortie.length + 1, avant: c, apres: 'N', type: 'invalide',
                    quoi: `caractère invalide remplacé par N (position source ${i + 1})`});
      sources.push(i);
      sortie.push('N');
    }
  }
  const propre = comptes.uracile === 0 && comptes.lacunes === 0 && comptes.ambigus === 0 &&
                 comptes.invalides === 0 && comptes.casse === 0;
  return {seq: sortie.join(''), journal, comptes, reparees, sources, propre};
}

export interface Composition {
  longueur: number;
  n: Record<'A' | 'C' | 'G' | 'T', number>;
  amb: Record<string, number>;
  autres: number;
  definies: number;
  gc: number;
  at: number;
  skewGC: number;
  skewAT: number;
}

export function composition(seq: string): Composition {
  const n = {A: 0, C: 0, G: 0, T: 0};
  const amb: Record<string, number> = {};
  let autres = 0;
  for (const c of seq) {
    if (c === 'A' || c === 'C' || c === 'G' || c === 'T') n[c]++;
    else { amb[c] = (amb[c] ?? 0) + 1; autres++; }
  }
  const definies = n.A + n.C + n.G + n.T;
  const gc = definies ? ((n.G + n.C) / definies) * 100 : 0;
  return {
    longueur: seq.length, n, amb, autres, definies, gc, at: definies ? 100 - gc : 0,
    skewGC: n.G + n.C ? (n.G - n.C) / (n.G + n.C) : 0,
    skewAT: n.A + n.T ? (n.A - n.T) / (n.A + n.T) : 0
  };
}

/** GC en fenêtre glissante, en somme courante : sur un chromosome, la
 *  différence avec un recomptage par fenêtre est celle entre l'instantané et
 *  la minute. */
export function gcGlissant(seq: string, fenetre: number): {pos: number; gc: number}[] {
  const L = seq.length;
  const f = Math.max(2, Math.min(Math.trunc(fenetre) || 50, L));
  if (L < 2) return [];
  const estGC = (c: string) => c === 'G' || c === 'C' || c === 'S';
  const estDef = (c: string) => 'ACGT'.includes(c);
  const points: {pos: number; gc: number}[] = [];
  let gc = 0, def = 0;
  for (let i = 0; i < L; i++) {
    if (estGC(seq[i] as string)) gc++;
    if (estDef(seq[i] as string)) def++;
    if (i >= f) {
      if (estGC(seq[i - f] as string)) gc--;
      if (estDef(seq[i - f] as string)) def--;
    }
    if (i >= f - 1) points.push({pos: i - f + 2, gc: def ? (gc / def) * 100 : 0});
  }
  return points;
}

export function complement(seq: string): string {
  let out = '';
  for (const c of seq) out += COMPLEMENT[c] ?? 'N';
  return out;
}
export function inverser(seq: string): string {
  return seq.split('').reverse().join('');
}
export function complementInverse(seq: string): string {
  return inverser(complement(seq));
}
export function transcrire(seq: string): string {
  return seq.replace(/T/g, 'U');
}

/** Paramètres unifiés du plus proche voisin, SantaLucia 1998 : ΔH kcal/mol,
 *  ΔS cal/(mol·K). */
const NN: Record<string, readonly [number, number]> = {
  AA: [-7.9, -22.2], TT: [-7.9, -22.2], AT: [-7.2, -20.4], TA: [-7.2, -21.3],
  CA: [-8.5, -22.7], TG: [-8.5, -22.7], GT: [-8.4, -22.4], AC: [-8.4, -22.4],
  CT: [-7.8, -21.0], AG: [-7.8, -21.0], GA: [-8.2, -22.2], TC: [-8.2, -22.2],
  CG: [-10.6, -27.2], GC: [-9.8, -24.4], GG: [-8.0, -19.9], CC: [-8.0, -19.9]
};

export function tmWallace(seq: string): number {
  const c = composition(seq);
  return 2 * (c.n.A + c.n.T) + 4 * (c.n.G + c.n.C);
}

export function tmGC(seq: string): number | null {
  const c = composition(seq);
  if (c.definies < 1) return null;
  return 64.9 + (41 * (c.n.G + c.n.C - 16.4)) / c.definies;
}

/** Tm par plus proche voisin. Rend null hors de son domaine de validité :
 *  mieux vaut pas de chiffre qu'un chiffre faux recopié dans un cahier. */
export function tmPlusProcheVoisin(seq: string, oligoNM = 500, selMM = 50): number | null {
  if (!/^[ACGT]+$/.test(seq) || seq.length < 8) return null;
  const CT = oligoNM * 1e-9;
  const Na = selMM / 1000;
  let dH = 0, dS = 0;
  for (let i = 0; i < seq.length - 1; i++) {
    const p = NN[seq.substr(i, 2)];
    if (!p) return null;
    dH += p[0]; dS += p[1];
  }
  for (const bout of [seq[0] as string, seq[seq.length - 1] as string]) {
    if (bout === 'G' || bout === 'C') { dH += 0.1; dS += -2.8; } else { dH += 2.3; dS += 4.1; }
  }
  const R = 1.987;
  const autoComp = seq === complementInverse(seq);
  const dSsel = dS + 0.368 * (seq.length - 1) * Math.log(Na);
  const tm = (dH * 1000) / (dSsel + R * Math.log(autoComp ? CT : CT / 4)) - 273.15;
  return Number.isFinite(tm) ? tm : null;
}

const MASSES: Record<string, number> = {A: 313.21, C: 289.18, G: 329.21, T: 304.20};

/** Masse d'un oligonucléotide linéaire à 5'-OH, en g/mol. */
export function masse(seq: string): number | null {
  let m = 0, connues = 0;
  for (const c of seq) {
    const v = MASSES[c];
    if (v !== undefined) { m += v; connues++; }
  }
  return connues ? m - 61.96 : null;
}

const CODE = 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG';
export const CODONS: Record<string, string> = (() => {
  const t: Record<string, string> = {};
  let k = 0;
  for (const a of 'TCAG') for (const b of 'TCAG') for (const c of 'TCAG') t[a + b + c] = CODE[k++] as string;
  return t;
})();

/** Un codon ambigu n'est traduit que si toutes ses issues donnent le même
 *  acide aminé — GGN vaut Gly, ATN ne vaut rien. */
export function traduireCodon(codon: string): string {
  if (codon.length !== 3) return 'X';
  const direct = CODONS[codon];
  if (direct) return direct;
  const choix = [IUPAC[codon[0] as string], IUPAC[codon[1] as string], IUPAC[codon[2] as string]];
  if (choix.some((c) => !c)) return 'X';
  let vu: string | null = null;
  for (const a of choix[0] as string) for (const b of choix[1] as string) for (const c of choix[2] as string) {
    const aa = CODONS[a + b + c] as string;
    if (vu === null) vu = aa;
    else if (vu !== aa) return 'X';
  }
  return vu ?? 'X';
}

export function traduire(seq: string, cadre = 0): string {
  let out = '';
  for (let i = cadre; i + 3 <= seq.length; i += 3) out += traduireCodon(seq.substr(i, 3));
  return out;
}

export interface ORF {
  brin: '+' | '−';
  cadre: string;
  /** Coordonnées sur le brin direct, à partir de 1, quel que soit le brin lu. */
  debut: number;
  fin: number;
  longueurNt: number;
  longueurAA: number;
  avecStop: boolean;
  nt: string;
  prot: string;
}

export function orfs(seq: string, opts: {minAA?: number; inverse?: boolean} = {}): ORF[] {
  const minAA = opts.minAA ?? 30;
  const inverse = opts.inverse ?? true;
  const L = seq.length;
  const trouves: ORF[] = [];

  const enregistrer = (s: string, brin: '+' | '−', i: number, j: number, cadre: number, avecStop: boolean) => {
    const nt = s.slice(i, j);
    const prot = traduire(nt);
    const longueurAA = avecStop ? prot.length - 1 : prot.length;
    if (longueurAA < minAA) return;
    trouves.push({
      brin, cadre: `${brin}${cadre + 1}`,
      debut: brin === '+' ? i + 1 : L - (j - 1),
      fin: brin === '+' ? j : L - i,
      longueurNt: nt.length, longueurAA, avecStop, nt, prot
    });
  };

  const balayer = (s: string, brin: '+' | '−') => {
    for (let cadre = 0; cadre < 3; cadre++) {
      let debut: number | null = null;
      for (let i = cadre; i + 3 <= s.length; i += 3) {
        const codon = s.substr(i, 3);
        if (traduireCodon(codon) === '*') {
          if (debut !== null) { enregistrer(s, brin, debut, i + 3, cadre, true); debut = null; }
        } else if (codon === 'ATG' && debut === null) {
          debut = i;
        }
      }
      if (debut !== null) {
        enregistrer(s, brin, debut, debut + Math.floor((s.length - debut) / 3) * 3, cadre, false);
      }
    }
  };

  balayer(seq, '+');
  if (inverse) balayer(complementInverse(seq), '−');
  trouves.sort((a, b) => b.longueurAA - a.longueurAA || a.debut - b.debut);
  return trouves;
}

export function motifEnRegex(motif: string): RegExp | null {
  let src = '';
  for (const c of String(motif ?? '').toUpperCase()) {
    if (/\s/.test(c)) continue;
    const cls = IUPAC[c];
    if (!cls) return null;
    src += cls.length === 1 ? cls : `[${cls}]`;
  }
  return src ? new RegExp(src) : null;
}

export interface Occurrence {brin: '+' | '−'; debut: number; fin: number; extrait: string}

/** Occurrences chevauchantes comprises : TATATA contient deux TATA. */
export function chercherMotif(seq: string, motif: string, aussiInverse = false): Occurrence[] | null {
  const re = motifEnRegex(motif);
  if (!re) return null;
  const taille = String(motif).replace(/\s/g, '').length;
  const hits: Occurrence[] = [];
  const balayer = (s: string, brin: '+' | '−') => {
    for (let i = 0; i + taille <= s.length; i++) {
      if (re.test(s.substr(i, taille))) {
        const debut = brin === '+' ? i + 1 : seq.length - (i + taille - 1);
        hits.push({brin, debut, fin: debut + taille - 1, extrait: seq.substr(debut - 1, taille)});
      }
    }
  };
  balayer(seq, '+');
  if (aussiInverse) {
    const vus = new Set(hits.map((h) => h.debut));
    const avant = hits.length;
    balayer(complementInverse(seq), '−');
    for (let k = hits.length - 1; k >= avant; k--) {
      if (vus.has((hits[k] as Occurrence).debut)) hits.splice(k, 1);
    }
  }
  hits.sort((a, b) => a.debut - b.debut || (a.brin < b.brin ? -1 : 1));
  return hits;
}

/** Position de la prochaine base ambiguë, à partir de `apres` (index 0).
 *  Rend -1 s'il n'y en a plus. Le bouclage est laissé à l'appelant : sauter
 *  silencieusement au début ferait croire à une progression qui n'existe pas. */
export function prochaineAmbiguite(seq: string, apres = -1): number {
  for (let i = Math.max(0, apres + 1); i < seq.length; i++) {
    const c = seq[i] as string;
    if (!'ACGT'.includes(c)) return i;
  }
  return -1;
}

/** Toutes les positions ambiguës (index 0), pour compter et pour surligner. */
export function ambiguites(seq: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < seq.length; i++) if (!'ACGT'.includes(seq[i] as string)) out.push(i);
  return out;
}
