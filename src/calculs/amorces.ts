/** Balayage exhaustif de paires d'amorces.
 *
 *  C'est le calcul qui justifie toute la machinerie des tâches : sur une
 *  séquence de quelques kilobases, il examine des centaines de milliers de
 *  couples. Il rend compte de son avancement, il s'arrête quand on le lui
 *  demande, et il rend alors les meilleures paires trouvées jusque-là.
 *
 *  Les critères sont ceux qu'un opérateur applique à la main : Tm dans une
 *  fenêtre étroite et proche entre les deux amorces, GC raisonnable, pas de
 *  répétition d'une même base, une pince GC en 3' mais pas trois, et pas de
 *  complémentarité entre les extrémités 3' (c'est elle qui fabrique les dimères
 *  d'amorces). Primer3 fait mieux et le fera : voir docs/architecture.md, le
 *  moteur est remplaçable sans toucher au reste. */

import {complementInverse, composition, tmPlusProcheVoisin} from '../core/sequence.js';
import type {Calcul, Contexte} from './types.js';

export interface ParamsAmorces {
  readonly seq: string;
  readonly longMin?: number;
  readonly longMax?: number;
  readonly tmMin?: number;
  readonly tmMax?: number;
  readonly tmOptimale?: number;
  readonly gcMin?: number;
  readonly gcMax?: number;
  readonly ampliconMin?: number;
  readonly ampliconMax?: number;
  readonly deltaTmMax?: number;
  readonly oligoNM?: number;
  readonly selMM?: number;
  readonly maxPaires?: number;
  /** Chercher une sonde d'hydrolyse entre les deux amorces. Une paire sans
   *  sonde exploitable est alors écartée : en qPCR, elle ne sert à rien. */
  readonly sonde?: boolean;
  readonly sondeTmMin?: number;
  readonly sondeTmMax?: number;
  readonly sondeTmOptimale?: number;
  readonly sondeLongMin?: number;
  readonly sondeLongMax?: number;
}

export interface Amorce {
  readonly sens: 'F' | 'R';
  /** Coordonnées sur le brin direct, à partir de 1, bornes comprises. */
  readonly debut: number;
  readonly fin: number;
  readonly seq: string;
  readonly tm: number;
  readonly gc: number;
  /** Nombre de G ou C dans les cinq dernières bases côté 3'. */
  readonly pince: number;
}

export interface Sonde {
  /** Le brin sur lequel la sonde s'hybride ; la séquence donnée est celle à
   *  commander, lue 5' → 3' sur ce brin. */
  readonly brin: '+' | '−';
  /** Coordonnées sur le brin direct, à partir de 1, bornes comprises. */
  readonly debut: number;
  readonly fin: number;
  readonly seq: string;
  readonly tm: number;
  readonly gc: number;
  /** Bases entre la fin de l'amorce avant et le début de la sonde. */
  readonly distanceAvant: number;
}

export interface PaireAmorces {
  readonly avant: Amorce;
  readonly arriere: Amorce;
  readonly amplicon: number;
  readonly deltaTm: number;
  readonly score: number;
  readonly dimere: number;
  readonly sonde?: Sonde;
}

export interface ResultatAmorces {
  readonly paires: readonly PaireAmorces[];
  readonly candidatsAvant: number;
  readonly candidatsArriere: number;
  readonly candidatsSonde: number;
  /** Paires écartées faute de sonde exploitable entre les deux amorces. */
  readonly sansSonde: number;
  readonly pairesExaminees: number;
  readonly interrompu: boolean;
}

const REPETITION = /(A{5,}|C{5,}|G{5,}|T{5,})/;

/** Une amorce dont le 3' se replie sur son propre 5', ou s'apparie avec une
 *  autre, part en dimère : on compte la plus longue complémentarité entre les
 *  dernières bases de l'une et n'importe quel endroit de l'autre. */
function complementariteTerminale(a: string, b: string, fenetre = 6): number {
  const queue = a.slice(-fenetre);
  const cible = complementInverse(b);
  let pire = 0;
  for (let taille = queue.length; taille >= 3; taille--) {
    for (let i = 0; i + taille <= queue.length; i++) {
      if (cible.includes(queue.substr(i, taille))) return taille;
    }
  }
  return pire;
}

/** Une sonde d'hydrolyse obéit à d'autres règles qu'une amorce :
 *  — elle fond 8 à 10 °C plus haut, pour être déjà hybridée quand les amorces
 *    s'allongent ;
 *  — elle ne commence jamais par un G : un G en 5' éteint le fluorophore qu'on
 *    y accroche, et la sonde ne rapporte plus rien ;
 *  — on choisit le brin qui porte le plus de C, pour la même raison ;
 *  — pas de GGGG, qui replie l'oligonucléotide sur lui-même.
 *  C'est pourquoi elle a sa propre fonction, et non des bornes différentes
 *  passées à celle des amorces. */
