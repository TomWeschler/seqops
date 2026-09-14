import {describe, expect, it} from 'vitest';
import {ADRESSE_BLASTN, lienBlastn, oligosEnFasta} from '../../src/core/ncbi.js';

const paire = (n: number, sonde = true) => ({
  avant: {seq: 'ACGTACGTACGTACGTACGT', debut: n * 100, fin: n * 100 + 19},
  arriere: {seq: 'TTGCACCATTGCACCATTGC', debut: n * 100 + 150, fin: n * 100 + 169},
  sonde: sonde ? {seq: 'CCTCCTCCAAGATGTGGCAG', debut: n * 100 + 30, fin: n * 100 + 49} : undefined
});

describe('lien vers blastn du NCBI', () => {
  it('écrit un FASTA nommé par paire et par rôle', () => {
    const fasta = oligosEnFasta([paire(1), paire(2)], [0, 1]);
    expect(fasta).toContain('>paire1_F 100..119');
    expect(fasta).toContain('>paire1_R 250..269');
    expect(fasta).toContain('>paire1_sonde 130..149');
    expect(fasta).toContain('>paire2_F 200..219');
    expect(fasta).toContain('ACGTACGTACGTACGTACGT');
    // Trois oligonucléotides par paire quand il y a une sonde, deux sinon.
    expect(fasta.split('\n').filter((l) => l.startsWith('>'))).toHaveLength(6);
  });

  it('n’écrit rien pour une paire sans sonde, ni pour un rang inexistant', () => {
    const fasta = oligosEnFasta([paire(1, false)], [0, 7]);
    expect(fasta).not.toContain('sonde');
    expect(fasta.split('\n').filter((l) => l.startsWith('>'))).toHaveLength(2);
  });

  it('ne garde de la sélection que ce qui est coché, dans l’ordre demandé', () => {
    const fasta = oligosEnFasta([paire(1), paire(2), paire(3)], [2, 0]);
    const noms = fasta.split('\n').filter((l) => l.startsWith('>')).map((l) => l.split(' ')[0]);
    expect(noms).toEqual(['>paire3_F', '>paire3_R', '>paire3_sonde',
                          '>paire1_F', '>paire1_R', '>paire1_sonde']);
  });

  it('dépose la requête dans l’adresse sans toucher au reste du formulaire', () => {
    const fasta = oligosEnFasta([paire(1)], [0]);
    const {url, prerempli} = lienBlastn(fasta);
    expect(prerempli).toBe(true);
    // Les réglages de la page du NCBI sont laissés tels quels : on n'ajoute
    // que la requête, à la fin de l'adresse qu'un opérateur connaît.
    expect(url.startsWith(`${ADRESSE_BLASTN}&QUERY=`)).toBe(true);
    expect(url).not.toContain('DATABASE=');
    expect(url).not.toContain('MEGABLAST');
    // Le FASTA est retrouvable tel quel une fois l'adresse décodée.
    expect(decodeURIComponent(url.split('&QUERY=')[1] as string)).toBe(fasta.trim());
  });

  it('ouvre le formulaire nu plutôt qu’une adresse trop longue, qui serait tronquée', () => {
    const beaucoup = Array.from({length: 40}, (_, i) => paire(i + 1));
    const fasta = oligosEnFasta(beaucoup, beaucoup.map((_, i) => i));
    const {url, prerempli} = lienBlastn(fasta);
    expect(prerempli).toBe(false);
    expect(url).toBe(ADRESSE_BLASTN);
  });

  it('sur une sélection vide, ouvre le formulaire nu', () => {
    expect(lienBlastn('')).toEqual({url: ADRESSE_BLASTN, prerempli: false});
  });
});
