/** Écriture d'un PDF de texte, sans dépendance.
 *
 *  Même raison que pour le classeur .xlsx : la politique de sécurité interdit
 *  tout script tiers, et une bibliothèque PDF pèse plus lourd que toute
 *  l'application. Le besoin est modeste — une liste d'oligonucléotides qu'on
 *  imprime et qu'on range dans un dossier —, et un PDF de texte tient en trois
 *  cents lignes.
 *
 *  Le document n'embarque aucune police : il s'appuie sur les polices de base
 *  qu'un lecteur PDF doit fournir (Helvetica, Courier). D'où la contrainte
 *  d'encodage : ces polices sont lues en WinAnsi, qui couvre le français mais
 *  pas la typographie fine — les primes et les apostrophes courbes sont donc
 *  remplacées par leur équivalent simple, plutôt que de produire des losanges
 *  noirs sur une feuille de commande. */

export type StylePdf = 'titre' | 'soustitre' | 'corps' | 'note' | 'fixe' | 'saut';

export interface LignePdf {
  readonly texte?: string;
  readonly style?: StylePdf;
}

interface Police {
  readonly ref: string;
  readonly taille: number;
  readonly hauteur: number;
}

const POLICES: Record<StylePdf, Police> = {
  titre:     {ref: '/F2', taille: 15, hauteur: 22},
  soustitre: {ref: '/F2', taille: 10, hauteur: 16},
  corps:     {ref: '/F1', taille: 9.5, hauteur: 13},
  note:      {ref: '/F1', taille: 8, hauteur: 11},
  fixe:      {ref: '/F3', taille: 8.5, hauteur: 12},
  saut:      {ref: '/F1', taille: 9, hauteur: 7}
};

const LARGEUR = 595.28;      // A4 portrait, en points
const HAUTEUR = 841.89;
const MARGE = 42;
const BAS = 54;              // place pour le pied de page

/** Ce que WinAnsi ne sait pas écrire, et par quoi le remplacer. Mieux vaut une
 *  apostrophe droite qu'un caractère manquant au milieu d'une séquence. */
const REMPLACEMENTS: Record<string, string> = {
  '\u2032': "'", '\u2033': '"',                 // primes 5' et 3'
  '\u2018': '\u0091', '\u2019': '\u0092',       // apostrophes courbes
  '\u201c': '\u0093', '\u201d': '\u0094',       // guillemets anglais
  '\u2013': '\u0096', '\u2014': '\u0097', '\u2026': '\u0085',
  '\u2212': '-', '\u00a0': ' ', '\u202f': ' ',
  '\u2192': '->', '\u2264': '<=', '\u2265': '>=',
  // Les lettres grecques n'existent pas en WinAnsi : « ?Tm » ne veut rien dire
  // sur une feuille de commande, « delta Tm » se lit.
  '\u0394': 'delta ', '\u03b4': 'delta ', '\u03bc': '\u00b5'
};

/** Texte vers octets WinAnsi, échappés pour une chaîne PDF. */
function chaine(texte: string): string {
  let sortie = '';
  for (const c of String(texte ?? '')) {
    const remplace = REMPLACEMENTS[c] ?? c;
    for (const d of remplace) {
      const code = d.codePointAt(0) as number;
      if (code === 0x28 || code === 0x29 || code === 0x5c) sortie += `\\${d}`;
      else if (code < 32) sortie += ' ';
      else if (code < 127) sortie += d;
      else if (code < 256) sortie += `\\${code.toString(8).padStart(3, '0')}`;
      else sortie += '?';           // hors WinAnsi : rien de mieux à proposer
    }
  }
  return sortie;
}

/** Largeur approchée d'une ligne, pour décider d'un retour à la ligne. Les
 *  largeurs exactes des polices de base demanderaient leurs tables de
 *  métriques ; 0,52 em pour Helvetica et 0,6 em pour Courier suffisent, et une
 *  ligne un peu courte vaut mieux qu'une ligne qui sort de la page. */
const largeur = (texte: string, p: Police) =>
  texte.length * p.taille * (p.ref === '/F3' ? 0.6 : 0.52);

