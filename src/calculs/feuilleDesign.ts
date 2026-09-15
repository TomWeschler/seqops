/** La feuille « création nveau design » du laboratoire, remplie.
 *
 *  Ce n'est pas un export de plus : c'est LE document que le laboratoire tient
 *  déjà, avec ses colonnes, son ordre et ses formulations. L'outil s'y plie
 *  plutôt que d'imposer les siennes, pour que la feuille produite se range
 *  dans le classeur existant sans être retapée.
 *
 *  Les colonnes qui demandent un jugement — le virus, le gène, le commentaire —
 *  ou un résultat que l'outil ne possède pas restent VIDES. Une case vide se
 *  corrige ; une case remplie au jugé se recopie, et c'est elle qu'on retrouve
 *  six mois plus tard dans un dossier de validation. */

import {complementInverse} from '../core/sequence.js';
import {autoAppariement, plusLongueEpingle} from '../core/thermo.js';
import type {Cellule} from '../core/xlsx.js';
import type {PaireAmorces} from './amorces.js';

export const TITRE_FEUILLE = 'création nveau design CG';

/** Les en-têtes du template, mot pour mot — y compris les fautes de frappe et
 *  les retours à la ligne. Les modifier ferait diverger la feuille produite de
 *  celle que le laboratoire remplit à la main. La colonne A reste vide, comme
 *  dans le template : tout commence en B. */
export const ENTETES_DESIGN: readonly Cellule[] = [
  null,
  'virus',
  null,
  'Nom amorces',
  'séquences 5\'-3\'',
  'reverse complément (5\'-3\') pour info',
  'position ',
  'FR : 18-22 nt\nP : 18-32 nt',
  'FR : Tm = 60°C (salt-adjusted, check with Oligocalc)\nP : Tm = 70°C',
  'FR : GC: 40-60%\nP : séquence avec plus de C que de G',
  'FR : éviter répétition base >4 nt\nP : éviter répétition de G',
  'FR : 3’ fin en G ou C\nP : pas plus de  G ou C dans les 5 dernières bases',
  'FR : éviter long répétition de G\nP : sonde collée ou à 1nt max du 3\' de l\'amorce',
  'FR : G ou C dans les 5 dernières bases du 3\' promeut la liaison spécifique, mais éviter plus de 3 G ou C.\nP : pas de G en 5’.',
  'Self complementarité',
  'query cover (%)',
  'e value ',
  'ident (%)',
  'Taille amplicon',
  'gène',
  'commentaire Sara'
];

/** Ce qu'un fichier BLAST importé dit d'un oligonucléotide, quand il y en a
 *  un. Sans lui, les trois colonnes correspondantes restent vides : « rien
 *  trouvé » et « pas cherché » ne s'écrivent pas de la même façon. */
export interface VerdictBlast {
  readonly couverture?: number;
  readonly evalue?: number;
  readonly identite?: number;
  readonly autresSujets?: readonly string[];
  /** Ce qu'on écrit quand l'oligonucléotide a bien été cherché mais n'a aucun
   *  site qui le couvre entièrement : « aucun site complet » se lit, une case
   *  vide se lirait « pas cherché ». */
  readonly mention?: string;
}

export interface OptionsFeuille {
  /** Appelée pour chaque oligonucléotide, avec le rang de la paire et le rôle. */
  readonly blast?: (rangPaire: number, role: 'F' | 'R' | 'sonde') => VerdictBlast | null;
  readonly repetitionMax?: number;
  readonly repetitionGMax?: number;
  readonly pinceMax?: number;
  readonly sondeRepetitionGMax?: number;
}

const compter = (oligo: string, base: string) => (oligo.match(new RegExp(base, 'g')) ?? []).length;

/** La plus longue suite d'une même base, et laquelle. */
function plusLongueRepetition(oligo: string): {base: string; longueur: number} {
  let meilleur = {base: oligo[0] ?? '', longueur: oligo ? 1 : 0};
  let courante = 1;
  for (let i = 1; i < oligo.length; i++) {
    courante = oligo[i] === oligo[i - 1] ? courante + 1 : 1;
    if (courante > meilleur.longueur) meilleur = {base: oligo[i] as string, longueur: courante};
  }
  return meilleur;
}

function plusLongueSuiteDeG(oligo: string): number {
  return (oligo.match(/G+/g) ?? []).reduce((m, x) => Math.max(m, x.length), 0);
}

/** « 1 G + 1 C », ou « aucun » : la composition des cinq dernières bases, telle
 *  qu'elle est notée à la main dans le template. */
function finLisible(oligo: string): string {
  const fin = oligo.slice(-5);
  const g = compter(fin, 'G');
  const c = compter(fin, 'C');
  if (!g && !c) return 'aucun';
  return [g ? `${g} G` : '', c ? `${c} C` : ''].filter(Boolean).join(' + ');
}

/** La colonne « Self complementarité ». Le template y écrit « No » quand il n'y
 *  a rien à signaler, et une phrase quand il y a quelque chose : on garde les
 *  deux, en disant ce qui a été vu et sur combien de paires de bases. */
function selfComplementarite(oligo: string): string {
  const auto = autoAppariement(oligo);
  const ep = plusLongueEpingle(oligo);
  const notes: string[] = [];
  if (auto.bp >= 4) notes.push(`self-annealing ${auto.bp} pb${auto.touche3 ? ' en 3′' : ''}`);
  if (ep.bp >= 3) notes.push(`potential hairpin formation (${ep.bp} pb)`);
  return notes.length ? notes.join(' ; ') : 'No';
}

