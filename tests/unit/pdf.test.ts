import {execFileSync} from 'node:child_process';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {documentPdf} from '../../src/core/pdf.js';

const dossier = mkdtempSync(join(tmpdir(), 'pdf-'));

/** Aucune bibliothèque PDF n'est installée ici, et en installer une pour les
 *  épreuves reviendrait à faire confiance à ce qu'on veut vérifier. Le fichier
 *  est donc relu par un analyseur écrit à part, en Python, qui suit la
 *  structure du format : la table des décalages doit tomber sur les objets,
 *  chaque flux doit faire la longueur annoncée, et le texte doit s'y trouver.
 *  C'est exactement ce qu'un lecteur PDF vérifie avant d'afficher quoi que ce
 *  soit — un octet de trop dans un /Length et la page reste blanche. */
function analyser(octets: Uint8Array, nom: string): {
  objets: number; pages: number; decalagesJustes: boolean;
  fluxJustes: boolean; texte: string; finit: boolean;
} {
  const chemin = join(dossier, nom);
  writeFileSync(chemin, octets);
  const script = `
import json, re, sys
d = open(sys.argv[1], 'rb').read()
assert d.startswith(b'%PDF-1.'), 'pas un PDF'
depart = int(re.search(rb'startxref\\s+(\\d+)\\s+%%EOF', d).group(1))
table = d[depart:]
taille = int(re.search(rb'/Size (\\d+)', table).group(1))
lignes = re.findall(rb'(\\d{10}) (\\d{5}) ([nf])', table)
justes = True
for n, (decalage, _, genre) in enumerate(lignes):
    if genre == b'f':
        continue
    if not d[int(decalage):].startswith(b'%d 0 obj' % n):
        justes = False
flux_justes = True
for m in re.finditer(rb'<< /Length (\\d+) >>\\nstream\\n', d):
    longueur = int(m.group(1))
    debut = m.end()
    if d[debut + longueur:debut + longueur + 10] != b'\\nendstream':
        flux_justes = False
def decoder(brut):
    sortie = bytearray()
    i = 0
    while i < len(brut):
        c = brut[i:i + 1]
        if c == b'\\\\':
            suite = brut[i + 1:i + 2]
            if suite.isdigit():
                sortie.append(int(brut[i + 1:i + 4], 8)); i += 4; continue
            sortie += suite; i += 2; continue
        sortie += c; i += 1
    return sortie.decode('cp1252', 'replace')

texte = ' '.join(decoder(x) for x in re.findall(rb'\\(((?:\\\\.|[^()\\\\])*)\\) Tj', d, re.S))
print(json.dumps({
    'objets': taille,
    'pages': int(re.search(rb'/Count (\\d+)', d).group(1)),
    'decalagesJustes': justes,
    'fluxJustes': flux_justes,
    'texte': texte,
    'finit': d.rstrip().endswith(b'%%EOF')
}))
`;
  const sortie = execFileSync('python3', ['-c', script, chemin], {encoding: 'utf-8'});
  return JSON.parse(sortie) as ReturnType<typeof analyser>;
}

describe('document PDF', () => {
  it('produit un fichier dont la table des décalages tombe juste', () => {
    const lu = analyser(documentPdf('Amorces', [
      {texte: 'Amorces — cible.fas', style: 'titre'},
      {texte: 'paire1_F  ACGTACGTACGTACGTACGT', style: 'fixe'}
    ]), 'simple.pdf');
    // C'est cette table qui permet à un lecteur de trouver les objets : fausse,
    // le fichier s'ouvre sur une page blanche ou pas du tout.
    expect(lu.decalagesJustes).toBe(true);
    expect(lu.fluxJustes).toBe(true);
    expect(lu.finit).toBe(true);
    expect(lu.pages).toBe(1);
    // 1 catalogue + 1 arbre de pages + 3 polices + 1 page + 1 flux, plus
    // l'objet 0 que la table compte toujours.
    expect(lu.objets).toBe(8);
  });

  it('écrit le texte demandé, séquences comprises', () => {
    const lu = analyser(documentPdf('Amorces', [
      {texte: 'paire2_sonde', style: 'soustitre'},
      {texte: 'TTACGGGAACTCGACACACGAACTCCTT', style: 'fixe'}
    ]), 'texte.pdf');
    expect(lu.texte).toContain('paire2_sonde');
    expect(lu.texte).toContain('TTACGGGAACTCGACACACGAACTCCTT');
  });

  it('écrit les accents en WinAnsi et remplace ce qu’elle ne sait pas écrire', () => {
    const lu = analyser(documentPdf('Rapport', [
      {texte: 'Température de fusion : 60,3 °C — ΔTm 0,2 — amorce 5′-3′'}
    ]), 'accents.pdf');
    // é = 0xE9 et ° = 0xB0 en WinAnsi ; la prime, absente de cet encodage,
    // devient une apostrophe droite plutôt qu'un caractère manquant.
    expect(lu.texte).toContain('Température');
    expect(lu.texte).toContain('60,3 °C');
    expect(lu.texte).toContain("5'-3'");
    // Δ n'existe pas non plus en WinAnsi : il se dit, il ne se perd pas.
    expect(lu.texte).toContain('delta Tm');
    expect(lu.texte).not.toContain('?');
  });

  it('échappe les parenthèses, qui fermeraient la chaîne PDF', () => {
    const lu = analyser(documentPdf('Rapport', [
      {texte: 'Sonde (collée à F) \\ suite'}
    ]), 'parentheses.pdf');
    expect(lu.decalagesJustes).toBe(true);
    expect(lu.texte).toContain('collée à F');
  });

  it('passe à la page suivante quand la page est pleine, et les numérote', () => {
    const beaucoup = Array.from({length: 200}, (_, i) => ({texte: `ligne ${i}`, style: 'corps' as const}));
    const lu = analyser(documentPdf('Amorces', beaucoup), 'pages.pdf');
    expect(lu.pages).toBeGreaterThan(2);
    expect(lu.decalagesJustes).toBe(true);
    expect(lu.texte).toContain('page 1 sur');
    expect(lu.texte).toContain('ligne 199');
  });

  it('reste un PDF valide même sans une seule ligne', () => {
    const lu = analyser(documentPdf('Vide', []), 'vide.pdf');
    expect(lu.pages).toBe(1);
    expect(lu.decalagesJustes).toBe(true);
  });
});
