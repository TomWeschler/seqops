import {describe, expect, it} from 'vitest';
import {pisteAlignee, regle} from '../../src/core/alignement.js';
import {complementInverse} from '../../src/core/sequence.js';

//                   1        10        20        30
const REF = 'GGGACGTACGTTTTCCCAAAGGGTTTCCAATT';

const texte = (segments: ReturnType<typeof pisteAlignee>) => segments.map((s) => s.texte).join('');

describe('alignement des oligos sur la séquence', () => {
  it('pose chaque oligo à sa position, et la ligne a la longueur de la référence', () => {
    const lignes = pisteAlignee(REF, [
      {role: 'F', debut: 4, fin: 11, brin: '+', seq: 'ACGTACGT'}
    ]);
    const t = texte(lignes);
    expect(t).toHaveLength(REF.length);
    expect(t.slice(3, 11)).toBe('ACGTACGT');
    expect(t.slice(0, 3)).toBe('   ');
    expect(lignes.find((s) => s.role === 'F')?.ecart).toBe(false);
  });

  it('montre la Reverse par son complément inverse, lettre à lettre sous la référence', () => {
    // La Reverse se commande lue sur le brin − : sur le brin +, elle se lit
    // comme la référence elle-même entre ses deux bornes.
    const surReference = REF.slice(23, 31);            // positions 24..31
    const reverse = complementInverse(surReference);    // ce qu'on commande
    const t = texte(pisteAlignee(REF, [{role: 'R', debut: 24, fin: 31, brin: '−', seq: reverse}]));
    expect(t.slice(23, 31)).toBe(surReference);
  });

  it('distingue F, sonde et R dans des segments séparés', () => {
    const segments = pisteAlignee(REF, [
      {role: 'F', debut: 1, fin: 6, brin: '+', seq: REF.slice(0, 6)},
      {role: 'sonde', debut: 7, fin: 14, brin: '+', seq: REF.slice(6, 14)},
      {role: 'R', debut: 25, fin: 32, brin: '−', seq: complementInverse(REF.slice(24, 32))}
    ]);
    expect(segments.map((s) => s.role)).toEqual(['F', 'sonde', null, 'R']);
    expect(segments.every((s) => !s.ecart)).toBe(true);
  });

  it('signale ce qui ne correspond plus à la référence', () => {
    // Un oligo découpé dans une séquence qu'on a corrigée depuis.
    const segments = pisteAlignee(REF, [{role: 'F', debut: 4, fin: 11, brin: '+', seq: 'ACGTTCGT'}]);
    const ecarts = segments.filter((s) => s.ecart);
    expect(ecarts).toHaveLength(1);
    expect(ecarts[0]?.texte).toBe('T');
    expect(texte(segments)).toHaveLength(REF.length);
  });

  it('ne déborde pas d’une référence plus courte que prévu', () => {
    const t = texte(pisteAlignee('ACGT', [{role: 'F', debut: 3, fin: 8, brin: '+', seq: 'GTAAAA'}]));
    expect(t).toBe('  GT');
  });
});

describe('règle graduée', () => {
  it('numérote 1, 11, 21… au-dessus de la base numérotée', () => {
    const r = regle(32);
    expect(r).toHaveLength(32);
    expect(r[0]).toBe('1');
    expect(r.slice(10, 12)).toBe('11');
    expect(r.slice(20, 22)).toBe('21');
    expect(r.slice(30, 32)).toBe('31');
  });

  it('coupe une étiquette qui dépasserait la fin', () => {
    expect(regle(11)).toBe('1         1');
  });
});