function couper(texte: string, p: Police, largeurMax: number): string[] {
  if (largeur(texte, p) <= largeurMax) return [texte];
  const sorties: string[] = [];
  let courante = '';
  for (const mot of texte.split(' ')) {
    const essai = courante ? `${courante} ${mot}` : mot;
    if (largeur(essai, p) > largeurMax && courante) { sorties.push(courante); courante = mot; }
    else courante = essai;
  }
  if (courante) sorties.push(courante);
  return sorties;
}

/** Le document : une suite de lignes stylées, découpée en pages. */
export function documentPdf(titre: string, lignes: readonly LignePdf[]): Uint8Array {
  const pages: string[][] = [];
  let page: string[] = [];
  let y = HAUTEUR - MARGE;

  const ecrire = (texte: string, p: Police) => {
    if (y - p.hauteur < BAS) { pages.push(page); page = []; y = HAUTEUR - MARGE; }
    y -= p.hauteur;
    page.push(`BT ${p.ref} ${p.taille} Tf 1 0 0 1 ${MARGE.toFixed(2)} ${y.toFixed(2)} Tm ` +
              `(${chaine(texte)}) Tj ET`);
  };

  for (const ligne of lignes) {
    const p = POLICES[ligne.style ?? 'corps'] as Police;
    if (!ligne.texte) {
      // Une ligne vide ne s'écrit pas, elle se saute — mais pas en haut d'une
      // page, où elle laisserait un blanc inexpliqué.
      if (page.length) y -= p.hauteur;
      continue;
    }
    for (const morceau of couper(ligne.texte, p, LARGEUR - 2 * MARGE)) ecrire(morceau, p);
  }
  pages.push(page);

  /* ── Les objets ────────────────────────────────────────────────────────── */
  const objets: string[] = [];
  const total = pages.length;
  const premierePage = 6;                       // 1 catalogue, 2 pages, 3 à 5 polices
  const idsPages = pages.map((_, i) => premierePage + i * 2);

  objets[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objets[2] = `<< /Type /Pages /Kids [${idsPages.map((id) => `${id} 0 R`).join(' ')}] ` +
              `/Count ${total} >>`;
  objets[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objets[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  objets[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>';

  const encodeur = new TextEncoder();
  pages.forEach((contenu, i) => {
    const idPage = idsPages[i] as number;
    const idFlux = idPage + 1;
    const pied = `BT /F1 7.5 Tf 1 0 0 1 ${MARGE} ${(BAS - 18).toFixed(2)} Tm ` +
      `(${chaine(`${titre} - page ${i + 1} sur ${total}`)}) Tj ET`;
    const flux = [...contenu, pied].join('\n');
    objets[idPage] = `<< /Type /Page /Parent 2 0 R ` +
      `/MediaBox [0 0 ${LARGEUR.toFixed(2)} ${HAUTEUR.toFixed(2)}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${idFlux} 0 R >>`;
    // La longueur du flux se compte en OCTETS : une séquence accentuée en
    // compterait moins si on comptait les caractères, et le lecteur tronquerait
    // la page.
    objets[idFlux] = `<< /Length ${encodeur.encode(flux).length} >>\nstream\n${flux}\nendstream`;
  });

  /* ── L'assemblage, avec la table des décalages ─────────────────────────── */
  const entete = '%PDF-1.4\n';
  const morceaux: string[] = [entete];
  const decalages: number[] = [];
  let position = encodeur.encode(entete).length;

  for (let n = 1; n < objets.length; n++) {
    const corps = `${n} 0 obj\n${objets[n]}\nendobj\n`;
    decalages[n] = position;
    morceaux.push(corps);
    position += encodeur.encode(corps).length;
  }

  const nombreObjets = objets.length;
  let table = `xref\n0 ${nombreObjets}\n0000000000 65535 f \n`;
  for (let n = 1; n < nombreObjets; n++) {
    table += `${String(decalages[n]).padStart(10, '0')} 00000 n \n`;
  }
  table += `trailer\n<< /Size ${nombreObjets} /Root 1 0 R >>\nstartxref\n${position}\n%%EOF\n`;
  morceaux.push(table);

  return encodeur.encode(morceaux.join(''));
}
