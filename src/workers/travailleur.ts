/// <reference lib="webworker" />
/** Le travailleur : il exécute un calcul du registre, rend compte, et sait
 *  s'arrêter.
 *
 *  L'arrêt passe par un drapeau en mémoire partagée quand le navigateur nous
 *  donne l'isolation d'origine (voir public/_headers) : un calcul enfermé dans
 *  une boucle synchrone ne lit pas ses messages, mais il peut lire un entier.
 *  Sans mémoire partagée, l'exécuteur supprime le travailleur — l'arrêt est
 *  alors net mais sans résultat partiel. */

import {trouverCalcul} from '../calculs/registre.js';
import type {Contexte} from '../calculs/types.js';
import type {MessageDuTravailleur, MessageVersTravailleur} from '../jobs/types.js';

const poster = (m: MessageDuTravailleur) => (self as unknown as Worker).postMessage(m);

self.addEventListener('message', (evt: MessageEvent<MessageVersTravailleur>) => {
  const msg = evt.data;
  if (msg.type !== 'lancer') return;

  const drapeau = msg.drapeau;
  let dernier = 0;
  const ctx: Contexte = {
    signaler(fait, total, message = '') {
      // Un message par 100 ms suffit à animer une barre ; en poster mille par
      // seconde ne fait qu'engorger la boucle d'événements de la page.
      const t = Date.now();
      if (t - dernier < 100 && fait < total) return;
      dernier = t;
      poster({type: 'progression', id: msg.id, fait, total, message});
    },
    annule: () => (drapeau ? Atomics.load(drapeau, 0) === 1 : false)
  };

  try {
    const calcul = trouverCalcul(msg.calcul);
    const resultat = calcul.executer(msg.params as never, ctx);
    poster({type: 'fini', id: msg.id, resultat, partiel: ctx.annule()});
  } catch (e) {
    poster({type: 'erreur', id: msg.id, message: e instanceof Error ? e.message : String(e)});
  }
});
