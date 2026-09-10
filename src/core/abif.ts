/** Lecture des fichiers .ab1 (format ABIF d'Applied Biosystems).
 *
 *  Le format est un en-tête de 128 octets suivi d'un annuaire d'entrées de
 *  28 octets, chacune décrivant une donnée par un nom de quatre lettres et un
 *  numéro : PBAS.1 est l'appel de bases du logiciel, PBAS.2 celui qu'un humain
 *  a corrigé, PCON.n les qualités correspondantes, DATA.9 à DATA.12 les quatre
 *  traces analysées. Tout est en gros-boutien.
 *
 *  On lit le fichier tel qu'il est, sans rien réparer : un .ab1 dont on
 *  corrigerait silencieusement l'en-tête serait un .ab1 dont on ne saurait
 *  plus ce qu'il contient. Ce qui manque est rendu absent, pas inventé. */

export type ValeurAbif = number | string | number[] | Date | Uint8Array;

export interface EntreeAbif {
  readonly nom: string;
  readonly numero: number;
  readonly type: number;
  readonly tailleElement: number;
  readonly nombreElements: number;
  readonly tailleDonnees: number;
  readonly valeur: ValeurAbif;
}

export interface LectureAbif {
  readonly version: number;
  readonly entrees: ReadonlyMap<string, EntreeAbif>;
  /** Appel de bases : la version corrigée (PBAS.2) si elle existe, sinon celle
   *  du logiciel (PBAS.1). `corrige` dit laquelle. */
  readonly bases: string;
  readonly corrige: boolean;
  /** Qualités PHRED, une par base. Vide si le fichier n'en porte pas. */
  readonly qualites: readonly number[];
  /** Position de chaque base dans les traces. */
  readonly pics: readonly number[];
  /** Les quatre traces analysées, rangées par base et non dans l'ordre du
   *  fichier (FWO_ donne l'ordre réel, qui varie selon la chimie). */
  readonly traces: Readonly<Record<'A' | 'C' | 'G' | 'T', readonly number[]>>;
  readonly echantillon: string;
  readonly machine: string;
  readonly modele: string;
  readonly date: string;
  readonly ordreBases: string;
}

export class ErreurAbif extends Error {
  constructor(message: string) { super(message); this.name = 'ErreurAbif'; }
}

const texte = (v: ValeurAbif | undefined): string =>
  typeof v === 'string' ? v.trim() : '';

function lireChaine(vue: DataView, debut: number, longueur: number): string {
  let s = '';
  for (let i = 0; i < longueur; i++) s += String.fromCharCode(vue.getUint8(debut + i));
  return s;
}

function lireValeur(vue: DataView, type: number, offset: number, taille: number, nombre: number): ValeurAbif {
  switch (type) {
    case 1: {   // byte
      const out: number[] = [];
      for (let i = 0; i < nombre; i++) out.push(vue.getUint8(offset + i));
      return out;
    }
    case 2:     // char
      return lireChaine(vue, offset, nombre);
    case 3: {   // word (uint16)
      const out: number[] = [];
      for (let i = 0; i < nombre; i++) out.push(vue.getUint16(offset + i * 2));
      return out;
    }
    case 4: {   // short (int16)
      const out: number[] = [];
      for (let i = 0; i < nombre; i++) out.push(vue.getInt16(offset + i * 2));
      return out;
    }
    case 5: {   // long (int32)
      const out: number[] = [];
      for (let i = 0; i < nombre; i++) out.push(vue.getInt32(offset + i * 4));
      return out;
    }
    case 7: {   // float
      const out: number[] = [];
      for (let i = 0; i < nombre; i++) out.push(vue.getFloat32(offset + i * 4));
      return out;
    }
    case 10:    // date : année (int16), mois, jour
      return new Date(vue.getInt16(offset), vue.getUint8(offset + 2) - 1, vue.getUint8(offset + 3));
    case 11:    // heure : h, min, s, centièmes
      return `${String(vue.getUint8(offset)).padStart(2, '0')}:` +
             `${String(vue.getUint8(offset + 1)).padStart(2, '0')}:` +
             `${String(vue.getUint8(offset + 2)).padStart(2, '0')}`;
    case 18:    // pString : premier octet = longueur
      return lireChaine(vue, offset + 1, Math.max(0, vue.getUint8(offset)));
    case 19:    // cString : terminée par un zéro
      return lireChaine(vue, offset, Math.max(0, nombre - 1));
    default: {
      const brut = new Uint8Array(vue.buffer, vue.byteOffset + offset, taille * nombre);
      return new Uint8Array(brut);   // copie : la vue ne doit pas fuir
    }
  }
}

/** Lit un .ab1. Lève ErreurAbif si ce n'en est pas un — un message clair vaut
 *  mieux qu'un tableau de zéros affiché comme un chromatogramme. */
