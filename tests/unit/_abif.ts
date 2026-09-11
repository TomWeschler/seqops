/** Fabrique un .ab1 minimal mais conforme, pour éprouver le lecteur sans
 *  dépendre d'un fichier binaire versionné — et pour pouvoir fabriquer des cas
 *  qu'aucun séquenceur ne produirait (fichier tronqué, en-tête faux).
 *
 *  Attention : un vrai .ab1 de séquenceur reste la seule preuve que le lecteur
 *  marche pour de bon. Voir docs/architecture.md, « Ce qui reste à éprouver ». */

export interface EntreeFabriquee {
  nom: string;
  numero: number;
  type: number;
  tailleElement: number;
  nombreElements: number;
  donnees: Uint8Array;
}

export function entreeChar(nom: string, numero: number, texte: string): EntreeFabriquee {
  const d = new Uint8Array(texte.length);
  for (let i = 0; i < texte.length; i++) d[i] = texte.charCodeAt(i);
  return {nom, numero, type: 2, tailleElement: 1, nombreElements: texte.length, donnees: d};
}

export function entreeOctets(nom: string, numero: number, valeurs: number[]): EntreeFabriquee {
  return {nom, numero, type: 1, tailleElement: 1, nombreElements: valeurs.length,
          donnees: Uint8Array.from(valeurs)};
}

export function entreeCourts(nom: string, numero: number, valeurs: number[]): EntreeFabriquee {
  const d = new Uint8Array(valeurs.length * 2);
  const v = new DataView(d.buffer);
  valeurs.forEach((x, i) => v.setInt16(i * 2, x));
  return {nom, numero, type: 4, tailleElement: 2, nombreElements: valeurs.length, donnees: d};
}

export function entreePString(nom: string, numero: number, texte: string): EntreeFabriquee {
  const d = new Uint8Array(texte.length + 1);
  d[0] = texte.length;
  for (let i = 0; i < texte.length; i++) d[i + 1] = texte.charCodeAt(i);
  return {nom, numero, type: 18, tailleElement: 1, nombreElements: d.length, donnees: d};
}

export function entreeDate(nom: string, numero: number, annee: number, mois: number, jour: number): EntreeFabriquee {
  const d = new Uint8Array(4);
  new DataView(d.buffer).setInt16(0, annee);
  d[2] = mois; d[3] = jour;
  return {nom, numero, type: 10, tailleElement: 2, nombreElements: 1, donnees: d};
}

export function fabriquerAbif(entrees: EntreeFabriquee[], version = 101): ArrayBuffer {
  const ENTETE = 128;
  const blocs: Uint8Array[] = [];
  let curseur = ENTETE;
  const places = entrees.map((e) => {
    const taille = e.donnees.length;
    if (taille <= 4) return {e, offset: null as number | null, taille};
    const offset = curseur;
    blocs.push(e.donnees);
    curseur += taille + (taille % 2);          // aligné sur deux octets
    return {e, offset, taille};
  });

  const debutAnnuaire = curseur;
  const total = debutAnnuaire + entrees.length * 28;
  const buf = new ArrayBuffer(total);
  const u8 = new Uint8Array(buf);
  const vue = new DataView(buf);

  const ecrireNom = (offset: number, nom: string) => {
    for (let i = 0; i < 4; i++) vue.setUint8(offset + i, nom.charCodeAt(i) || 32);
  };

  ecrireNom(0, 'ABIF');
  vue.setUint16(4, version);
  // L'entrée racine décrit l'annuaire lui-même.
  ecrireNom(6, 'tdir');
  vue.setInt32(10, 1);
  vue.setUint16(14, 1023);
  vue.setUint16(16, 28);
  vue.setInt32(18, entrees.length);
  vue.setInt32(22, entrees.length * 28);
  vue.setInt32(26, debutAnnuaire);

  let ecrit = ENTETE;
  for (const bloc of blocs) {
    u8.set(bloc, ecrit);
    ecrit += bloc.length + (bloc.length % 2);
  }

  places.forEach(({e, offset, taille}, i) => {
    const p = debutAnnuaire + i * 28;
    ecrireNom(p, e.nom);
    vue.setInt32(p + 4, e.numero);
    vue.setUint16(p + 8, e.type);
    vue.setUint16(p + 10, e.tailleElement);
    vue.setInt32(p + 12, e.nombreElements);
    vue.setInt32(p + 16, taille);
    if (offset === null) u8.set(e.donnees, p + 20);      // donnée courte, écrite sur place
    else vue.setInt32(p + 20, offset);
  });
  return buf;
}

/** Un chromatogramme jouet : la séquence donnée, un pic gaussien par base,
 *  des qualités choisies (médiocres aux extrémités par défaut). */
export function chromatogrammeJouet(bases: string, qualites?: number[]): ArrayBuffer {
  const pas = 12;
  const n = bases.length;
  const q = qualites ?? bases.split('').map((_, i) => (i < 15 || i > n - 15 ? 8 : 55));
  // Les pics d'un vrai séquenceur ne sont pas régulièrement espacés : sur le
  // fichier de référence qui a servi à éprouver tout ceci, l'écart va de 6 à 26
  // échantillons pour une moyenne de 13. Une fixture régulière laisserait
  // passer un défaut d'alignement que la réalité révélerait aussitôt.
  let graine = 12345;
  const pics = bases.split('').map((_, i) => {
    graine = (graine * 1103515245 + 12345) & 0x7fffffff;
    const jeu = i === 0 ? 0 : ((graine >>> 16) % 7) - 3;      // −3 à +3
    return 20 + i * pas + jeu;
  });
  const longueurTrace = 20 + n * pas + 20;
  const traces: Record<string, number[]> = {A: [], C: [], G: [], T: []};
  for (const b of ['A', 'C', 'G', 'T']) traces[b] = new Array(longueurTrace).fill(0);
  const poser = (trace: number[], centre: number, sommet: number, facteur: number) => {
    for (let d = -5; d <= 5; d++) {
      const x = centre + d;
      if (x >= 0 && x < longueurTrace) {
        trace[x] = Math.max(trace[x] ?? 0, Math.round(sommet * Math.exp(-(d * d) / 6) * facteur));
      }
    }
  };
  bases.split('').forEach((b, i) => {
    const centre = pics[i] as number;
    const facteur = (q[i] ?? 30) / 55;
    if (b === 'A' || b === 'C' || b === 'G' || b === 'T') {
      poser(traces[b] as number[], centre, 1000, facteur);
      return;
    }
    // Une base ambiguë, c'est deux pics de hauteur voisine : c'est exactement
    // ce que le séquenceur n'a pas su trancher, et ce que l'outil doit montrer
    // plutôt qu'un pic unique inventé.
    poser(traces['A'] as number[], centre, 1000, facteur);
    poser(traces['G'] as number[], centre, 850, facteur);
  });
  // FWO_ dit dans quel ordre les quatre traces sont rangées : ici G, A, T, C,
  // l'ordre habituel des séquenceurs — c'est justement ce qu'il ne faut pas
  // supposer identique à A, C, G, T.
  const ordre = 'GATC';
  return fabriquerAbif([
    entreeChar('FWO_', 1, ordre),
    entreeChar('PBAS', 1, bases),
    entreeOctets('PCON', 1, q),
    entreeCourts('PLOC', 1, pics),
    entreePString('SMPL', 1, 'échantillon-test'),
    entreePString('MODL', 1, '3730xl'),
    entreeDate('RUND', 1, 2026, 9, 10),
    ...ordre.split('').map((b, i) => entreeCourts('DATA', 9 + i, traces[b] as number[]))
  ]);
}
