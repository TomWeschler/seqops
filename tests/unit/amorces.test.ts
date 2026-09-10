import {describe, expect, it} from 'vitest';
import {balayageAmorces} from '../../src/calculs/amorces.js';
import type {Contexte} from '../../src/calculs/types.js';
import {complementInverse, tmPlusProcheVoisin} from '../../src/core/sequence.js';

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
      expect(p.avant.tm).toBeCloseTo(tmPlusProcheVoisin(p.avant.seq) as number, 6);
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
