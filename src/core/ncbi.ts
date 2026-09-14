/** Le lien vers BLAST, et rien d'autre.
 *
 *  L'application ne parle à personne : sa politique de sécurité interdit toute
 *  requête sortante, et c'est ce qui permet de l'utiliser sur un poste de
 *  laboratoire sans rien demander à personne. Vérifier une sonde sur les bases
 *  du NCBI reste pourtant un réflexe de métier légitime.
 *
 *  Le compromis est celui-ci : l'outil ne contacte jamais le NCBI lui-même. Il
 *  prépare le FASTA des oligonucléotides choisis, et c'est l'opérateur qui, en
 *  cliquant, ouvre le site dans un autre onglet. Rien ne part sans ce geste, et
 *  ce geste est visible.
 *
 *  L'adresse est celle du formulaire blastn ordinaire : on n'y ajoute que la
 *  requête, sans toucher aux réglages de la page — la base, le programme et le
 *  reste restent ceux que l'opérateur a l'habitude de voir. */

import {ecrireFasta} from './fasta.js';
import type {Enregistrement} from './fasta.js';

export const ADRESSE_BLASTN =
  'https://blast.ncbi.nlm.nih.gov/Blast.cgi?PROGRAM=blastn&PAGE_TYPE=BlastSearch&LINK_LOC=blasthome';

/** Ce qu'il faut savoir d'une paire pour en écrire le FASTA. Volontairement
 *  minimal : ce module ne doit pas dépendre du moteur d'amorces. */
export interface PaireExportable {
  readonly avant: {readonly seq: string; readonly debut: number; readonly fin: number};
  readonly arriere: {readonly seq: string; readonly debut: number; readonly fin: number};
  readonly sonde?: {readonly seq: string; readonly debut: number; readonly fin: number} | undefined;
}

/** Une limite prudente pour l'adresse. Les navigateurs en acceptent bien
 *  davantage, mais les serveurs refusent souvent au-delà de quelques milliers
 *  de caractères, et une adresse tronquée donnerait une requête fausse — donc
 *  un résultat faux. Au-delà, on ouvre le formulaire vide et l'opérateur colle
 *  le FASTA, qui est dans le presse-papiers. */
export const LONGUEUR_MAX_ADRESSE = 2000;

/** Les oligonucléotides des paires choisies, en FASTA. Les noms portent le
 *  numéro de la paire et le rôle — c'est ce qu'on relira dans la page de
 *  résultats du NCBI, où rien d'autre ne dira de quoi il s'agit. */
export function oligosEnFasta(
  paires: readonly PaireExportable[], choisies: readonly number[]
): string {
  const enrs: Enregistrement[] = [];
  for (const i of choisies) {
    const p = paires[i];
    if (!p) continue;
    const n = i + 1;
    enrs.push({id: `paire${n}_F`, description: `${p.avant.debut}..${p.avant.fin}`, seq: p.avant.seq});
    enrs.push({id: `paire${n}_R`, description: `${p.arriere.debut}..${p.arriere.fin}`, seq: p.arriere.seq});
    if (p.sonde) {
      enrs.push({id: `paire${n}_sonde`, description: `${p.sonde.debut}..${p.sonde.fin}`, seq: p.sonde.seq});
    }
  }
  return ecrireFasta(enrs);
}

/** L'adresse à ouvrir. `prerempli` dit si la requête y tient : sinon c'est le
 *  formulaire nu, et le FASTA devra être collé. */
export function lienBlastn(fasta: string, limite = LONGUEUR_MAX_ADRESSE):
  {url: string; prerempli: boolean} {
  const texte = fasta.trim();
  if (!texte) return {url: ADRESSE_BLASTN, prerempli: false};
  const url = `${ADRESSE_BLASTN}&QUERY=${encodeURIComponent(texte)}`;
  return url.length <= limite ? {url, prerempli: true} : {url: ADRESSE_BLASTN, prerempli: false};
}
