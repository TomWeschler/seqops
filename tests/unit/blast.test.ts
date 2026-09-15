import {describe, expect, it} from 'vitest';
import {lireResultatsBlast, sitesComplets} from '../../src/core/blast.js';
import {lireNomOligo, nomOligo} from '../../src/core/nomenclature.js';

/** Un extrait fidèle du « Hit table (text) » du NCBI : des commentaires qui
 *  portent le nom complet de la requête, puis des lignes à douze colonnes
 *  séparées par des tabulations. */
const HIT_TABLE_TEXTE = `# blastn
# Iteration: 0
# Query: lcl|Query_276888 paire1_F 3825..3846
# Database: nt
# 0 hits found
# blastn
# Query: lcl|Query_276890 paire1_sonde 3847..3871
# Fields: query acc.ver, subject acc.ver, % identity, alignment length, mismatches, gap opens, q. start, q. end, s. start, s. end, evalue, bit score
# 2 hits found
Query_276890\tNG_012246.1\t100.000\t25\t0\t0\t1\t25\t14920\t14944\t2.3e-05\t50.1
Query_276890\tXM_014916024.2\t100.000\t18\t0\t0\t1\t18\t433\t450\t433\t32.2
`;

/** Le même contenu en CSV : pas de commentaires, et la colonne de requête ne
 *  porte que l'identifiant fabriqué par le NCBI. */
const HIT_TABLE_CSV =
  'Query_276890,NG_012246.1,100.000,25,0,0,1,25,14920,14944,2.3e-05,50.1\n';

const CSV_NOMME =
  'paire2_R,NG_012246.1,100.000,22,0,0,1,22,15100,15121,1e-06,44.1\n' +
  'paire2_R,AC122251.4,95.000,20,1,0,1,20,5,24,3.0,30.2\n';

const JSON_NCBI = JSON.stringify({
  BlastOutput2: [
    {report: {results: {search: {
      query_id: 'Query_1', query_title: 'paire1_F 3825..3846', hits: []
    }}}},
    {report: {results: {search: {
      query_id: 'Query_2', query_title: 'paire1_sonde 3847..3871',
      hits: [{
        description: [{accession: 'NG_012246.1', title: 'Homo sapiens NAT2', sciname: 'Homo sapiens'}],
        hsps: [{identity: 25, align_len: 25, evalue: 0.000023}]
      }, {
        description: [{accession: 'XM_014916024.2', title: 'Octopus zinc finger', sciname: 'Octopus bimaculoides'}],
        hsps: [{identity: 17, align_len: 18, evalue: 433}]
      }]
    }}}}
  ]
});

describe('nom d’oligonucléotide', () => {
  it('s’écrit et se relit, où qu’il se cache', () => {
    expect(nomOligo(3, 'sonde')).toBe('paire3_sonde');
    // Tel que le NCBI le recrache, noyé dans son propre identifiant.
    expect(lireNomOligo('lcl|Query_276888 paire1_F 3825..3846(22bp)'))
      .toEqual({rangPaire: 1, role: 'F'});
    expect(lireNomOligo('PAIRE12_SONDE')).toEqual({rangPaire: 12, role: 'sonde'});
    expect(lireNomOligo('Query_276888')).toBeNull();
    expect(lireNomOligo('')).toBeNull();
  });
});

describe('relecture des résultats BLAST', () => {
  it('rattache les lignes au nom porté par le commentaire « # Query »', () => {
    const r = lireResultatsBlast(HIT_TABLE_TEXTE);
    expect(r.format).toBe('tabulaire');
    // Les deux requêtes sont connues, y compris celle qui n'a aucun site :
    // « aucun résultat » est une information, pas une absence d'information.
    expect([...r.parOligo.keys()]).toEqual(['paire1_F', 'paire1_sonde']);
    expect(r.parOligo.get('paire1_F')?.sites).toEqual([]);
    const sonde = r.parOligo.get('paire1_sonde');
    expect(sonde?.sites).toHaveLength(2);
    expect(sonde?.sites[0]?.sujet).toBe('NG_012246.1');
    expect(sonde?.sites[0]?.longueur).toBe(25);
    expect(sonde?.sites[1]?.evalue).toBe(433);
    expect(r.sansNom).toBe(0);
  });

  it('compte à part ce qu’il ne peut rattacher, plutôt que de le deviner', () => {
    const r = lireResultatsBlast(HIT_TABLE_CSV);
    expect(r.parOligo.size).toBe(0);
    expect(r.sansNom).toBe(1);
  });

  it('lit le CSV quand la colonne porte le nom', () => {
    const r = lireResultatsBlast(CSV_NOMME);
    expect(r.parOligo.get('paire2_R')?.sites).toHaveLength(2);
    expect(r.sansNom).toBe(0);
  });

  it('lit le JSON, avec les organismes qu’il est seul à donner', () => {
    const r = lireResultatsBlast(JSON_NCBI);
    expect(r.format).toBe('json');
    expect(r.parOligo.get('paire1_F')?.sites).toEqual([]);
    const sites = r.parOligo.get('paire1_sonde')?.sites ?? [];
    expect(sites).toHaveLength(2);
    expect(sites[0]?.organisme).toBe('Homo sapiens');
    expect(sites[0]?.identite).toBe(100);
    // 17 identités sur 18 bases : un mésappariement, et 94,4 % d'identité.
    expect(sites[1]?.mesappariements).toBe(1);
    expect(sites[1]?.identite).toBeCloseTo(94.4, 1);
  });

  it('ne s’effondre pas sur un fichier vide, ni sur un JSON abîmé', () => {
    expect(lireResultatsBlast('').parOligo.size).toBe(0);
    expect(lireResultatsBlast('{ ceci n’est pas du JSON').parOligo.size).toBe(0);
  });

  it('ne retient comme site complet que ce qui couvre tout l’oligonucléotide', () => {
    const r = lireResultatsBlast(JSON_NCBI);
    const sonde = r.parOligo.get('paire1_sonde');
    // La sonde fait 25 nt : l'alignement de 18 bases sur la pieuvre n'amorce
    // rien et ne doit pas être compté comme un site.
    expect(sitesComplets(sonde!, 25)).toHaveLength(1);
    expect(sitesComplets(sonde!, 25)[0]?.sujet).toBe('NG_012246.1');
    // Et un mésappariement de trop l'écarte aussi.
    expect(sitesComplets(sonde!, 25, 0)).toHaveLength(1);
  });
});