const nombreLisible = (v: number, d = 1) =>
  (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('fr-FR');

/** Les quatre colonnes de contrôle (K à N), qui ne veulent pas dire la même
 *  chose pour une amorce et pour une sonde : le template met les deux règles
 *  dans le même en-tête, séparées par « FR : » et « P : ». */
function controlesAmorce(oligo: string, o: Required<Pick<OptionsFeuille, 'repetitionMax' | 'pinceMax'>> & {repetitionGMax: number}): Cellule[] {
  const rep = plusLongueRepetition(oligo);
  const suiteG = plusLongueSuiteDeG(oligo);
  const fin = oligo.slice(-1);
  const g = compter(oligo.slice(-5), 'G');
  const c = compter(oligo.slice(-5), 'C');
  return [
    rep.longueur > o.repetitionMax ? `${rep.longueur} ${rep.base}` : 'ok',
    /[GC]$/.test(oligo) ? 'ok' : `fin en ${fin}`,
    suiteG > o.repetitionGMax ? `${suiteG} G` : 'ok',
    g + c > o.pinceMax ? `${finLisible(oligo)} (plus de ${o.pinceMax})` : `ok (${finLisible(oligo)})`
  ];
}

function controlesSonde(oligo: string, collee: 'F' | 'R', distance: number, suiteGMax: number): Cellule[] {
  const suiteG = plusLongueSuiteDeG(oligo);
  return [
    suiteG > suiteGMax ? `${suiteG} G` : 'ok',
    finLisible(oligo),
    distance === 0 ? `ok collée à la ${collee}` : `à ${distance} nt de la ${collee}`,
    oligo.startsWith('G') ? 'G en 5’' : 'ok'
  ];
}

const colonnesBlast = (v: VerdictBlast | null): Cellule[] => v
  ? [
      v.couverture === undefined ? null : {pourcent: v.couverture},
      v.evalue === undefined ? null : v.evalue,
      v.identite === undefined
        ? (v.mention ?? null)
        : `${nombreLisible(v.identite)} %${v.autresSujets?.length
            ? ` (avec aussi ${v.autresSujets.slice(0, 5).join(', ')})`
            : ''}`
    ]
  : [null, null, null];

/** Trois lignes par paire — F, R, P —, dans l'ordre et aux colonnes du
 *  template. La taille de l'amplicon, qui vaut pour les trois, est portée sur
 *  la première : le générateur n'écrit pas de cellules fusionnées. */
export function feuilleDesign(
  paires: readonly PaireAmorces[], choisies: readonly number[], options: OptionsFeuille = {}
): Cellule[][] {
  const o = {
    repetitionMax: options.repetitionMax ?? 4,
    repetitionGMax: options.repetitionGMax ?? 4,
    pinceMax: options.pinceMax ?? 3,
    sondeRepetitionGMax: options.sondeRepetitionGMax ?? 3
  };
  const lignes: Cellule[][] = [[...ENTETES_DESIGN]];

  for (const i of choisies) {
    const p = paires[i];
    if (!p) continue;
    const rang = i + 1;
    const verdict = (role: 'F' | 'R' | 'sonde') => options.blast?.(rang, role) ?? null;

    const commun = (oligo: string, debut: number, fin: number, sensLecture: boolean, tm: number) => [
      oligo,
      complementInverse(oligo),
      // La position s'écrit dans le sens de lecture de l'oligonucléotide :
      // décroissante pour ce qui se lit sur le brin inverse, comme dans le
      // template (« 375-356 »).
      sensLecture ? `${debut}-${fin}` : `${fin}-${debut}`,
      `${oligo.length} nt`,
      `${nombreLisible(tm)} °C`
    ];

    lignes.push([
      null, null, 'Amorce Forward', null,
      ...commun(p.avant.seq, p.avant.debut, p.avant.fin, true, p.avant.tm),
      {pourcent: p.avant.gc / 100},
      ...controlesAmorce(p.avant.seq, o),
      selfComplementarite(p.avant.seq),
      ...colonnesBlast(verdict('F')),
      `${p.amplicon} pb`, null, null
    ]);

    lignes.push([
      null, null, 'Amorce Reverse', null,
      ...commun(p.arriere.seq, p.arriere.debut, p.arriere.fin, false, p.arriere.tm),
      {pourcent: p.arriere.gc / 100},
      ...controlesAmorce(p.arriere.seq, o),
      selfComplementarite(p.arriere.seq),
      ...colonnesBlast(verdict('R')),
      null, null, null
    ]);

    if (p.sonde) {
      const s = p.sonde;
      const distance = s.collee === 'F' ? s.distanceAvant : s.distanceArriere;
      lignes.push([
        null, null, 'Sonde P 5\'-3\'', null,
        ...commun(s.seq, s.debut, s.fin, s.brin === '+', s.tm),
        // Pour une sonde, le template ne note pas un pourcentage mais le
        // rapport C/G, qui est la règle qui la concerne.
        `${nombreLisible(s.gc, 0)} % (${compter(s.seq, 'C')} C / ${compter(s.seq, 'G')} G)`,
        ...controlesSonde(s.seq, s.collee, distance, o.sondeRepetitionGMax),
        selfComplementarite(s.seq),
        ...colonnesBlast(verdict('sonde')),
        null, null, null
      ]);
    }
  }
  return lignes;
}
