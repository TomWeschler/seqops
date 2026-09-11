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
/** Segment de somme maximale (Kadane) : le cœur de l'écrêtage de Mott. Donné à
 *  des scores positifs pour ce qu'on garde et négatifs pour ce qu'on jette, il
 *  trouve la meilleure fenêtre sans couper au premier accident. */
export function meilleurSegment(scores: readonly number[]): {debut: number; fin: number; somme: number} {
  let somme = 0, meilleure = -Infinity, debutCourant = 0, debut = 0, fin = 0;
  for (let i = 0; i < scores.length; i++) {
    somme += scores[i] ?? 0;
    if (somme < 0) { somme = 0; debutCourant = i + 1; }
    else if (somme > meilleure) { meilleure = somme; debut = debutCourant; fin = i + 1; }
  }
  return meilleure > 0 ? {debut, fin, somme: meilleure} : {debut: 0, fin: 0, somme: 0};
}

export function ecreterMott(qualites: readonly number[], seuil = 0.05): Ecretage {
  const n = qualites.length;
  if (!n) return {debut: 0, fin: 0, retireDebut: 0, retireFin: 0, qualiteMoyenne: 0};
  const scores = qualites.map((q) => seuil - Math.pow(10, -(q ?? 0) / 10));
  const {debut, fin} = meilleurSegment(scores);
  return {
    debut, fin, retireDebut: debut, retireFin: n - fin,
    qualiteMoyenne: qualiteMoyenne(qualites, debut, fin)
  };
}


/* ── Quand le fichier ne porte aucune qualité ─────────────────────────────
   Le .ab1 de référence n'a pas d'entrée PCON : impossible d'écrêter par la
   qualité, et impossible de savoir où la lecture cesse d'être lisible. La
   trace, elle, le dit : sur ce fichier, la hauteur médiane des pics passe de
   500 à 2 après la base 830, et la pureté (part du pic appelé dans la somme
   des quatre) tombe de 0,99 à 0,50. On reconstruit donc une qualité à partir
   de ces deux mesures. */

export interface QualiteTrace {
  /** Part du pic appelé dans la somme des quatre, base par base : 1 = un seul
   *  pic net, 0,25 = quatre pics indiscernables. */
  readonly purete: readonly number[];
  /** Hauteur du pic appelé, base par base. */
  readonly hauteur: readonly number[];
  readonly hauteurMediane: number;
}

export function qualiteParTrace(lecture: LectureAbif): QualiteTrace {
  const bases = ['A', 'C', 'G', 'T'] as const;
  const purete: number[] = [];
  const hauteur: number[] = [];
  for (let i = 0; i < lecture.bases.length; i++) {
    const pic = picLePlusHaut(lecture, i);
    if (!pic) { purete.push(0); hauteur.push(0); continue; }
    const total = bases.reduce((s, b) => s + pic.hauteurs[b], 0);
    const appelee = (lecture.bases[i] ?? 'N').toUpperCase();
    const h = (bases as readonly string[]).includes(appelee)
      ? pic.hauteurs[appelee as 'A']
      : Math.max(...bases.map((b) => pic.hauteurs[b]));
    hauteur.push(h);
    purete.push(total > 0 ? h / total : 0);
  }
  const triees = [...hauteur].sort((a, b) => a - b);
  return {purete, hauteur, hauteurMediane: triees[Math.floor(triees.length / 2)] ?? 0};
}

export interface OptionsZone {
  /** Pureté minimale d'une base lisible. */
  pureteMin?: number;
  /** Hauteur minimale, en fraction de la hauteur médiane de la lecture. */
  partHauteurMin?: number;
}

/** La portion de la lecture où le signal vaut quelque chose, déduite de la
 *  trace seule. Sert d'écrêtage de secours quand le fichier n'a pas de
 *  qualités, et borne la recherche des pics doubles : sans elle, la queue de
 *  lecture en fabrique des centaines. */
export function zoneExploitable(lecture: LectureAbif, options: OptionsZone = {}): {debut: number; fin: number} {
  const pureteMin = options.pureteMin ?? 0.7;
  const partHauteurMin = options.partHauteurMin ?? 0.1;
  const q = qualiteParTrace(lecture);
  if (!q.hauteur.length || q.hauteurMediane <= 0) return {debut: 0, fin: 0};
  const plancher = q.hauteurMediane * partHauteurMin;
  const scores = q.purete.map((p, i) =>
    (q.hauteur[i] ?? 0) >= plancher && p >= pureteMin ? 1 : -1);
  const {debut, fin} = meilleurSegment(scores);
  return {debut, fin};
}

