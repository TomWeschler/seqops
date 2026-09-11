/** Spécificité : où, ailleurs que sur sa cible, un oligonucléotide peut-il
 *  s'hybrider ?
 *
 *  Sans BLAST — qui exigerait le réseau, donc d'envoyer les séquences — on ne
 *  peut pas interroger les bases publiques. Mais l'essentiel se joue ailleurs :
 *  une amorce qui s'hybride DEUX FOIS sur la séquence qu'on lui donne, ou qui
 *  s'hybride sur le paralogue qu'on a chargé à côté, échoue en PCR. C'est ce
 *  qu'on vérifie ici, sur toutes les séquences ouvertes.
 *
 *  Deux règles du métier commandent la recherche :
 *    — un mésappariement en 3' empêche l'élongation, un mésappariement en 5'
 *      la gêne à peine. On compte donc séparément les mésappariements de la
 *      queue 3' ;
 *    — un site n'amplifie que s'il en existe un autre, en face et à bonne
 *      distance. Deux sites isolés ne font pas un amplicon. */

import {complementInverse} from './sequence.js';

export interface Site {
  /** Nom de la séquence où le site a été trouvé. */
  readonly source: string;
  /** Coordonnées sur le brin direct de cette séquence, à partir de 1. */
  readonly debut: number;
  readonly fin: number;
  readonly brin: '+' | '−';
  readonly mesappariements: number;
  /** Mésappariements dans la queue 3' de l'oligonucléotide. */
  readonly mesappariements3: number;
}

export interface OptionsSites {
  /** Mésappariements tolérés sur l'ensemble de l'oligonucléotide. */
  mesappariementsMax?: number;
  /** Longueur de la queue 3' regardée à part. */
  queue3?: number;
  /** Mésappariements tolérés dans cette queue. 0 : le 3' doit être parfait. */
  mesappariements3Max?: number;
}

/** Tous les endroits où cet oligonucléotide pourrait s'hybrider, sur les deux
 *  brins. La recherche est exhaustive : sur quelques dizaines de kilobases et
 *  quelques dizaines d'oligonucléotides, elle reste instantanée. */
export function sitesHybridation(
  cible: string, nom: string, oligo: string, options: OptionsSites = {}
): Site[] {
  const mesMax = options.mesappariementsMax ?? 3;
  const queue3 = options.queue3 ?? 5;
  const mes3Max = options.mesappariements3Max ?? 0;
  if (!/^[ACGT]+$/.test(oligo)) return [];
  const L = oligo.length;
  const sites: Site[] = [];

  const balayer = (texte: string, brin: '+' | '−') => {
    for (let i = 0; i + L <= texte.length; i++) {
      let mes = 0;
      let mes3 = 0;
      let abandon = false;
      for (let k = L - 1; k >= 0; k--) {          // depuis le 3' : on abandonne plus vite
        if (texte[i + k] !== oligo[k]) {
          mes++;
          if (k >= L - queue3) mes3++;
          if (mes > mesMax || mes3 > mes3Max) { abandon = true; break; }
        }
      }
      if (abandon) continue;
      // Coordonnées ramenées sur le brin direct de la séquence d'origine.
      const debut = brin === '+' ? i + 1 : cible.length - (i + L - 1);
      sites.push({source: nom, debut, fin: debut + L - 1, brin,
                  mesappariements: mes, mesappariements3: mes3});
    }
  };

  balayer(cible, '+');
  balayer(complementInverse(cible), '−');
  sites.sort((a, b) => a.debut - b.debut);
  return sites;
}

export interface AmpliconParasite {
  readonly source: string;
  readonly debut: number;
  readonly fin: number;
  readonly taille: number;
  /** Les deux oligonucléotides en cause : F+R, mais aussi F+F ou R+R, qui
   *  amplifient très bien quand les sites tombent en sens inverse. */
  readonly par: string;
  readonly mesappariements: number;
}

/** Produits que ces oligonucléotides peuvent former ailleurs que sur leur
 *  cible : un site sur le brin direct et un autre sur le brin inverse, à
 *  distance amplifiable. C'est ce couple-là qui donne une bande parasite. */
export function ampliconsParasites(
  oligos: readonly {nom: string; seq: string}[],
  cibles: readonly {nom: string; seq: string}[],
  tailleMax = 3000,
  options: OptionsSites = {}
): AmpliconParasite[] {
  const parasites: AmpliconParasite[] = [];
  for (const cible of cibles) {
    const tous = oligos.flatMap((o) =>
      sitesHybridation(cible.seq, cible.nom, o.seq, options).map((s) => ({...s, oligo: o.nom})));
    const directs = tous.filter((s) => s.brin === '+');
    const inverses = tous.filter((s) => s.brin === '−');
    for (const f of directs) {
      for (const r of inverses) {
        const taille = r.fin - f.debut + 1;
        if (taille <= 0 || taille > tailleMax) continue;
        parasites.push({
          source: cible.nom, debut: f.debut, fin: r.fin, taille,
          par: f.oligo === r.oligo ? `${f.oligo} × ${r.oligo} (lui-même)` : `${f.oligo} × ${r.oligo}`,
          mesappariements: f.mesappariements + r.mesappariements
        });
      }
    }
  }
  parasites.sort((a, b) => a.mesappariements - b.mesappariements || a.taille - b.taille);
  return parasites;
}