function evaluerSonde(
  seq: string, debut: number, longueur: number, p: Required<ParamsAmorces>
): Sonde | null {
  const brut = seq.substr(debut, longueur);
  if (brut.length !== longueur || !/^[ACGT]+$/.test(brut)) return null;
  if (REPETITION.test(brut) || /G{4,}/.test(brut)) return null;

  // Le brin qui porte le plus de C ; à égalité, le brin direct.
  const inverse = complementInverse(brut);
  const compte = (o: string, b: string) => (o.match(new RegExp(b, 'g')) ?? []).length;
  const candidats: {brin: '+' | '−'; oligo: string}[] =
    compte(brut, 'C') >= compte(brut, 'G')
      ? [{brin: '+', oligo: brut}, {brin: '−', oligo: inverse}]
      : [{brin: '−', oligo: inverse}, {brin: '+', oligo: brut}];

  for (const {brin, oligo} of candidats) {
    if (oligo.startsWith('G')) continue;              // fluorophore éteint
    const c = composition(oligo);
    if (c.gc < 30 || c.gc > 80) continue;
    const tm = tmPlusProcheVoisin(oligo, p.oligoNM, p.selMM);
    if (tm === null || tm < p.sondeTmMin || tm > p.sondeTmMax) continue;
    return {brin, debut: debut + 1, fin: debut + longueur, seq: oligo, tm, gc: c.gc, distanceAvant: 0};
  }
  return null;
}

function evaluer(
  seq: string, debut: number, longueur: number, sens: 'F' | 'R', p: Required<ParamsAmorces>
): Amorce | null {
  const brut = seq.substr(debut, longueur);
  if (brut.length !== longueur) return null;
  if (!/^[ACGT]+$/.test(brut)) return null;              // pas d'ambiguïté dans une amorce
  if (REPETITION.test(brut)) return null;
  const oligo = sens === 'F' ? brut : complementInverse(brut);
  const c = composition(oligo);
  const gc = c.gc;
  if (gc < p.gcMin || gc > p.gcMax) return null;
  const tm = tmPlusProcheVoisin(oligo, p.oligoNM, p.selMM);
  if (tm === null || tm < p.tmMin || tm > p.tmMax) return null;
  const cinq = oligo.slice(-5);
  const pince = (cinq.match(/[GC]/g) ?? []).length;
  if (pince < 1 || pince > 3) return null;                // ni décollée, ni collée
  if (complementariteTerminale(oligo, oligo) >= 5) return null;   // épingle à cheveux
  return {sens, debut: debut + 1, fin: debut + longueur, seq: oligo, tm, gc, pince};
}

