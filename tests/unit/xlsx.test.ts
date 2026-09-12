import {execFileSync} from 'node:child_process';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {classeurXlsx, colonne, crc32} from '../../src/core/xlsx.js';

const dossier = mkdtempSync(join(tmpdir(), 'xlsx-'));

/** Le classeur est relu par une bibliothèque ZIP indépendante — celle de
 *  Python — qui vérifie les CRC et refuserait une archive mal formée. Se
 *  relire soi-même ne prouverait rien. */
function relire(octets: Uint8Array, nom: string): {liste: string[]; feuille: string} {
  const chemin = join(dossier, nom);
  writeFileSync(chemin, octets);
  const script = [
    'import zipfile, json, sys',
    'z = zipfile.ZipFile(sys.argv[1])',
    'mauvais = z.testzip()',
    'assert mauvais is None, mauvais',
    'print(json.dumps({"liste": z.namelist(),',
    ' "feuille": z.read("xl/worksheets/sheet1.xml").decode("utf-8")}))'
  ].join('\n');
  const sortie = execFileSync('python3', ['-c', script, chemin], {encoding: 'utf-8'});
  return JSON.parse(sortie) as {liste: string[]; feuille: string};
}

/** openpyxl, quand il est là, lit le classeur comme le ferait un tableur :
 *  c'est la seule preuve qui vaille que le fichier n'est pas seulement une
 *  archive valide, mais un classeur qu'Excel saura ouvrir. */
const openpyxlDispo = (() => {
  try {
    execFileSync('python3', ['-c', 'import openpyxl'], {stdio: 'ignore'});
    return true;
  } catch {
    return false;
  }
})();

describe('classeur .xlsx', () => {
  it.skipIf(!openpyxlDispo)('s’ouvre dans un vrai tableur, valeurs et types compris', () => {
    const octets = classeurXlsx('Amorces', [
      ['Nom', 'Séquence', 'Tm'],
      ['F1', 'ACGTACGT', 60.5],
      ['R1', 'TTGCACCA', 59]
    ]);
    const chemin = join(dossier, 'tableur.xlsx');
    writeFileSync(chemin, octets);
    const script = [
      'import openpyxl, json, sys',
      'f = openpyxl.load_workbook(sys.argv[1]).active',
      'print(json.dumps({"titre": f.title, "lignes": [list(l) for l in f.iter_rows(values_only=True)],',
      ' "typeTm": type(f.cell(row=2, column=3).value).__name__}))'
    ].join('\n');
    const lu = JSON.parse(execFileSync('python3', ['-c', script, chemin], {encoding: 'utf-8'})) as
      {titre: string; lignes: unknown[][]; typeTm: string};
    expect(lu.titre).toBe('Amorces');
    expect(lu.lignes).toEqual([['Nom', 'Séquence', 'Tm'], ['F1', 'ACGTACGT', 60.5], ['R1', 'TTGCACCA', 59]]);
    // Une Tm doit rester un nombre : sinon le tableur ne sait plus la trier.
    expect(lu.typeTm).toBe('float');
  });

  it('produit une archive valide, que ZIP relit sans broncher', () => {
    const octets = classeurXlsx('Amorces', [['nom', 'séquence'], ['F1', 'ACGT']]);
    const {liste} = relire(octets, 'simple.xlsx');
    expect(liste).toEqual([
      '[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels', 'xl/worksheets/sheet1.xml'
    ]);
  });

  it('écrit les textes en chaînes et les nombres en nombres', () => {
    const {feuille} = relire(classeurXlsx('F', [['ACGT', 12.5, 0]]), 'types.xlsx');
    expect(feuille).toContain('<t xml:space="preserve">ACGT</t>');
    expect(feuille).toContain('<v>12.5</v>');
    expect(feuille).toContain('<v>0</v>');
    // Un nombre ne doit pas devenir du texte : Excel ne saurait plus l'additionner.
    expect(feuille).not.toContain('<t xml:space="preserve">12.5</t>');
  });

  it('échappe ce qui casserait le XML', () => {
    const {feuille} = relire(classeurXlsx('F', [['a & b <c> "d"']]), 'echappe.xlsx');
    expect(feuille).toContain('a &amp; b &lt;c&gt; &quot;d&quot;');
  });

  it('retire les caractères de contrôle, qu’Excel refuse', () => {
    const {feuille} = relire(classeurXlsx('F', [['bonmauvais']]), 'controle.xlsx');
    expect(feuille).toContain('bonmauvais');
  });

  it('garde les accents et les caractères hors ASCII', () => {
    const {feuille} = relire(classeurXlsx('F', [['sonde collée à l’amorce']]), 'accents.xlsx');
    expect(feuille).toContain('sonde collée à l’amorce');
  });

  it('laisse les cellules vides vides, sans cellule fantôme', () => {
    const {feuille} = relire(classeurXlsx('F', [['a', null, 'c']]), 'vides.xlsx');
    expect(feuille).toContain('r="A1"');
    expect(feuille).not.toContain('r="B1"');
    expect(feuille).toContain('r="C1"');
  });

  it('nomme les colonnes au-delà de Z', () => {
    expect(colonne(0)).toBe('A');
    expect(colonne(25)).toBe('Z');
    expect(colonne(26)).toBe('AA');
    expect(colonne(27)).toBe('AB');
    expect(colonne(51)).toBe('AZ');
    expect(colonne(52)).toBe('BA');
  });

  it('calcule un CRC-32 conforme', () => {
    // Valeur de référence connue pour « 123456789 ».
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('supporte un classeur vide et un grand classeur', () => {
    expect(relire(classeurXlsx('F', []), 'vide.xlsx').liste).toHaveLength(5);
    const grand = Array.from({length: 500}, (_, i) => [`amorce ${i}`, i, 'ACGTACGTACGTACGTACGT']);
    const {feuille} = relire(classeurXlsx('F', grand), 'grand.xlsx');
    expect(feuille).toContain('r="500"');
  });
});
