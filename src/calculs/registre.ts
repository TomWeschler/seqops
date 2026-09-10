/** Le catalogue des calculs disponibles.
 *
 *  Un seul endroit à modifier pour en ajouter un : le travailleur, l'exécuteur
 *  et l'interface passent tous par ce registre. Un calcul demandé mais inconnu
 *  est une erreur nette, jamais un silence. */

import type {Calcul} from './types.js';
import {analyseSequence} from './analyse.js';
import {balayageAmorces} from './amorces.js';

const CALCULS = [analyseSequence, balayageAmorces] as const;

const PAR_NOM = new Map<string, Calcul<never, unknown>>(
  CALCULS.map((c) => [c.nom, c as unknown as Calcul<never, unknown>])
);

export function calculs(): readonly {nom: string; libelle: string}[] {
  return CALCULS.map((c) => ({nom: c.nom, libelle: c.libelle}));
}

export function trouverCalcul(nom: string): Calcul<never, unknown> {
  const c = PAR_NOM.get(nom);
  if (!c) throw new Error(`Calcul inconnu : « ${nom} ». Connus : ${[...PAR_NOM.keys()].join(', ')}.`);
  return c;
}
