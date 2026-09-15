/** Relecture d'un fichier de résultats BLAST, hors ligne.
 *
 *  Le NCBI sait exporter ce qu'il vient de chercher ; l'outil sait à quoi
 *  chaque requête correspond, puisqu'il l'a nommée. Les rapprocher rend
 *  lisible ce qu'une capture d'écran ne dit pas : pour CETTE amorce, combien
 *  de sites complets, et où.
 *
 *  Trois formats sont acceptés, parce qu'on ne choisit pas toujours le bon
 *  dans le menu du NCBI :
 *
 *  — « Hit table (text) » : des lignes séparées par des tabulations, précédées
 *    de commentaires « # Query: … » qui portent le nom complet de la requête ;
 *  — « Hit table (csv) » : les mêmes colonnes, séparées par des virgules, mais
 *    sans commentaires — la première colonne y est souvent l'identifiant que
 *    le NCBI a fabriqué (Query_276888), et non notre nom ;
 *  — « Single-file JSON » : le plus sûr, car il porte à la fois l'identifiant,
 *    le titre de la requête et le nom des organismes.
 *
 *  D'où la règle de rapprochement : on cherche le nom d'oligonucléotide
 *  (paire1_F…) partout où il peut se trouver — dans la colonne, dans le
 *  commentaire « # Query: », dans le titre JSON — et on retient le dernier
 *  connu. Ce qui reste sans nom est compté à part et signalé, jamais deviné. */

import {lireNomOligo, nomOligo} from './nomenclature.js';
import type {RoleOligo} from './nomenclature.js';

export interface SiteBlast {
  /** Ce sur quoi ça s'est aligné : accession, et le titre quand on l'a. */
  readonly sujet: string;
  readonly titre?: string;
  readonly organisme?: string;
  readonly identite: number;
  readonly longueur: number;
  readonly mesappariements: number;
  readonly evalue: number;
}

export interface BilanOligo {
  readonly nom: string;
  readonly rangPaire: number;
  readonly role: RoleOligo;
  readonly sites: readonly SiteBlast[];
}

export interface RapportBlast {
  readonly format: 'tabulaire' | 'json';
  /** Par nom d'oligonucléotide, dans l'ordre de première apparition. */
  readonly parOligo: ReadonlyMap<string, BilanOligo>;
  /** Requêtes dont le nom n'a pas pu être retrouvé : ni colonne, ni
   *  commentaire, ni titre. Elles ne sont rattachées à rien. */
  readonly sansNom: number;
  readonly lignes: number;
}

/** Un site « complet » : l'alignement couvre tout l'oligonucléotide et n'a pas
 *  plus de mésappariements que tolérés. C'est le seul qui compte pour une
 *  amorce — un alignement partiel sur douze bases n'amorce rien. La longueur
 *  attendue vient de l'outil, pas du fichier : le NCBI ne la répète pas. */
export function sitesComplets(
  bilan: BilanOligo, longueurOligo: number, mesappariementsMax = 2
): SiteBlast[] {
  return bilan.sites.filter(
    (s) => s.longueur >= longueurOligo && s.mesappariements <= mesappariementsMax);
}

const nombre = (v: unknown): number => {
  const x = Number(String(v ?? '').trim());
  return Number.isFinite(x) ? x : NaN;
};

/** Découpe une ligne en colonnes : virgules ou tabulations, guillemets
 *  respectés — le NCBI met des virgules dans les titres d'organismes. */
function colonnes(ligne: string): string[] {
  const separateur = ligne.includes('\t') && !ligne.includes('","') ? '\t' : ',';
  const sortie: string[] = [];
  let courant = '';
  let entreGuillemets = false;
  for (let i = 0; i < ligne.length; i++) {
    const c = ligne[i] as string;
    if (c === '"') {
      if (entreGuillemets && ligne[i + 1] === '"') { courant += '"'; i++; }
      else entreGuillemets = !entreGuillemets;
    } else if (c === separateur && !entreGuillemets) {
      sortie.push(courant); courant = '';
    } else courant += c;
  }
  sortie.push(courant);
  return sortie.map((x) => x.trim());
}

interface Accumulateur {
  readonly ordre: string[];
  readonly parNom: Map<string, {nom: string; rangPaire: number; role: RoleOligo; sites: SiteBlast[]}>;
  sansNom: number;
  lignes: number;
}

function ajouter(acc: Accumulateur, texteRequete: string, site: SiteBlast | null): void {
  const lu = lireNomOligo(texteRequete);
  if (!lu) { if (site) acc.sansNom++; return; }
  const nom = nomOligo(lu.rangPaire, lu.role);
  let bilan = acc.parNom.get(nom);
  if (!bilan) {
    bilan = {nom, rangPaire: lu.rangPaire, role: lu.role, sites: []};
    acc.parNom.set(nom, bilan);
    acc.ordre.push(nom);
  }
  if (site) { bilan.sites.push(site); acc.lignes++; }
}

/** Les colonnes du format tabulaire standard (`outfmt 6/7/10`) :
 *  requête, sujet, % identité, longueur, mésappariements, trous,
 *  début/fin requête, début/fin sujet, E-value, score. */
