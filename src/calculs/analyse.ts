/** Analyse d'une séquence : correction, composition, cadres ouverts.
 *
 *  Court sur une lecture Sanger, long sur un génome bactérien — d'où son
 *  passage par le même mécanisme de tâches que le reste. */

import {composition, corriger, gcGlissant, orfs, masse} from '../core/sequence.js';
import {tm as tmPcr} from '../core/thermo.js';
import type {OptionsCorrection} from '../core/sequence.js';
import type {Calcul, Contexte} from './types.js';

export interface ParamsAnalyse {
  readonly brut: string;
  readonly correction?: OptionsCorrection;
  readonly fenetreGC?: number;
  readonly orfMinAA?: number;
  readonly oligoNM?: number;
  readonly selMM?: number;
}

export type ResultatAnalyse = {
  readonly seq: string;
  readonly correction: ReturnType<typeof corriger>;
  readonly composition: ReturnType<typeof composition>;
  readonly gc: ReturnType<typeof gcGlissant>;
  readonly orfs: ReturnType<typeof orfs>;
  readonly tm: number | null;
  readonly masse: number | null;
};

export const analyseSequence: Calcul<ParamsAnalyse, ResultatAnalyse> = {
  nom: 'sequence/analyse',
  libelle: 'Correction et analyse d’une séquence',

  executer(params: ParamsAnalyse, ctx: Contexte): ResultatAnalyse {
    ctx.signaler(0, 4, 'correction');
    const correction = corriger(params.brut, params.correction ?? {});
    const seq = correction.seq;

    ctx.signaler(1, 4, 'composition');
    const compo = composition(seq);

    ctx.signaler(2, 4, 'GC glissant');
    const gc = gcGlissant(seq, params.fenetreGC ?? 50);

    ctx.signaler(3, 4, 'cadres ouverts');
    const cadres = ctx.annule() ? [] : orfs(seq, {minAA: params.orfMinAA ?? 30, inverse: true});

    ctx.signaler(4, 4, 'terminé');
    return {
      seq, correction, composition: compo, gc, orfs: cadres,
      tm: tmPcr(seq, {oligoNM: params.oligoNM ?? 500}),
      masse: masse(seq)
    };
  }
};
