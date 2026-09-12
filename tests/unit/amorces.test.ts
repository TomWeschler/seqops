import {describe, expect, it} from 'vitest';
import {balayageAmorces} from '../../src/calculs/amorces.js';
import type {Contexte} from '../../src/calculs/types.js';
import {complementInverse} from '../../src/core/sequence.js';
import {tm as tmPcr, tmAjusteAuSel} from '../../src/core/thermo.js';

/** Une séquence pseudo-aléatoire reproductible : les épreuves doivent donner
 *  le même verdict à chaque exécution. */
function sequence(n: number, graine = 7): string {
  let x = graine;
  let s = '';
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    s += 'ACGT'[(x >>> 16) & 3];
  }
  return s;
}

const contexte = (annule = () => false): Contexte => ({signaler: () => {}, annule});

describe('balayage d’amorces', () => {
  const seq = sequence(1200);
  const r = balayageAmorces.executer({seq, ampliconMin: 150, ampliconMax: 600, maxPaires: 20}, contexte());

  it('trouve des paires et les rend classées', () => {
    expect(r.paires.length).toBeGreaterThan(0);
    expect(r.paires.length).toBeLessThanOrEqual(20);
    const scores = r.paires.map((p) => p.score);
    expect([...scores].sort((a, b) => a - b)).toEqual(scores);
    expect(r.interrompu).toBe(false);
  });

  it('respecte toutes les contraintes annoncées', () => {
    for (const p of r.paires) {
      expect(p.amplicon).toBeGreaterThanOrEqual(150);
      expect(p.amplicon).toBeLessThanOrEqual(600);
      expect(p.deltaTm).toBeLessThanOrEqual(2);
      for (const a of [p.avant, p.arriere]) {
        expect(a.seq.length).toBeGreaterThanOrEqual(18);
        expect(a.seq.length).toBeLessThanOrEqual(25);
        expect(a.tm).toBeGreaterThanOrEqual(57);
        expect(a.tm).toBeLessThanOrEqual(63);
        expect(a.gc).toBeGreaterThanOrEqual(40);
        expect(a.gc).toBeLessThanOrEqual(60);
        expect(a.seq).not.toMatch(/(A{5,}|C{5,}|G{5,}|T{5,})/);
      }
      // L'amorce arrière est bien lue sur le brin inverse, à sa position.
      expect(p.arriere.seq).toBe(complementInverse(seq.slice(p.arriere.debut - 1, p.arriere.fin)));
      expect(p.avant.seq).toBe(seq.slice(p.avant.debut - 1, p.avant.fin));
      // La Tm est celle des conditions de réaction, pas celle d'un tube de
      // sodium pur : c'est tout l'objet du module thermo.
      expect(p.avant.tm).toBeCloseTo(tmPcr(p.avant.seq) as number, 6);
    }
  });

  it('les deux amorces d’une paire ne se chevauchent jamais', () => {
    for (const p of r.paires) expect(p.arriere.debut).toBeGreaterThan(p.avant.fin);
  });

  it('rend un résultat vide, pas une erreur, quand la séquence est trop courte', () => {
    const court = balayageAmorces.executer({seq: sequence(80), ampliconMin: 150}, contexte());
    expect(court.paires).toHaveLength(0);
  });

  it('s’arrête quand on le lui demande, et le dit', () => {
    let appels = 0;
    const arret = balayageAmorces.executer(
      {seq: sequence(4000), ampliconMin: 150, ampliconMax: 600},
      contexte(() => ++appels > 3)
    );
    expect(arret.interrompu).toBe(true);
  });

  it('sans sonde demandée, aucune paire n’en porte', () => {
    expect(r.paires.every((p) => p.sonde === undefined)).toBe(true);
    expect(r.candidatsSonde).toBe(0);
  });

  it('rend compte de son avancement', () => {
    const vus: number[] = [];
    balayageAmorces.executer({seq, ampliconMin: 150, ampliconMax: 600}, {
      signaler: (fait, total) => vus.push(fait / total),
      annule: () => false
    });
    expect(vus.length).toBeGreaterThan(1);
    expect(Math.max(...vus)).toBe(1);
    expect(vus[0]).toBeLessThan(0.5);
  });
});


