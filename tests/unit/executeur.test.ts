import {describe, expect, it, vi} from 'vitest';
import {ExecuteurLocal} from '../../src/jobs/executeur-local.js';
import type {MessageDuTravailleur, MessageVersTravailleur} from '../../src/jobs/types.js';

/** Un faux travailleur : il joue le scénario qu'on lui donne, sans navigateur.
 *  Ce qu'on éprouve ici, c'est l'exécuteur — le protocole, les états, l'arrêt —
 *  et pas le calcul, qui a ses propres épreuves. */
class FauxTravailleur extends EventTarget {
  terminee = false;
  constructor(private readonly scenario: (msg: MessageVersTravailleur) => MessageDuTravailleur[]) {
    super();
  }
  postMessage(msg: MessageVersTravailleur): void {
    for (const rep of this.scenario(msg)) {
      queueMicrotask(() => {
        if (!this.terminee) this.dispatchEvent(new MessageEvent('message', {data: rep}));
      });
    }
  }
  terminate(): void { this.terminee = true; }
}

const attendre = () => new Promise((r) => setTimeout(r, 5));

describe('exécuteur local', () => {
  it('suit une tâche du démarrage au résultat', async () => {
    const ex = new ExecuteurLocal(() => new FauxTravailleur((m) => [
      {type: 'progression', id: m.id, fait: 1, total: 2, message: 'à mi-chemin'},
      {type: 'fini', id: m.id, resultat: {ok: true}, partiel: false}
    ]) as unknown as Worker);

    const progres = vi.fn();
    const fin = vi.fn();
    const id = ex.lancer('sequence/analyse', {brut: 'ACGT'}, {libelle: 'essai', surProgression: progres, surFin: fin});
    expect(ex.taches()[0]).toMatchObject({id, etat: 'en_cours', libelle: 'essai'});

    await attendre();
    expect(progres).toHaveBeenCalledWith({fait: 1, total: 2, message: 'à mi-chemin'});
    expect(fin).toHaveBeenCalledOnce();
    expect(ex.taches()[0]).toMatchObject({etat: 'terminee', resultat: {ok: true}});
  });

  it('rapporte une erreur du calcul comme une tâche échouée, avec son message', async () => {
    const ex = new ExecuteurLocal(() => new FauxTravailleur((m) => [
      {type: 'erreur', id: m.id, message: 'Calcul inconnu : « truc ».'}
    ]) as unknown as Worker);
    ex.lancer('truc', {});
    await attendre();
    expect(ex.taches()[0]).toMatchObject({etat: 'echouee', erreur: 'Calcul inconnu : « truc ».'});
  });

  it('prévient l’interface à chaque changement', async () => {
    const ex = new ExecuteurLocal(() => new FauxTravailleur((m) => [
      {type: 'progression', id: m.id, fait: 1, total: 2, message: ''},
      {type: 'fini', id: m.id, resultat: 1, partiel: false}
    ]) as unknown as Worker);
    const vues: number[] = [];
    ex.surChangement((t) => vues.push(t.length));
    ex.lancer('sequence/analyse', {});
    await attendre();
    expect(vues.length).toBeGreaterThanOrEqual(3);   // lancement, progression, fin
  });

  it('sans mémoire partagée, l’arrêt supprime le travailleur et le dit', async () => {
    let faux: FauxTravailleur | null = null;
    const ex = new ExecuteurLocal(() => {
      faux = new FauxTravailleur(() => []);          // un calcul qui ne rend jamais la main
      return faux as unknown as Worker;
    });
    const id = ex.lancer('amorces/balayage', {seq: 'A'.repeat(100)});
    ex.annuler(id);
    await attendre();
    expect(ex.taches()[0]).toMatchObject({etat: 'annulee'});
    expect((faux as unknown as FauxTravailleur).terminee).toBe(true);
  });

  it('un résultat partiel est rendu, et marqué comme tel', async () => {
    const ex = new ExecuteurLocal(() => new FauxTravailleur((m) => [
      {type: 'fini', id: m.id, resultat: {paires: []}, partiel: true}
    ]) as unknown as Worker);
    ex.lancer('amorces/balayage', {});
    await attendre();
    expect(ex.taches()[0]).toMatchObject({etat: 'annulee', partiel: true, resultat: {paires: []}});
  });

  it('arrêter une tâche déjà finie ne change rien', async () => {
    const ex = new ExecuteurLocal(() => new FauxTravailleur((m) => [
      {type: 'fini', id: m.id, resultat: 1, partiel: false}
    ]) as unknown as Worker);
    const id = ex.lancer('sequence/analyse', {});
    await attendre();
    ex.annuler(id);
    expect(ex.taches()[0]?.etat).toBe('terminee');
  });
});

describe('registre des calculs', () => {
  it('refuse un calcul inconnu par une erreur nommée', async () => {
    const {trouverCalcul, calculs} = await import('../../src/calculs/registre.js');
    expect(calculs().map((c) => c.nom)).toContain('amorces/balayage');
    expect(() => trouverCalcul('inexistant')).toThrow(/Calcul inconnu/);
  });
});