/** Hauteur des quatre traces à la position d'une base, et la base du pic le
 *  plus haut.
 *
 *  C'est ce qu'un opérateur regarde devant une ambiguïté : le logiciel du
 *  séquenceur a écrit N parce qu'il hésitait, mais les pics, eux, disent
 *  souvent lequel domine. On rend aussi le rapport au second pic : à 1,2 le
 *  choix est douteux, à 5 il ne l'est pas, et c'est à l'humain de trancher. */
export interface Pic {
  readonly base: 'A' | 'C' | 'G' | 'T';
  readonly hauteurs: Readonly<Record<'A' | 'C' | 'G' | 'T', number>>;
  /** Hauteur du plus haut divisée par celle du deuxième. Infini si le second
   *  est nul, 1 si les deux sont à égalité. */
  readonly rapport: number;
}

export function picLePlusHaut(lecture: LectureAbif, indexBase: number): Pic | null {
  const x = lecture.pics[indexBase];
  if (x === undefined) return null;
  const hauteurs = {A: 0, C: 0, G: 0, T: 0};
  let trouve = false;
  for (const base of ['A', 'C', 'G', 'T'] as const) {
    const trace = lecture.traces[base];
    if (!trace.length) continue;
    trouve = true;
    // Le pic n'est pas toujours exactement sur l'échantillon annoncé : on
    // regarde la fenêtre immédiate plutôt qu'un point isolé.
    let maxi = 0;
    for (let d = -2; d <= 2; d++) {
      const v = trace[x + d];
      if (v !== undefined && v > maxi) maxi = v;
    }
    hauteurs[base] = maxi;
  }
  if (!trouve) return null;
  const classees = (['A', 'C', 'G', 'T'] as const)
    .map((b) => [b, hauteurs[b]] as const)
    .sort((a, b) => b[1] - a[1]);
  const premier = classees[0] as readonly ['A' | 'C' | 'G' | 'T', number];
  const second = classees[1] as readonly ['A' | 'C' | 'G' | 'T', number];
  return {
    base: premier[0],
    hauteurs,
    rapport: second[1] > 0 ? premier[1] / second[1] : (premier[1] > 0 ? Infinity : 1)
  };
}

/* ── Pics secondaires : les hétérozygotes que l'appeleur a tranchés ────────
   Le logiciel du séquenceur écrit une base par position, même quand deux pics
   se superposent. En génotypage, c'est précisément cette position-là qui
   compte : un hétérozygote y apparaît comme deux pics de hauteur voisine, et
   le fichier n'en garde aucune trace. On les retrouve en relisant les traces.

   Deux pièges que la détection doit éviter, sinon elle noie l'opérateur sous
   les fausses alertes :
     — le BRUIT de fond dans les zones faibles, où tout ressemble à tout ;
     — l'ÉPAULEMENT du pic voisin, qui déborde sur la position sans être un
       second allèle. Un vrai second pic culmine AU MÊME endroit que le
       premier ; un épaulement, lui, monte ou descend encore. */

export interface PicDouble {
  /** Index de la base, à partir de 0. */
  readonly index: number;
  /** Base appelée par le séquenceur. */
  readonly appelee: string;
  /** Base du second pic. */
  readonly seconde: 'A' | 'C' | 'G' | 'T';
  readonly hauteurAppelee: number;
  readonly hauteurSeconde: number;
  /** Hauteur du second rapportée au premier, de 0 à 1. */
  readonly rapport: number;
  /** Le code IUPAC qui décrit les deux bases ensemble. */
  readonly iupac: string;
  /** Vrai quand le second pic dépasse celui de la base appelée : ce n'est plus
   *  un hétérozygote équilibré, c'est un appel à vérifier. */
  readonly appelDouteux: boolean;
}

const CODE_IUPAC: Record<string, string> = {
  AG: 'R', CT: 'Y', CG: 'S', AT: 'W', GT: 'K', AC: 'M'
};