export const balayageAmorces: Calcul<ParamsAmorces, ResultatAmorces> = {
  nom: 'amorces/balayage',
  libelle: 'Balayage exhaustif de paires d’amorces',

  executer(params: ParamsAmorces, ctx: Contexte): ResultatAmorces {
    const p: Required<ParamsAmorces> = {
      seq: params.seq.toUpperCase(),
      longMin: params.longMin ?? 18, longMax: params.longMax ?? 25,
      tmMin: params.tmMin ?? 57, tmMax: params.tmMax ?? 63, tmOptimale: params.tmOptimale ?? 60,
      gcMin: params.gcMin ?? 40, gcMax: params.gcMax ?? 60,
      ampliconMin: params.ampliconMin ?? 100, ampliconMax: params.ampliconMax ?? 1000,
      deltaTmMax: params.deltaTmMax ?? 2,
      oligoNM: params.oligoNM ?? 500, selMM: params.selMM ?? 50,
      maxPaires: params.maxPaires ?? 50,
      sonde: params.sonde ?? false,
      // Huit à dix degrés au-dessus des amorces : la règle de la qPCR.
      sondeTmMin: params.sondeTmMin ?? 67, sondeTmMax: params.sondeTmMax ?? 73,
      sondeTmOptimale: params.sondeTmOptimale ?? 70,
      sondeLongMin: params.sondeLongMin ?? 20, sondeLongMax: params.sondeLongMax ?? 30
    };
    const seq = p.seq;
    const L = seq.length;
    if (L < p.ampliconMin) {
      return {paires: [], candidatsAvant: 0, candidatsArriere: 0, candidatsSonde: 0,
              sansSonde: 0, pairesExaminees: 0, interrompu: false};
    }

    // 1. Les candidats, position par position et longueur par longueur.
    const avant: Amorce[] = [];
    const arriere: Amorce[] = [];
    // Recensées dans la même passe que les amorces, donc dans l'ordre des
    // positions : la recherche par intervalle plus bas s'en sert.
    const sondes: Sonde[] = [];
    for (let i = 0; i < L; i++) {
      if ((i & 255) === 0) {
        if (ctx.annule()) {
          return {paires: [], candidatsAvant: avant.length, candidatsArriere: arriere.length,
                  candidatsSonde: sondes.length, sansSonde: 0, pairesExaminees: 0, interrompu: true};
        }
        ctx.signaler(i, L * 2, 'recherche des amorces candidates');
      }
      for (let l = p.longMin; l <= p.longMax; l++) {
        const f = evaluer(seq, i, l, 'F', p);
        if (f) avant.push(f);
        const r = evaluer(seq, i, l, 'R', p);
        if (r) arriere.push(r);
      }
      if (p.sonde) {
        for (let l = p.sondeLongMin; l <= p.sondeLongMax; l++) {
          const s = evaluerSonde(seq, i, l, p);
          if (s) sondes.push(s);
        }
      }
    }

    // 2. Les couples. Les amorces arrière sont rangées par position de départ,
    //    ce qui permet de n'examiner que la fenêtre d'amplicon autorisée au
    //    lieu du produit cartésien complet.
    arriere.sort((a, b) => a.fin - b.fin);
    const finsArriere = arriere.map((a) => a.fin);
    const premierAuMoins = (borne: number) => {
      let lo = 0, hi = finsArriere.length;
      while (lo < hi) {
        const mi = (lo + hi) >> 1;
        if ((finsArriere[mi] as number) < borne) lo = mi + 1; else hi = mi;
      }
      return lo;
    };

    const retenues: PaireAmorces[] = [];
    let pire = Infinity;
    let examinees = 0;
    let interrompu = false;

    for (let k = 0; k < avant.length; k++) {
      const f = avant[k] as Amorce;
      if ((k & 63) === 0) {
        if (ctx.annule()) { interrompu = true; break; }
        ctx.signaler(L + Math.round((k / Math.max(1, avant.length)) * L), L * 2,
                     `appariement (${retenues.length} paires retenues)`);
      }
      const debutFenetre = premierAuMoins(f.debut + p.ampliconMin - 1);
      for (let j = debutFenetre; j < arriere.length; j++) {
        const r = arriere[j] as Amorce;
        const amplicon = r.fin - f.debut + 1;
        if (amplicon > p.ampliconMax) break;          // rangées : tout le reste est trop long
        if (r.debut <= f.fin) continue;               // les amorces se chevaucheraient
        examinees++;
        const deltaTm = Math.abs(f.tm - r.tm);
        if (deltaTm > p.deltaTmMax) continue;
        const dimere = Math.max(complementariteTerminale(f.seq, r.seq),
                                complementariteTerminale(r.seq, f.seq));
        if (dimere >= 5) continue;
        const score = deltaTm * 2 +
                      Math.abs(f.tm - p.tmOptimale) + Math.abs(r.tm - p.tmOptimale) +
                      Math.abs(f.gc - 50) / 5 + Math.abs(r.gc - 50) / 5 +
                      dimere;
        if (retenues.length >= p.maxPaires && score >= pire) continue;
        retenues.push({avant: f, arriere: r, amplicon, deltaTm, score, dimere});
        if (retenues.length > p.maxPaires * 4) {
          retenues.sort((a, b) => a.score - b.score);
          retenues.length = p.maxPaires;
          pire = (retenues[retenues.length - 1] as PaireAmorces).score;
        }
      }
    }

    retenues.sort((a, b) => a.score - b.score);

    // 3. La sonde, cherchée sur les meilleures paires et non sur les millions
    //    de couples examinés : elle ne départage pas les amorces, elle
    //    complète celles qui tiennent déjà.
    let finales: PaireAmorces[] = retenues;
    let sansSonde = 0;
    if (p.sonde) {
      const debutsSonde = sondes.map((x) => x.debut);
      const premiereSondeApres = (borne: number) => {
        let lo = 0, hi = debutsSonde.length;
        while (lo < hi) {
          const mi = (lo + hi) >> 1;
          if ((debutsSonde[mi] as number) < borne) lo = mi + 1; else hi = mi;
        }
        return lo;
      };
      const avecSonde: PaireAmorces[] = [];
      for (const paire of retenues) {
        let meilleure: Sonde | null = null;
        let meilleurScore = Infinity;
        for (let i = premiereSondeApres(paire.avant.fin + 1); i < sondes.length; i++) {
          const s = sondes[i] as Sonde;
          if (s.debut > paire.arriere.debut) break;      // rangées par position
          if (s.fin >= paire.arriere.debut) continue;    // elle mordrait sur l'amorce arrière
          const distance = s.debut - paire.avant.fin - 1;
          // Près de l'amorce avant, et à la bonne température : les deux
          // critères que suit un opérateur.
          const score = Math.abs(s.tm - p.sondeTmOptimale) + distance / 25;
          if (score < meilleurScore) { meilleurScore = score; meilleure = {...s, distanceAvant: distance}; }
        }
        if (!meilleure) { sansSonde++; continue; }
        avecSonde.push({...paire, sonde: meilleure, score: paire.score + meilleurScore / 2});
      }
      avecSonde.sort((a, b) => a.score - b.score);
      finales = avecSonde;
    }
    if (finales.length > p.maxPaires) finales.length = p.maxPaires;

    ctx.signaler(L * 2, L * 2, interrompu ? 'interrompu' : 'terminé');
    return {paires: finales, candidatsAvant: avant.length, candidatsArriere: arriere.length,
            candidatsSonde: sondes.length, sansSonde, pairesExaminees: examinees, interrompu};
  }
};
