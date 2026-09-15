import {execFileSync} from 'node:child_process';
import {describe, expect, it} from 'vitest';
import {ENTETES_DESIGN, feuilleDesign} from '../../src/calculs/feuilleDesign.js';
import {balayageAmorces} from '../../src/calculs/amorces.js';
import type {Contexte} from '../../src/calculs/types.js';

const contexte = (): Contexte => ({signaler: () => {}, annule: () => false});

function sequence(n: number, graine = 7): string {
  let x = graine;
  let s = '';
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    s += 'ACGT'[(x >>> 16) & 3];
  }
  return s;
}

const r = balayageAmorces.executer(
  {seq: sequence(2500, 91), sonde: true, maxPaires: 3}, contexte());

/** Le template du laboratoire, lu tel qu'il est livré. L'épreuve compare les
 *  en-têtes produits à ceux du vrai fichier : si quelqu'un reformule une
 *  colonne d'un côté sans l'autre, la feuille exportée cesse de se ranger dans
 *  le classeur existant, et personne ne s'en aperçoit avant la relecture. */
const enTetesDuTemplate = (() => {
  try {
    const script = [
      'import openpyxl, json',
      "f = openpyxl.load_workbook('tests/fixtures/template_designs_FRP.xlsx').active",
      'print(json.dumps({"titre": f.title,',
      ' "entetes": [c.value for c in next(f.iter_rows(min_row=1, max_row=1))]}))'
    ].join('\n');
    return JSON.parse(execFileSync('python3', ['-c', script], {encoding: 'utf-8'})) as
      {titre: string; entetes: (string | null)[];};
  } catch {
    return null;
  }
})();

describe('feuille de design, au format du laboratoire', () => {
  it.skipIf(!enTetesDuTemplate)('reprend mot pour mot les en-têtes du template', () => {
    // La colonne A reste vide dans le template : tout commence en B.
    expect(ENTETES_DESIGN[0]).toBeNull();
    expect(ENTETES_DESIGN).toEqual(enTetesDuTemplate?.entetes);
  });

  it('écrit trois lignes par paire, dans l’ordre du template', () => {
    const lignes = feuilleDesign(r.paires, [0, 1]);
    expect(lignes).toHaveLength(1 + 6);
    expect(lignes[1]?.[2]).toBe('Amorce Forward');
    expect(lignes[2]?.[2]).toBe('Amorce Reverse');
    expect(lignes[3]?.[2]).toBe("Sonde P 5'-3'");
    // Colonnes B et D laissées vides, comme demandé.
    for (const ligne of lignes.slice(1)) {
      expect(ligne[1]).toBeNull();
      expect(ligne[3]).toBeNull();
    }
  });

  it('met la séquence, son complément inverse et la position dans le sens de lecture', () => {
    const [, avant, arriere] = feuilleDesign(r.paires, [0]);
    const p = r.paires[0]!;
    expect(avant?.[4]).toBe(p.avant.seq);
    // La position d'une amorce Reverse se note à l'envers, comme dans le
    // template (« 375-356 ») : c'est son sens de lecture.
    expect(arriere?.[6]).toBe(`${p.arriere.fin}-${p.arriere.debut}`);
    expect(avant?.[6]).toBe(`${p.avant.debut}-${p.avant.fin}`);
    expect(avant?.[7]).toBe(`${p.avant.seq.length} nt`);
  });

  it('écrit le GC en pourcentage calculable pour les amorces, en rapport C/G pour la sonde', () => {
    const [, avant, , sonde] = feuilleDesign(r.paires, [0]);
    expect(avant?.[9]).toEqual({pourcent: r.paires[0]!.avant.gc / 100});
    // La règle qui compte pour une sonde n'est pas le %GC mais le rapport des
    // C aux G : c'est ce que le template note.
    expect(String(sonde?.[9])).toMatch(/\d+ % \(\d+ C \/ \d+ G\)/);
  });

  it('remplit les colonnes de contrôle avec « ok » ou avec ce qui cloche', () => {
    const [, avant] = feuilleDesign(r.paires, [0]);
    expect(avant?.[10]).toBe('ok');                       // répétition d'une base
    expect(avant?.[11]).toBe('ok');                       // fin 3' en G ou C
    expect(avant?.[12]).toBe('ok');                       // suite de G
    expect(String(avant?.[13])).toMatch(/^ok \(/);        // G+C dans les 5 dernières
    // Une amorce retenue par le moteur ne peut pas dépasser les seuils
    // d'OligoCalc : la colonne dit « No », ou nomme la structure vue.
    expect(String(avant?.[14])).toMatch(/^(No|self-annealing|potential hairpin)/);
  });

  it('dit ce qu’il ne peut pas remplir plutôt que de l’inventer', () => {
    const [, avant] = feuilleDesign(r.paires, [0]);
    // Sans fichier BLAST : couverture, e-value et identité restent vides.
    expect(avant?.[15]).toBeNull();
    expect(avant?.[16]).toBeNull();
    expect(avant?.[17]).toBeNull();
    // Le gène et le commentaire ne se devinent pas.
    expect(avant?.[19]).toBeNull();
    expect(avant?.[20]).toBeNull();
  });

  it('reprend le verdict BLAST quand il y en a un', () => {
    const [, avant, arriere] = feuilleDesign(r.paires, [0], {
      blast: (rang, role) => rang === 1 && role === 'F'
        ? {couverture: 1, evalue: 1.8e-7, identite: 100, autresSujets: ['Marituba', 'Resta']}
        : {mention: 'aucun site complet'}
    });
    expect(avant?.[15]).toEqual({pourcent: 1});
    expect(avant?.[16]).toBe(1.8e-7);
    expect(String(avant?.[17])).toBe('100 % (avec aussi Marituba, Resta)');
    // Cherché mais sans site : la case le dit, elle ne reste pas vide.
    expect(arriere?.[17]).toBe('aucun site complet');
  });

  it('porte la taille de l’amplicon sur la ligne Forward, faute de fusion', () => {
    const [, avant, arriere, sonde] = feuilleDesign(r.paires, [0]);
    expect(avant?.[18]).toBe(`${r.paires[0]!.amplicon} pb`);
    expect(arriere?.[18]).toBeNull();
    expect(sonde?.[18]).toBeNull();
  });

  it('signale une sonde qui n’est pas collée, et son amorce de rattachement', () => {
    const lignes = feuilleDesign(r.paires, [0, 1, 2]);
    for (const ligne of lignes.slice(1)) {
      if (ligne[2] !== "Sonde P 5'-3'") continue;
      expect(String(ligne[12])).toMatch(/^(ok collée à la [FR]|à \d+ nt de la [FR])$/);
    }
  });
});
