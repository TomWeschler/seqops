/** Lecture, écriture et modification de fichiers FASTA (.fas, .fasta, .fa…).
 *
 *  Un fichier chargé est gardé sous forme de liste d'enregistrements ; les
 *  modifications produisent une nouvelle liste (rien n'est muté en place), et
 *  `ecrireFasta` rend le texte à réenregistrer. C'est ce qui permet d'annuler
 *  et de montrer un avant/après honnête. */

export interface Enregistrement {
  /** Identifiant : le premier mot après le « > ». */
  readonly id: string;
  /** Le reste de la ligne d'en-tête, tel quel. */
  readonly description: string;
  /** La séquence telle qu'elle est écrite dans le fichier, sans les sauts de
   *  ligne. Ni corrigée ni mise en majuscules : c'est la source. */
  readonly seq: string;
}

const LARGEUR = 60;

export function lireFasta(texte: string): Enregistrement[] {
  const lignes = String(texte ?? '').split(/\r\n|\r|\n/);
  const enrs: Enregistrement[] = [];
  let entete: string | null = null;
  let morceaux: string[] = [];

  const clore = () => {
    if (entete === null && morceaux.length === 0) return;
    const e = entete ?? '';
    const espace = e.search(/\s/);
    enrs.push({
      id: (espace === -1 ? e : e.slice(0, espace)).trim() || 'sans_nom',
      description: espace === -1 ? '' : e.slice(espace + 1).trim(),
      seq: morceaux.join('')
    });
    entete = null;
    morceaux = [];
  };

  for (const ligne of lignes) {
    if (ligne.startsWith('>')) { clore(); entete = ligne.slice(1); continue; }
    if (entete === null && !ligne.trim()) continue;
    morceaux.push(ligne.trim());
  }
  clore();
  return enrs.filter((e) => e.seq !== '' || e.id !== 'sans_nom');
}

export function ecrireFasta(enrs: readonly Enregistrement[], largeur = LARGEUR): string {
  const sorties: string[] = [];
  for (const e of enrs) {
    sorties.push('>' + (e.description ? `${e.id} ${e.description}` : e.id));
    for (let i = 0; i < e.seq.length; i += largeur) sorties.push(e.seq.substr(i, largeur));
    if (e.seq.length === 0) sorties.push('');
  }
  return sorties.join('\n') + '\n';
}

/* ── Modifications ────────────────────────────────────────────────────────
   Chacune rend une nouvelle liste. Un index hors bornes lève : mieux vaut une
   erreur nette qu'un fichier réécrit sans la modification demandée. */

const borne = (enrs: readonly Enregistrement[], i: number) => {
  if (!Number.isInteger(i) || i < 0 || i >= enrs.length) {
    throw new RangeError(`Enregistrement ${i} inexistant (le fichier en compte ${enrs.length}).`);
  }
};

export function remplacerSequence(enrs: readonly Enregistrement[], i: number, seq: string): Enregistrement[] {
  borne(enrs, i);
  return enrs.map((e, k) => (k === i ? {...e, seq} : e));
}

export function renommer(enrs: readonly Enregistrement[], i: number, id: string, description?: string): Enregistrement[] {
  borne(enrs, i);
  const propre = id.trim().replace(/\s+/g, '_');
  if (!propre) throw new RangeError('Un identifiant vide ne nomme rien.');
  return enrs.map((e, k) => (k === i ? {...e, id: propre, description: description ?? e.description} : e));
}

export function supprimer(enrs: readonly Enregistrement[], i: number): Enregistrement[] {
  borne(enrs, i);
  return enrs.filter((_, k) => k !== i);
}

export function ajouter(enrs: readonly Enregistrement[], enr: Enregistrement): Enregistrement[] {
  return [...enrs, enr];
}

/** Remplace un segment [debut, fin] en coordonnées à partir de 1, bornes
 *  comprises — celles qu'affiche l'interface et que reprend un rapport. */
export function remplacerSegment(
  enrs: readonly Enregistrement[], i: number, debut: number, fin: number, remplacement: string
): Enregistrement[] {
  borne(enrs, i);
  const e = enrs[i] as Enregistrement;
  if (debut < 1 || fin < debut || fin > e.seq.length) {
    throw new RangeError(`Segment ${debut}..${fin} hors de la séquence (${e.seq.length} bases).`);
  }
  return remplacerSequence(enrs, i, e.seq.slice(0, debut - 1) + remplacement + e.seq.slice(fin));
}
