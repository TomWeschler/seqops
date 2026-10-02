/** Les oligonucléotides posés sur la séquence, une ligne par paire.
 *
 *  Tout est écrit sur le brin + : la séquence de référence en haut, et sous
 *  chaque base la lettre de l'oligonucléotide qui s'y hybride. Une amorce
 *  Reverse — et une sonde lue sur le brin − — y apparaissent donc par leur
 *  complément inverse : c'est la seule façon de les aligner lettre à lettre
 *  sur la référence. Ce qu'on commande reste ce qu'affiche le tableau.
 *
 *  Une lettre qui ne correspond pas à la référence est signalée. Elle ne peut
 *  pas venir du moteur, qui découpe ses oligos dans cette même séquence ; elle
 *  dit qu'on regarde une séquence modifiée depuis la recherche. */

import {complementInverse} from './sequence.js';
import type {RoleOligo} from './nomenclature.js';

export interface OligoPlace {
  readonly role: RoleOligo;
  /** Positions sur la référence, 1 pour la première base, bornes comprises. */
  readonly debut: number;
  readonly fin: number;
  /** Le brin sur lequel l'oligonucléotide se lit. */
  readonly brin: '+' | '−';
  /** L'oligonucléotide tel qu'on le commande, 5'→3'. */
  readonly seq: string;
}

/** Un morceau de ligne : des espaces (role null) ou les lettres d'un oligo,
 *  découpées là où la concordance avec la référence change. */
export interface Segment {
  readonly role: RoleOligo | null;
  readonly texte: string;
  readonly ecart: boolean;
}

/** La ligne d'une paire, aussi longue que la référence. Les oligos sont posés
 *  dans l'ordre donné : s'ils se chevauchaient, le dernier l'emporterait — ce
 *  que le moteur n'autorise pas, mais qu'une ligne ne doit pas casser. */
export function pisteAlignee(reference: string, oligos: readonly OligoPlace[]): Segment[] {
  const n = reference.length;
  const lettres: string[] = new Array<string>(n).fill(' ');
  const roles: (RoleOligo | null)[] = new Array<RoleOligo | null>(n).fill(null);

  for (const o of oligos) {
    const surPlus = o.brin === '+' ? o.seq : complementInverse(o.seq);
    for (let k = 0; k < surPlus.length; k++) {
      const i = o.debut - 1 + k;
      if (i < 0 || i >= n) continue;          // hors de la référence : rien à poser
      lettres[i] = surPlus[k] as string;
      roles[i] = o.role;
    }
  }

  const segments: Segment[] = [];
  let courant: {role: RoleOligo | null; texte: string; ecart: boolean} | null = null;
  for (let i = 0; i < n; i++) {
    const role = roles[i] as RoleOligo | null;
    const lettre = lettres[i] as string;
    const ecart = role !== null && lettre.toUpperCase() !== (reference[i] ?? '').toUpperCase();
    if (courant && courant.role === role && courant.ecart === ecart) {
      courant.texte += lettre;
    } else {
      if (courant) segments.push(courant);
      courant = {role, texte: lettre, ecart};
    }
  }
  if (courant) segments.push(courant);
  return segments;
}

/** La règle graduée : le numéro de chaque dizaine commence exactement au-dessus
 *  de la base qu'il numérote (1, 11, 21…). Aussi longue que la référence. */
export function regle(longueur: number, pas = 10): string {
  const cases: string[] = new Array<string>(longueur).fill(' ');
  for (let position = 1; position <= longueur; position += pas) {
    const etiquette = String(position);
    for (let k = 0; k < etiquette.length && position - 1 + k < longueur; k++) {
      cases[position - 1 + k] = etiquette[k] as string;
    }
  }
  return cases.join('');
}
