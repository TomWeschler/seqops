/** Fabrication des rapports.
 *
 *  Deux formats, un seul contenu : du texte pour le cahier de laboratoire et
 *  les diff de dépôt, du HTML autonome pour ce qu'on envoie ou imprime. Aucun
 *  des deux ne dépend du DOM : ils se fabriquent aussi bien dans un test.
 *
 *  Règle du module : un rapport dit d'où viennent les chiffres — le fichier, la
 *  date, les options de correction, la version de l'outil. Un rapport qu'on ne
 *  peut pas rattacher à une manip ne vaut rien. */

import type {Composition, Correction, ORF} from './sequence.js';
import type {PaireAmorces} from '../calculs/amorces.js';

export interface ContenuRapport {
  readonly titre: string;
  readonly source: string;
  readonly version: string;
  readonly etabliLe: Date;
  readonly options: Readonly<Record<string, string | number | boolean>>;
  readonly seq: string;
  readonly correction: Correction;
  readonly composition: Composition;
  readonly orfs?: readonly ORF[];
  readonly amorces?: readonly PaireAmorces[];
  readonly qualite?: {readonly moyenne: number; readonly retireDebut: number; readonly retireFin: number};
}

const d2 = (v: number) => v.toFixed(2);
const d1 = (v: number) => v.toFixed(1);

export function rapportTexte(c: ContenuRapport): string {
  const l: string[] = [];
  l.push(c.titre.toUpperCase());
  l.push('='.repeat(c.titre.length));
  l.push(`Source        : ${c.source}`);
  l.push(`Établi le     : ${c.etabliLe.toISOString().replace('T', ' ').slice(0, 19)} UTC`);
  l.push(`Outil         : seqops ${c.version}`);
  l.push(`Options       : ${Object.entries(c.options).map(([k, v]) => `${k}=${v}`).join(', ') || '—'}`);
  l.push('');
  if (c.qualite) {
    l.push('— QUALITÉ DE LECTURE —');
    l.push(`  qualité moyenne conservée : ${d1(c.qualite.moyenne)} PHRED`);
    l.push(`  écrêté : ${c.qualite.retireDebut} bases au début, ${c.qualite.retireFin} à la fin`);
    l.push('');
  }
  l.push('— CORRECTIONS —');
  const co = c.correction.comptes;
  const dits: [keyof typeof co, string][] = [
    ['miseEnForme', 'espaces et retours à la ligne ignorés'],
    ['numerotation', 'chiffres de numérotation retirés'],
    ['casse', 'bases passées en majuscules'],
    ['uracile', 'uraciles (U) rencontrés'],
    ['lacunes', 'lacunes d’alignement'],
    ['ambigus', 'codes IUPAC ambigus'],
    ['invalides', 'caractères invalides']
  ];
  let rien = true;
  for (const [cle, texte] of dits) {
    if (co[cle] > 0) { l.push(`  ${String(co[cle]).padStart(7)}  ${texte}`); rien = false; }
  }
  if (rien) l.push('  aucune : la séquence était déjà propre.');
  for (const e of c.correction.journal.slice(0, 500)) {
    l.push(`  position ${e.pos} : ${e.quoi} (lu « ${e.avant} »)`);
  }
  if (c.correction.journal.length > 500) {
    l.push(`  … ${c.correction.journal.length - 500} autres corrections.`);
  }
  l.push('');
  l.push('— COMPOSITION —');
  l.push(`  longueur : ${c.composition.longueur} nt`);
  for (const b of ['A', 'C', 'G', 'T'] as const) {
    const n = c.composition.n[b];
    l.push(`  ${b}        : ${n} (${d2((n / (c.composition.longueur || 1)) * 100)} %)`);
  }
  if (c.composition.autres) l.push(`  ambiguës : ${c.composition.autres}`);
  l.push(`  GC       : ${d2(c.composition.gc)} %`);
  l.push(`  biais GC : ${c.composition.skewGC.toFixed(3)}`);
  if (c.orfs?.length) {
    l.push('');
    l.push('— CADRES OUVERTS —');
    for (const o of c.orfs.slice(0, 50)) {
      l.push(`  cadre ${o.cadre}  ${o.debut}..${o.fin}  ${o.longueurAA} aa${o.avecStop ? '' : ' (tronqué)'}`);
    }
  }
  if (c.amorces?.length) {
    l.push('');
    l.push('— PAIRES D’AMORCES —');
    for (const [i, p] of c.amorces.slice(0, 50).entries()) {
      l.push(`  ${String(i + 1).padStart(3)}. amplicon ${p.amplicon} nt, ΔTm ${d1(p.deltaTm)} °C, score ${d2(p.score)}`);
      l.push(`       F ${p.avant.debut}..${p.avant.fin}  ${p.avant.seq}  Tm ${d1(p.avant.tm)} °C, GC ${d1(p.avant.gc)} %`);
      l.push(`       R ${p.arriere.debut}..${p.arriere.fin}  ${p.arriere.seq}  Tm ${d1(p.arriere.tm)} °C, GC ${d1(p.arriere.gc)} %`);
    }
  }
  l.push('');
  l.push('— SÉQUENCE —');
  for (let i = 0; i < c.seq.length; i += 60) {
    l.push(`  ${String(i + 1).padStart(7)}  ${c.seq.substr(i, 60)}`);
  }
  return l.join('\n') + '\n';
}

const ech = (s: string) =>
  s.replace(/[&<>"]/g, (x) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[x] as string));

/** Rapport HTML autonome : aucune ressource externe, ouvrable depuis une pièce
 *  jointe sur un poste sans réseau. */
export function rapportHtml(c: ContenuRapport): string {
  const texte = rapportTexte(c);
  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8">
<title>${ech(c.titre)} — ${ech(c.source)}</title>
<style>
 body{font:14px/1.6 system-ui,sans-serif;max-width:70rem;margin:2rem auto;padding:0 1rem;color:#16161f}
 h1{font-size:1.3rem;margin:0 0 .2rem} .meta{color:#60607a;font-size:.85rem;margin-bottom:1.5rem}
 pre{background:#f6f6fa;border:1px solid #e2e2ee;border-radius:8px;padding:1rem;
     overflow-x:auto;font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace}
 @media print{body{margin:0}pre{border:none;background:none}}
</style></head><body>
<h1>${ech(c.titre)}</h1>
<p class="meta">${ech(c.source)} — établi le ${c.etabliLe.toLocaleString('fr-FR')} — seqops ${ech(c.version)}</p>
<pre>${ech(texte)}</pre>
</body></html>
`;
}