describe('sonde d’hydrolyse', () => {
  const seq = sequence(2000, 11);
  const avecSonde = balayageAmorces.executer(
    {seq, ampliconMin: 120, ampliconMax: 400, maxPaires: 15, sonde: true}, contexte());

  it('en trouve, et les place entre les deux amorces', () => {
    expect(avecSonde.paires.length).toBeGreaterThan(0);
    expect(avecSonde.candidatsSonde).toBeGreaterThan(0);
    for (const p of avecSonde.paires) {
      const s = p.sonde;
      expect(s).toBeDefined();
      expect(s!.debut).toBeGreaterThan(p.avant.fin);
      expect(s!.fin).toBeLessThan(p.arriere.debut);
      expect(s!.distanceAvant).toBe(s!.debut - p.avant.fin - 1);
    }
  });

  it('respecte les règles propres à une sonde', () => {
    for (const {sonde: s} of avecSonde.paires) {
      // Un G en 5' éteint le fluorophore : la sonde ne rapporterait rien.
      expect(s!.seq.startsWith('G')).toBe(false);
      expect(s!.seq.length).toBeGreaterThanOrEqual(20);
      expect(s!.seq.length).toBeLessThanOrEqual(30);
      expect(s!.tm).toBeGreaterThanOrEqual(67);
      expect(s!.tm).toBeLessThanOrEqual(73);
      expect(s!.gc).toBeGreaterThanOrEqual(30);
      expect(s!.gc).toBeLessThanOrEqual(80);
      expect(s!.seq).not.toMatch(/G{4,}/);
      // Elle est bien lue sur le brin qu'elle annonce.
      const surLeDirect = seq.slice(s!.debut - 1, s!.fin);
      expect(s!.seq).toBe(s!.brin === '+' ? surLeDirect : complementInverse(surLeDirect));
      expect(s!.seq.startsWith('G')).toBe(false);
    }
  });

  it('fond plus haut que ses amorces — c’est sa raison d’être', () => {
    for (const p of avecSonde.paires) {
      expect(p.sonde!.tm).toBeGreaterThan(Math.max(p.avant.tm, p.arriere.tm) + 3);
    }
  });

  it('colle la sonde à l’une des deux amorces', () => {
    for (const {sonde: s} of avecSonde.paires) {
      expect(Math.min(s!.distanceAvant, s!.distanceArriere)).toBeLessThanOrEqual(1);
      expect(s!.collee).toBe(s!.distanceAvant <= s!.distanceArriere ? 'F' : 'R');
    }
  });

  it('le brin de la sonde suit l’amorce à laquelle elle est collée', () => {
    // Collée à F → brin + ; collée à R → brin −. C'est le brin que
    // l'élongation de l'amorce voisine vient parcourir.
    expect(avecSonde.paires.length).toBeGreaterThan(0);
    for (const {sonde: s} of avecSonde.paires) {
      expect(s!.brin).toBe(s!.collee === 'F' ? '+' : '−');
    }
    // La séquence rendue est bien celle de ce brin-là, pas de l'autre.
    for (const {sonde: s} of avecSonde.paires) {
      const surLeDirect = seq.slice(s!.debut - 1, s!.fin);
      expect(s!.seq).toBe(s!.brin === '+' ? surLeDirect : complementInverse(surLeDirect));
    }
  });

  it('la distance autorisée se règle, et elle mord', () => {
    const commun = {seq, ampliconMin: 120, ampliconMax: 400, sonde: true, maxPaires: 40};
    const collee = balayageAmorces.executer({...commun, sondeDistanceMax: 0}, contexte());
    const large = balayageAmorces.executer({...commun, sondeDistanceMax: 60}, contexte());

    // Collée veut dire collée : aucune tolérance.
    for (const {sonde: s} of collee.paires) {
      expect(Math.min(s!.distanceAvant, s!.distanceArriere)).toBe(0);
    }

    // Ce que desserrer change vraiment : ce ne sont pas les sondes retenues —
    // le score préfère de toute façon la plus proche — mais le nombre de paires
    // PERDUES faute de sonde dans la fenêtre. C'est là que le réglage se voit.
    expect(large.sansSonde).toBeLessThan(collee.sansSonde);
    expect(large.paires.length).toBeGreaterThanOrEqual(collee.paires.length);
  });

  it('écarte les paires sans sonde exploitable, et le compte', () => {
    const strict = balayageAmorces.executer(
      // Une fenêtre de Tm que presque aucune sonde n'atteindra.
      {seq, ampliconMin: 120, ampliconMax: 400, sonde: true, sondeTmMin: 84, sondeTmMax: 86},
      contexte());
    expect(strict.paires).toHaveLength(0);
    expect(strict.sansSonde).toBeGreaterThan(0);
  });

  it('les longueurs de sonde demandées sont respectées', () => {
    const court = balayageAmorces.executer(
      {seq, ampliconMin: 120, ampliconMax: 400, sonde: true, sondeLongMin: 24, sondeLongMax: 26},
      contexte());
    for (const p of court.paires) {
      expect(p.sonde!.seq.length).toBeGreaterThanOrEqual(24);
      expect(p.sonde!.seq.length).toBeLessThanOrEqual(26);
    }
  });
});

