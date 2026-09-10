/** Le chromatogramme : quatre traces, les bases appelées, leur qualité.
 *
 *  C'est la seule chose qu'un opérateur regarde avant de croire une base : on
 *  la dessine à l'échelle des données, sans lissage ni embellissement. Les
 *  bases écrêtées sont grisées, pas cachées — on doit pouvoir vérifier ce que
 *  l'écrêtage a jeté. */

import type {LectureAbif} from '../core/abif.js';

export const COULEURS: Readonly<Record<'A' | 'C' | 'G' | 'T', string>> = {
  A: '#4ade80', C: '#38bdf8', G: '#fbbf24', T: '#f87171'
};

export interface VueChromato {
  /** Première base affichée, à partir de 0. */
  readonly premiere: number;
  /** Nombre de bases affichées. */
  readonly combien: number;
  readonly ecretage?: {debut: number; fin: number};
}

export function dessiner(toile: HTMLCanvasElement, lecture: LectureAbif, vue: VueChromato): void {
  const ctx = toile.getContext('2d');
  if (!ctx) return;
  const dpr = globalThis.devicePixelRatio || 1;
  const largeur = toile.clientWidth || 800;
  const hauteur = toile.clientHeight || 220;
  if (toile.width !== Math.round(largeur * dpr) || toile.height !== Math.round(hauteur * dpr)) {
    toile.width = Math.round(largeur * dpr);
    toile.height = Math.round(hauteur * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, largeur, hauteur);

  const {pics, bases, qualites, traces} = lecture;
  if (!pics.length || !bases.length) {
    ctx.fillStyle = '#60607a';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText('Ce fichier ne porte pas de trace exploitable.', 12, 24);
    return;
  }

  const premiere = Math.max(0, Math.min(vue.premiere, bases.length - 1));
  const combien = Math.max(2, Math.min(vue.combien, bases.length - premiere));
  const derniere = premiere + combien - 1;
  const xDebut = pics[premiere] ?? 0;
  const xFin = pics[derniere] ?? xDebut + 1;
  const etendue = Math.max(1, xFin - xDebut);

  const margeHaut = 26;
  const margeBas = 34;
  const hTrace = hauteur - margeHaut - margeBas;
  const enX = (echantillon: number) => ((echantillon - xDebut) / etendue) * (largeur - 16) + 8;

  // L'échelle verticale est celle de la fenêtre affichée, pas du fichier
  // entier : sinon la fin d'une lecture, toujours plus basse, serait plate.
  let maxi = 1;
  for (const base of ['A', 'C', 'G', 'T'] as const) {
    const t = traces[base];
    for (let i = Math.max(0, xDebut); i <= Math.min(t.length - 1, xFin); i++) {
      const v = t[i] ?? 0;
      if (v > maxi) maxi = v;
    }
  }
  const enY = (v: number) => margeHaut + hTrace - (v / maxi) * hTrace;

  for (const base of ['A', 'C', 'G', 'T'] as const) {
    const t = traces[base];
    if (!t.length) continue;
    ctx.beginPath();
    ctx.strokeStyle = COULEURS[base];
    ctx.lineWidth = 1.2;
    let commence = false;
    for (let i = Math.max(0, Math.floor(xDebut)); i <= Math.min(t.length - 1, Math.ceil(xFin)); i++) {
      const x = enX(i);
      const y = enY(t[i] ?? 0);
      if (commence) ctx.lineTo(x, y); else { ctx.moveTo(x, y); commence = true; }
    }
    ctx.stroke();
  }

  // Les bases, et sous elles une barre de qualité.
  ctx.font = '600 12px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'center';
  for (let i = premiere; i <= derniere; i++) {
    const base = (bases[i] ?? 'N') as 'A' | 'C' | 'G' | 'T';
    const x = enX(pics[i] ?? 0);
    const dansEcretage = !vue.ecretage || (i >= vue.ecretage.debut && i < vue.ecretage.fin);
    ctx.globalAlpha = dansEcretage ? 1 : 0.3;
    ctx.fillStyle = COULEURS[base] ?? '#c084fc';
    ctx.fillText(base, x, hauteur - margeBas + 16);
    const q = qualites[i];
    if (q !== undefined) {
      const h = Math.min(14, (q / 60) * 14);
      ctx.globalAlpha = dansEcretage ? 0.5 : 0.15;
      ctx.fillRect(x - 2.5, hauteur - 14 - h, 5, h);
    }
    ctx.globalAlpha = 1;
  }

  // Repère de position toutes les dix bases.
  ctx.fillStyle = '#60607a';
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
  for (let i = premiere; i <= derniere; i++) {
    if ((i + 1) % 10 !== 0) continue;
    ctx.fillText(String(i + 1), enX(pics[i] ?? 0), 16);
  }
}
