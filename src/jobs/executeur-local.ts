/** L'exécuteur local : un travailleur par tâche, dans le navigateur.
 *
 *  C'est le seul exécuteur pour l'instant, et c'est un choix, pas un manque :
 *  la contrainte est que les séquences ne quittent pas le poste. Le jour où un
 *  calcul dépassera ce qu'un onglet peut faire (BLAST, alignement de centaines
 *  de lectures), un ExecuteurDistant implémentera la même interface en parlant
 *  à une machine du laboratoire — l'interface n'en saura rien.
 *  Voir docs/architecture.md. */

import type {Executeur, MessageDuTravailleur, OptionsLancement, Tache} from './types.js';

interface Piste {
  tache: Tache;
  worker: Worker;
  drapeau: Int32Array | null;
  options: OptionsLancement<unknown>;
}

const identifiant = () =>
  (globalThis.crypto?.randomUUID?.() ?? `t${Date.now()}${Math.random()}`).slice(0, 13);

export class ExecuteurLocal implements Executeur {
  readonly nom = 'local';
  readonly #pistes = new Map<string, Piste>();
  readonly #ecoutes = new Set<(t: readonly Tache[]) => void>();
  readonly #fabrique: () => Worker;

  /** La fabrique est injectée : les épreuves passent un faux travailleur, et
   *  l'application le vrai (`new Worker(new URL(...), {type:'module'})`). */
  constructor(fabrique?: () => Worker) {
    this.#fabrique = fabrique ??
      (() => new Worker(new URL('../workers/travailleur.ts', import.meta.url), {type: 'module'}));
  }

  lancer<R>(calcul: string, params: unknown, options: OptionsLancement<R> = {}): string {
    const id = identifiant();
    const worker = this.#fabrique();

    // Mémoire partagée si le navigateur nous l'accorde : elle permet d'arrêter
    // un calcul en cours ET de récupérer ce qu'il a déjà trouvé.
    let drapeau: Int32Array | null = null;
    if (typeof SharedArrayBuffer !== 'undefined' && globalThis.crossOriginIsolated) {
      drapeau = new Int32Array(new SharedArrayBuffer(4));
    }

    const tache: Tache<R> = {
      id, calcul, libelle: options.libelle ?? calcul, creeeLe: Date.now(),
      etat: 'en_cours', progression: {fait: 0, total: 0, message: 'démarrage'}
    };
    this.#pistes.set(id, {tache, worker, drapeau, options: options as OptionsLancement<unknown>});

    worker.addEventListener('message', (evt: MessageEvent<MessageDuTravailleur>) => {
      const m = evt.data;
      const piste = this.#pistes.get(m.id);
      if (!piste) return;
      if (m.type === 'progression') {
        this.#majer(m.id, {progression: {fait: m.fait, total: m.total, message: m.message}});
        piste.options.surProgression?.({fait: m.fait, total: m.total, message: m.message});
      } else if (m.type === 'fini') {
        this.#terminer(m.id, {
          etat: m.partiel ? 'annulee' : 'terminee',
          resultat: m.resultat,
          partiel: m.partiel
        });
      } else {
        this.#terminer(m.id, {etat: 'echouee', erreur: m.message});
      }
    });
    worker.addEventListener('error', (e) => {
      this.#terminer(id, {etat: 'echouee', erreur: e.message || 'le travailleur a échoué'});
    });

    worker.postMessage({type: 'lancer', id, calcul, params, ...(drapeau ? {drapeau} : {})});
    this.#prevenir();
    return id;
  }

  annuler(id: string): void {
    const piste = this.#pistes.get(id);
    if (!piste || piste.tache.etat !== 'en_cours') return;
    if (piste.drapeau) {
      // Le calcul verra le drapeau, s'arrêtera et rendra son résultat partiel.
      Atomics.store(piste.drapeau, 0, 1);
      this.#majer(id, {progression: {...piste.tache.progression, message: 'arrêt demandé…'}});
    } else {
      piste.worker.terminate();
      this.#terminer(id, {etat: 'annulee', erreur: 'arrêtée sans résultat partiel'});
    }
  }

  oublier(id: string): void {
    const piste = this.#pistes.get(id);
    if (!piste || piste.tache.etat === 'en_cours') return;
    this.#pistes.delete(id);
    this.#prevenir();
  }

  taches(): readonly Tache[] {
    return [...this.#pistes.values()].map((p) => p.tache).sort((a, b) => b.creeeLe - a.creeeLe);
  }

  surChangement(ecoute: (t: readonly Tache[]) => void): () => void {
    this.#ecoutes.add(ecoute);
    return () => this.#ecoutes.delete(ecoute);
  }

  #majer(id: string, champs: Partial<Tache>): void {
    const piste = this.#pistes.get(id);
    if (!piste) return;
    piste.tache = {...piste.tache, ...champs} as Tache;
    this.#prevenir();
  }

  #terminer(id: string, champs: Partial<Tache>): void {
    const piste = this.#pistes.get(id);
    if (!piste || piste.tache.etat !== 'en_cours') return;
    piste.worker.terminate();
    this.#majer(id, champs);
    piste.options.surFin?.(this.#pistes.get(id)!.tache);
  }

  #prevenir(): void {
    const t = this.taches();
    for (const e of this.#ecoutes) e(t);
  }
}