export interface OptionsPicsDoubles {
  /** Hauteur relative à partir de laquelle un second pic compte. 0,25 par
   *  défaut : en dessous, on ramasse surtout du bruit et de la diaphonie. */
  seuil?: number;
  /** Ne rien signaler dans les zones où le signal s'effondre : le pic principal
   *  doit atteindre cette fraction de la hauteur médiane de la lecture. */
  seuilSignal?: number;
  debut?: number;
  fin?: number;
}

export function picsDoubles(lecture: LectureAbif, options: OptionsPicsDoubles = {}): PicDouble[] {
  const seuil = options.seuil ?? 0.25;
  const seuilSignal = options.seuilSignal ?? 0.15;
  // Par défaut, on ne cherche que là où le signal vaut quelque chose : la queue
  // d'une lecture Sanger fabrique des « hétérozygotes » par centaines.
  const zone = options.debut === undefined && options.fin === undefined
    ? zoneExploitable(lecture)
    : {debut: options.debut ?? 0, fin: options.fin ?? lecture.bases.length};
  const debut = Math.max(0, zone.debut);
  const fin = Math.min(lecture.bases.length, zone.fin);
  const bases = ['A', 'C', 'G', 'T'] as const;
  if (!lecture.pics.length) return [];

  // Hauteur médiane du pic appelé sur la plage : l'échelle de référence.
  const hauteurs: number[] = [];
  for (let i = debut; i < fin; i++) {
    const pic = picLePlusHaut(lecture, i);
    if (pic) hauteurs.push(Math.max(...bases.map((b) => pic.hauteurs[b])));
  }
  if (!hauteurs.length) return [];
  const triees = [...hauteurs].sort((a, b) => a - b);
  const mediane = triees[Math.floor(triees.length / 2)] as number;
  const plancher = mediane * seuilSignal;

  const trouves: PicDouble[] = [];
  for (let i = debut; i < fin; i++) {
    const x = lecture.pics[i];
    const pic = picLePlusHaut(lecture, i);
    if (x === undefined || !pic) continue;
    const appelee = (lecture.bases[i] ?? 'N').toUpperCase();

    const principale = (bases as readonly string[]).includes(appelee)
      ? pic.hauteurs[appelee as 'A']
      : Math.max(...bases.map((b) => pic.hauteurs[b]));
    if (principale < plancher || principale <= 0) continue;

    let seconde: 'A' | 'C' | 'G' | 'T' | null = null;
    let hauteurSeconde = 0;
    for (const b of bases) {
      if (b === appelee) continue;
      const h = pic.hauteurs[b];
      if (h > hauteurSeconde) { hauteurSeconde = h; seconde = b; }
    }
    if (!seconde) continue;
    const rapport = hauteurSeconde / principale;
    if (rapport < seuil) continue;

    // Deux filtres contre les faux hétérozygotes, appris sur un vrai fichier :
    //
    // 1. L'ÉPAULEMENT. La trace du second monte ou descend encore au lieu de
    //    culminer ici ; un vrai second allèle a son sommet au même endroit.
    const trace = lecture.traces[seconde];
    const ici = trace[x] ?? 0;
    if (ici < (trace[x - 3] ?? 0) || ici < (trace[x + 3] ?? 0)) continue;

    // 2. LA TRAÎNE D'UN VOISIN DE MÊME BASE. Dans une suite AAA, la trace de A
    //    ne redescend pas entre les pics : au milieu, elle reste haute et
    //    ressemble à un second pic. Un vrai second pic, lui, sort d'un creux.
    //    On exige donc qu'il domine nettement les creux qui l'encadrent.
    const precedent = lecture.pics[i - 1];
    const suivant = lecture.pics[i + 1];
    const creux = (autre: number | undefined) => {
      if (autre === undefined) return 0;
      const milieu = Math.round((x + autre) / 2);
      return trace[milieu] ?? 0;
    };
    const plusHautCreux = Math.max(creux(precedent), creux(suivant));
    if (ici < plusHautCreux * 1.5) continue;

    const paire = [appelee, seconde].sort().join('');
    trouves.push({
      index: i, appelee, seconde,
      hauteurAppelee: principale, hauteurSeconde, rapport,
      iupac: CODE_IUPAC[paire] ?? 'N',
      appelDouteux: rapport > 1
    });
  }
  return trouves;
}