describe('spécificité', () => {
  const seq = sequence(1500, 31);

  it('toutes les paires rendues sont spécifiques par défaut', () => {
    const r = balayageAmorces.executer({seq, ampliconMin: 150, ampliconMax: 500, maxPaires: 20}, contexte());
    expect(r.paires.length).toBeGreaterThan(0);
    for (const p of r.paires) {
      expect(p.sitesAvant).toBe(1);
      expect(p.sitesArriere).toBe(1);
      expect(p.parasites).toHaveLength(0);
    }
    expect(r.verifieeSur).toEqual(['cible']);
  });

  it('une cible dupliquée fait tout écarter — c’est le cas du paralogue', () => {
    // La même séquence deux fois : chaque amorce s'hybride forcément deux fois.
    const r = balayageAmorces.executer(
      {seq, ampliconMin: 150, ampliconMax: 500, maxPaires: 20,
       autresSequences: [{nom: 'paralogue', seq}]}, contexte());
    expect(r.paires).toHaveLength(0);
    expect(r.ecarteesSpecificite).toBeGreaterThan(0);
    expect(r.verifieeSur).toEqual(['cible', 'paralogue']);
  });

  it('...et la même recherche passe si on n’exige plus la spécificité', () => {
    const r = balayageAmorces.executer(
      {seq, ampliconMin: 150, ampliconMax: 500, maxPaires: 20,
       autresSequences: [{nom: 'paralogue', seq}], exigerSpecificite: false}, contexte());
    expect(r.paires.length).toBeGreaterThan(0);
    // Et le défaut est annoncé, pas caché : deux sites, un produit parasite.
    expect(r.paires[0]!.sitesAvant).toBe(2);
    expect(r.paires[0]!.parasites.length).toBeGreaterThan(0);
    expect(r.paires[0]!.parasites[0]!.source).toBe('paralogue');
  });

  it('une séquence étrangère ne gêne personne', () => {
    const r = balayageAmorces.executer(
      {seq, ampliconMin: 150, ampliconMax: 500, maxPaires: 10,
       autresSequences: [{nom: 'vecteur', seq: sequence(3000, 999)}]}, contexte());
    expect(r.paires.length).toBeGreaterThan(0);
    expect(r.paires.every((p) => p.parasites.length === 0)).toBe(true);
  });
});


describe('méthode de Tm', () => {
  const seq = sequence(1200, 77);

  it('la formule ajustée au sel ne retient pas les mêmes amorces', () => {
    const commun = {seq, ampliconMin: 150, ampliconMax: 500, maxPaires: 10};
    const ppv = balayageAmorces.executer({...commun, methodeTm: 'ppv' as const}, contexte());
    const sel = balayageAmorces.executer({...commun, methodeTm: 'sel' as const, naMM: 50}, contexte());
    expect(ppv.paires.length).toBeGreaterThan(0);
    expect(sel.paires.length).toBeGreaterThan(0);
    // Les Tm rendues sont bien celles de la méthode demandée.
    for (const p of sel.paires) {
      expect(p.avant.tm).toBeCloseTo(tmAjusteAuSel(p.avant.seq, 50) as number, 6);
    }
    for (const p of ppv.paires) {
      expect(p.avant.tm).toBeCloseTo(tmPcr(p.avant.seq) as number, 6);
    }
  });

  it('le sodium de la formule ajustée compte', () => {
    const commun = {seq, ampliconMin: 150, ampliconMax: 500, maxPaires: 10,
                    methodeTm: 'sel' as const};
    const bas = balayageAmorces.executer({...commun, naMM: 20}, contexte());
    const haut = balayageAmorces.executer({...commun, naMM: 200}, contexte());
    const premiere = (r: typeof bas) => r.paires[0]?.avant.seq ?? '';
    // À sodium différent, la fenêtre de Tm ne sélectionne pas les mêmes.
    expect(premiere(bas)).not.toBe(premiere(haut));
  });
});
