/** Écriture d'un classeur .xlsx, sans dépendance.
 *
 *  Pourquoi pas une bibliothèque : la politique de sécurité de l'application
 *  interdit tout script tiers, et embarquer 400 ko pour écrire un tableau de
 *  dix lignes serait disproportionné. Pourquoi pas un CSV : un CSV s'ouvre de
 *  travers une fois sur deux (séparateur, encodage, valeurs converties en
 *  dates), et une séquence abîmée par le tableur est une séquence commandée
 *  fausse.
 *
 *  Un .xlsx est une archive ZIP de fichiers XML. On l'écrit sans compression
 *  (méthode « stored ») : le format l'autorise, Excel l'accepte, et cela évite
 *  d'implémenter DEFLATE pour quelques kilo-octets. */

export type Cellule = string | number | null | undefined;

const REMPLACEMENTS: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
};

/** Les caractères de contrôle font déclarer le fichier corrompu par Excel :
 *  on les retire plutôt que de produire un classeur qui ne s'ouvre pas. */
const CONTROLES = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]', 'g');

const ech = (s: string) =>
  s.replace(/[&<>"']/g, (c) => REMPLACEMENTS[c] as string).replace(CONTROLES, '');

/** A, B, … Z, AA, AB… */
export function colonne(index: number): string {
  let n = index + 1;
  let nom = '';
  while (n > 0) {
    const reste = (n - 1) % 26;
    nom = String.fromCharCode(65 + reste) + nom;
    n = Math.floor((n - 1) / 26);
  }
  return nom;
}

function feuilleXml(lignes: readonly (readonly Cellule[])[]): string {
  const corps = lignes.map((ligne, l) => {
    const cellules = ligne.map((valeur, c) => {
      const ref = `${colonne(c)}${l + 1}`;
      if (valeur === null || valeur === undefined || valeur === '') return '';
      if (typeof valeur === 'number' && Number.isFinite(valeur)) {
        return `<c r="${ref}"><v>${valeur}</v></c>`;
      }
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${ech(String(valeur))}</t></is></c>`;
    }).join('');
    return `<row r="${l + 1}">${cellules}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${corps}</sheetData></worksheet>`;
}

/* ── Le ZIP ──────────────────────────────────────────────────────────────── */

const TABLE_CRC = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(octets: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < octets.length; i++) {
    c = (TABLE_CRC[(c ^ (octets[i] as number)) & 0xff] as number) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

interface Entree {
  nom: string;
  donnees: Uint8Array;
}

function zip(entrees: readonly Entree[]): Uint8Array {
  const encodeur = new TextEncoder();
  const morceaux: Uint8Array[] = [];
  const centrale: Uint8Array[] = [];
  let position = 0;

  const ecrire = (taille: number, remplir: (v: DataView, u: Uint8Array) => void) => {
    const tampon = new Uint8Array(taille);
    remplir(new DataView(tampon.buffer), tampon);
    return tampon;
  };

  for (const entree of entrees) {
    const nom = encodeur.encode(entree.nom);
    const crc = crc32(entree.donnees);
    const taille = entree.donnees.length;

    const enTete = ecrire(30 + nom.length, (v, u) => {
      v.setUint32(0, 0x04034b50, true);      // signature d'en-tête local
      v.setUint16(4, 20, true);              // version nécessaire
      v.setUint16(6, 0x0800, true);          // noms en UTF-8
      v.setUint16(8, 0, true);               // stocké, sans compression
      v.setUint16(10, 0, true);              // heure
      v.setUint16(12, 0x2821, true);         // date, fixée : 2020-01-01
      v.setUint32(14, crc, true);
      v.setUint32(18, taille, true);
      v.setUint32(22, taille, true);
      v.setUint16(26, nom.length, true);
      v.setUint16(28, 0, true);
      u.set(nom, 30);
    });
    morceaux.push(enTete, entree.donnees);

    centrale.push(ecrire(46 + nom.length, (v, u) => {
      v.setUint32(0, 0x02014b50, true);
      v.setUint16(4, 20, true);              // version d'écriture
      v.setUint16(6, 20, true);              // version nécessaire
      v.setUint16(8, 0x0800, true);
      v.setUint16(10, 0, true);
      v.setUint16(12, 0, true);
      v.setUint16(14, 0x2821, true);
      v.setUint32(16, crc, true);
      v.setUint32(20, taille, true);
      v.setUint32(24, taille, true);
      v.setUint16(28, nom.length, true);
      v.setUint32(42, position, true);       // décalage de l'en-tête local
      u.set(nom, 46);
    }));
    position += enTete.length + taille;
  }

  const debutCentrale = position;
  const tailleCentrale = centrale.reduce((s, c) => s + c.length, 0);
  const fin = ecrire(22, (v) => {
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, entrees.length, true);
    v.setUint16(10, entrees.length, true);
    v.setUint32(12, tailleCentrale, true);
    v.setUint32(16, debutCentrale, true);
  });

  const total = [...morceaux, ...centrale, fin];
  const sortie = new Uint8Array(total.reduce((s, m) => s + m.length, 0));
  let curseur = 0;
  for (const m of total) { sortie.set(m, curseur); curseur += m.length; }
  return sortie;
}

/** Un classeur d'une feuille, à partir d'un tableau de lignes. La première
 *  ligne est traitée comme les autres : c'est à l'appelant d'y mettre ses
 *  en-têtes. */
export function classeurXlsx(nomFeuille: string, lignes: readonly (readonly Cellule[])[]): Uint8Array {
  const e = new TextEncoder();
  const nom = ech(nomFeuille).slice(0, 31) || 'Feuille1';
  const types = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '</Types>';
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';
  const classeur = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets><sheet name="${nom}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const relsClasseur = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '</Relationships>';

  return zip([
    {nom: '[Content_Types].xml', donnees: e.encode(types)},
    {nom: '_rels/.rels', donnees: e.encode(rels)},
    {nom: 'xl/workbook.xml', donnees: e.encode(classeur)},
    {nom: 'xl/_rels/workbook.xml.rels', donnees: e.encode(relsClasseur)},
    {nom: 'xl/worksheets/sheet1.xml', donnees: e.encode(feuilleXml(lignes))}
  ]);
}