export function lireAbif(donnees: ArrayBuffer): LectureAbif {
  if (donnees.byteLength < 128) throw new ErreurAbif('Fichier trop court pour être un .ab1.');
  const vue = new DataView(donnees);
  if (lireChaine(vue, 0, 4) !== 'ABIF') {
    throw new ErreurAbif('Ce fichier ne commence pas par « ABIF » : ce n’est pas un chromatogramme .ab1.');
  }
  const version = vue.getUint16(4);
  const nombreEntrees = vue.getInt32(18);
  const debutAnnuaire = vue.getInt32(26);
  if (nombreEntrees <= 0 || debutAnnuaire <= 0 || debutAnnuaire + nombreEntrees * 28 > donnees.byteLength) {
    throw new ErreurAbif('Annuaire ABIF illisible : fichier tronqué ou corrompu.');
  }

  const entrees = new Map<string, EntreeAbif>();
  for (let i = 0; i < nombreEntrees; i++) {
    const p = debutAnnuaire + i * 28;
    const nom = lireChaine(vue, p, 4);
    const numero = vue.getInt32(p + 4);
    const type = vue.getUint16(p + 8);
    const tailleElement = vue.getUint16(p + 10);
    const nombreElements = vue.getInt32(p + 12);
    const tailleDonnees = vue.getInt32(p + 16);
    // Quatre octets ou moins : la donnée tient dans le champ d'offset lui-même.
    const offset = tailleDonnees <= 4 ? p + 20 : vue.getInt32(p + 20);
    if (offset < 0 || offset + tailleDonnees > donnees.byteLength) continue;   // entrée folle : ignorée
    entrees.set(`${nom}.${numero}`, {
      nom, numero, type, tailleElement, nombreElements, tailleDonnees,
      valeur: lireValeur(vue, type, offset, tailleElement, nombreElements)
    });
  }

  const val = (cle: string) => entrees.get(cle)?.valeur;
  const nombres = (cle: string): number[] => {
    const v = val(cle);
    return Array.isArray(v) ? v : [];
  };

  const corrige = typeof val('PBAS.2') === 'string';
  const bases = (corrige ? texte(val('PBAS.2')) : texte(val('PBAS.1'))).toUpperCase();
  const qualites = nombres(corrige && entrees.has('PCON.2') ? 'PCON.2' : 'PCON.1');
  const pics = nombres(entrees.has('PLOC.2') ? 'PLOC.2' : 'PLOC.1');

  // FWO_ donne l'ordre dans lequel les quatre traces sont rangées : sans lui,
  // on afficherait un A à la place d'un G une fois sur deux.
  const ordreBases = (texte(val('FWO_.1')) || 'GATC').toUpperCase();
  const traces: Record<'A' | 'C' | 'G' | 'T', number[]> = {A: [], C: [], G: [], T: []};
  for (let i = 0; i < 4; i++) {
    const base = ordreBases[i];
    if (base !== 'A' && base !== 'C' && base !== 'G' && base !== 'T') continue;
    traces[base] = nombres(`DATA.${9 + i}`);
  }

  const d = val('RUND.1');
  const date = d instanceof Date ? d.toISOString().slice(0, 10) : '';

  return {
    version, entrees, bases, corrige, qualites, pics, traces,
    echantillon: texte(val('SMPL.1')),
    machine: texte(val('MCHN.1')),
    modele: texte(val('MODL.1')),
    date, ordreBases
  };
}

/** Qualité moyenne d'une fenêtre, pour l'écrêtage des bords. */
export function qualiteMoyenne(qualites: readonly number[], debut: number, fin: number): number {
  if (fin <= debut) return 0;
  let s = 0;
  for (let i = debut; i < fin; i++) s += qualites[i] ?? 0;
  return s / (fin - debut);
}

export interface Ecretage {
  readonly debut: number;
  readonly fin: number;
  readonly retireDebut: number;
  readonly retireFin: number;
  readonly qualiteMoyenne: number;
}

/** Écrêtage des extrémités par la méthode dite « Mott modifiée », celle de
 *  phred et de sangeranalyseR : on cumule (seuil − probabilité d'erreur) et on
 *  garde le segment de somme maximale. Elle ne coupe pas à la première base
 *  douteuse, elle cherche la meilleure fenêtre — c'est ce qui la rend robuste
 *  aux creux isolés au milieu d'une bonne lecture. */
export function ecreterMott(qualites: readonly number[], seuil = 0.05): Ecretage {
  const n = qualites.length;
  if (!n) return {debut: 0, fin: 0, retireDebut: 0, retireFin: 0, qualiteMoyenne: 0};
  let somme = 0, meilleure = -Infinity, debutCourant = 0, debut = 0, fin = 0;
  for (let i = 0; i < n; i++) {
    const perreur = Math.pow(10, -(qualites[i] ?? 0) / 10);
    somme += seuil - perreur;
    if (somme < 0) { somme = 0; debutCourant = i + 1; }
    else if (somme > meilleure) { meilleure = somme; debut = debutCourant; fin = i + 1; }
  }
  if (meilleure <= 0) return {debut: 0, fin: 0, retireDebut: 0, retireFin: n, qualiteMoyenne: 0};
  return {
    debut, fin, retireDebut: debut, retireFin: n - fin,
    qualiteMoyenne: qualiteMoyenne(qualites, debut, fin)
  };
}