function lireTabulaire(texte: string): RapportBlast {
  const acc: Accumulateur = {ordre: [], parNom: new Map(), sansNom: 0, lignes: 0};
  let requeteCourante = '';
  for (const brute of texte.split(/\r\n|\r|\n/)) {
    const ligne = brute.trim();
    if (!ligne) continue;
    if (ligne.startsWith('#')) {
      // « # Query: lcl|Query_276888 paire1_F 3825..3846 » — c'est là que le
      // nom se trouve quand la colonne ne le porte pas.
      const m = /^#\s*Query:\s*(.+)$/i.exec(ligne);
      if (m) {
        requeteCourante = m[1] as string;
        ajouter(acc, requeteCourante, null);     // la requête existe, même sans site
      }
      continue;
    }
    const c = colonnes(ligne);
    if (c.length < 12) continue;
    const identite = nombre(c[2]);
    const longueur = nombre(c[3]);
    if (!Number.isFinite(identite) || !Number.isFinite(longueur)) continue;  // en-tête
    const site: SiteBlast = {
      sujet: c[1] as string,
      identite, longueur,
      mesappariements: nombre(c[4]),
      evalue: nombre(c[10])
    };
    // La colonne de requête d'abord ; le commentaire en secours.
    ajouter(acc, lireNomOligo(c[0] as string) ? (c[0] as string) : requeteCourante, site);
  }
  return figer('tabulaire', acc);
}

/* Le JSON du NCBI : une enveloppe par requête, chacune portant son titre, ses
   résultats, et pour chaque résultat une description et des HSP. On ne lit que
   ce qui sert, et on ne suppose rien de ce qui manque. */
interface JsonHsp {readonly identity?: number; readonly align_len?: number; readonly evalue?: number}
interface JsonDescription {readonly title?: string; readonly sciname?: string; readonly accession?: string; readonly id?: string}
interface JsonHit {readonly description?: readonly JsonDescription[]; readonly hsps?: readonly JsonHsp[]}
interface JsonSearch {
  readonly query_title?: string; readonly query_id?: string;
  readonly hits?: readonly JsonHit[];
}

function lireJson(texte: string): RapportBlast {
  const acc: Accumulateur = {ordre: [], parNom: new Map(), sansNom: 0, lignes: 0};
  const racine = JSON.parse(texte) as Record<string, unknown>;
  const enveloppes = (racine['BlastOutput2'] ?? racine['blastoutput2'] ?? []) as unknown;
  const liste = Array.isArray(enveloppes) ? enveloppes : [enveloppes];

  for (const env of liste) {
    const rapport = ((env as Record<string, unknown>)?.['report'] ?? env) as Record<string, unknown>;
    const resultats = (rapport?.['results'] ?? {}) as Record<string, unknown>;
    const recherches = (resultats['bl2seq'] ?? [resultats['search']]) as unknown;
    for (const brute of (Array.isArray(recherches) ? recherches : [recherches])) {
      const s = brute as JsonSearch | undefined;
      if (!s) continue;
      const etiquette = `${s.query_id ?? ''} ${s.query_title ?? ''}`;
      ajouter(acc, etiquette, null);
      for (const hit of s.hits ?? []) {
        const d = hit.description?.[0];
        for (const hsp of hit.hsps ?? []) {
          const longueur = Number(hsp.align_len ?? 0);
          const identiques = Number(hsp.identity ?? 0);
          ajouter(acc, etiquette, {
            sujet: d?.accession ?? d?.id ?? 'inconnu',
            ...(d?.title ? {titre: d.title} : {}),
            ...(d?.sciname ? {organisme: d.sciname} : {}),
            identite: longueur ? (identiques / longueur) * 100 : 0,
            longueur,
            mesappariements: Math.max(0, longueur - identiques),
            evalue: Number(hsp.evalue ?? NaN)
          });
        }
      }
    }
  }
  return figer('json', acc);
}

function figer(format: 'tabulaire' | 'json', acc: Accumulateur): RapportBlast {
  const parOligo = new Map<string, BilanOligo>();
  for (const nom of acc.ordre) {
    const b = acc.parNom.get(nom);
    if (b) parOligo.set(nom, {nom: b.nom, rangPaire: b.rangPaire, role: b.role, sites: b.sites});
  }
  return {format, parOligo, sansNom: acc.sansNom, lignes: acc.lignes};
}

/** Le point d'entrée : on reconnaît le format au contenu, pas à l'extension —
 *  le NCBI ne nomme pas toujours ses fichiers de la même façon. */
export function lireResultatsBlast(texte: string): RapportBlast {
  const debut = String(texte ?? '').trimStart();
  if (debut.startsWith('{') || debut.startsWith('[')) {
    try {
      return lireJson(debut);
    } catch {
      // Un JSON illisible n'est pas un tableau : autant le dire par un rapport
      // vide plutôt que d'en tirer des lignes au hasard.
      return {format: 'json', parOligo: new Map(), sansNom: 0, lignes: 0};
    }
  }
  return lireTabulaire(debut);
}
