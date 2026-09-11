/** Thermodynamique des oligonucléotides : Tm dans les conditions d'une PCR, et
 *  stabilité des structures que les amorces forment entre elles ou sur
 *  elles-mêmes.
 *
 *  Deux manques réparés ici, qui faisaient dire à l'outil des chiffres justes
 *  pour une expérience que personne ne fait :
 *
 *  1. LES SELS. Une Tm calculée à 50 mM Na⁺ ne décrit pas une PCR, qui tourne
 *     à ~50 mM K⁺ ET 1,5 à 3 mM Mg²⁺. Le magnésium libre stabilise fortement le
 *     duplex ; l'ignorer sous-estime la Tm de plusieurs degrés. On convertit
 *     tous les ions en équivalent sodium (von Ahsen 2001) :
 *         [Na]eq = [Na⁺] + [K⁺] + [Tris]/2 + 120 × √([Mg²⁺] − [dNTP])
 *     Les dNTP chélatent le magnésium : c'est le magnésium LIBRE qui compte, et
 *     s'il n'en reste pas, le terme disparaît.
 *
 *  2. LES STRUCTURES. Compter la plus longue complémentarité, comme le faisait
 *     la première version, ne dit pas si une structure tient à 60 °C. Un ΔG le
 *     dit. On somme les empilements plus proches voisins des segments appariés
 *     — approximation assumée : les mésappariements internes ne reçoivent pas
 *     de pénalité, ils coupent simplement le segment.
 *
 *  Les paramètres d'empilement sont ceux de SantaLucia 1998 (unifiés), ΔH en
 *  kcal/mol et ΔS en cal/(mol·K) ; le ΔG à 37 °C en est déduit plutôt que
 *  tabulé à part, pour qu'il n'existe qu'une seule source de vérité. */

import {complementInverse} from './sequence.js';

/** ΔH, ΔS des seize empilements. */
const EMPILEMENTS: Record<string, readonly [number, number]> = {
  AA: [-7.9, -22.2], TT: [-7.9, -22.2], AT: [-7.2, -20.4], TA: [-7.2, -21.3],
  CA: [-8.5, -22.7], TG: [-8.5, -22.7], GT: [-8.4, -22.4], AC: [-8.4, -22.4],
  CT: [-7.8, -21.0], AG: [-7.8, -21.0], GA: [-8.2, -22.2], TC: [-8.2, -22.2],
  CG: [-10.6, -27.2], GC: [-9.8, -24.4], GG: [-8.0, -19.9], CC: [-8.0, -19.9]
};
const INIT_GC: readonly [number, number] = [0.1, -2.8];
const INIT_AT: readonly [number, number] = [2.3, 4.1];
const R = 1.987;                 // cal/(mol·K)
const T37 = 310.15;              // K

export interface Conditions {
  /** Concentration d'oligonucléotide, en nM. */
  oligoNM?: number;
  /** Sodium, en mM. */
  naMM?: number;
  /** Potassium, en mM — le sel dominant d'un tampon de PCR. */
  kMM?: number;
  /** Tris, en mM. */
  trisMM?: number;
  /** Magnésium total, en mM. */
  mgMM?: number;
  /** Somme des quatre dNTP, en mM. */
  dntpMM?: number;
}

export const CONDITIONS_PCR: Required<Conditions> = {
  oligoNM: 500, naMM: 0, kMM: 50, trisMM: 10, mgMM: 1.5, dntpMM: 0.8
};

/** Tous les ions ramenés à un équivalent sodium, en mol/L (von Ahsen 2001). */
export function equivalentSodium(c: Conditions = {}): number {
  const o = {...CONDITIONS_PCR, ...c};
  const monovalents = o.naMM + o.kMM + o.trisMM / 2;
  const mgLibre = o.mgMM - o.dntpMM;
  const apport = mgLibre > 0 ? 120 * Math.sqrt(mgLibre) : 0;
  return Math.max(1e-4, (monovalents + apport) / 1000);
}

export interface Empilement {
  dH: number;
  dS: number;
}

/** ΔH et ΔS d'un duplex parfaitement apparié. */
export function duplexParfait(seq: string): Empilement | null {
  if (!/^[ACGT]{2,}$/.test(seq)) return null;
  let dH = 0, dS = 0;
  for (let i = 0; i < seq.length - 1; i++) {
    const p = EMPILEMENTS[seq.substr(i, 2)];
    if (!p) return null;
    dH += p[0]; dS += p[1];
  }
  for (const bout of [seq[0] as string, seq[seq.length - 1] as string]) {
    const init = bout === 'G' || bout === 'C' ? INIT_GC : INIT_AT;
    dH += init[0]; dS += init[1];
  }
  return {dH, dS};
}

/** Tm d'un oligonucléotide dans des conditions de PCR données, en °C.
 *  Rend null hors du domaine du calcul plutôt qu'un chiffre faux. */
export function tm(seq: string, conditions: Conditions = {}): number | null {
  if (seq.length < 8) return null;
  const duplex = duplexParfait(seq);
  if (!duplex) return null;
  const o = {...CONDITIONS_PCR, ...conditions};
  const CT = o.oligoNM * 1e-9;
  const na = equivalentSodium(o);
  const autoComplementaire = seq === complementInverse(seq);
  // Correction saline de SantaLucia, appliquée à l'équivalent sodium.
  const dS = duplex.dS + 0.368 * (seq.length - 1) * Math.log(na);
  const valeur = (duplex.dH * 1000) / (dS + R * Math.log(autoComplementaire ? CT : CT / 4)) - 273.15;
  return Number.isFinite(valeur) ? valeur : null;
}

/** ΔG à 37 °C d'un duplex parfait, en kcal/mol. */
export function dg37(seq: string): number | null {
  const d = duplexParfait(seq);
  return d ? d.dH - (T37 * d.dS) / 1000 : null;
}

export interface Structure {
  /** ΔG en kcal/mol : plus il est négatif, plus la structure tient. */
  readonly dg: number;
  /** Nombre de bases appariées dans le meilleur segment. */
  readonly apparie: number;
  /** Vrai quand l'appariement touche les cinq dernières bases en 3' — c'est
   *  celui-là qui amorce une élongation parasite. */
  readonly touche3: boolean;
  /** Représentation lisible des deux brins face à face. */
  readonly schema: string;
}

const NULLE: Structure = {dg: 0, apparie: 0, touche3: false, schema: ''};

/** ΔG du meilleur appariement entre deux oligonucléotides, tous décalages
 *  essayés. `a` est lu 5'→3' ; on l'oppose au complément inverse de `b`. */
export function dimere(a: string, b: string): Structure {
  if (!/^[ACGT]+$/.test(a) || !/^[ACGT]+$/.test(b)) return NULLE;
  const face = complementInverse(b);          // aligné 5'→3' avec a
  let meilleure = NULLE;

  for (let decalage = -(face.length - 1); decalage < a.length; decalage++) {
    // Segments appariés contigus dans ce décalage.
    let debut = -1;
    for (let i = 0; i <= a.length; i++) {
      const j = i - decalage;
      const apparie = i < a.length && j >= 0 && j < face.length && a[i] === face[j];
      if (apparie && debut === -1) debut = i;
      if (!apparie && debut !== -1) {
        const segment = a.slice(debut, i);
        const g = segment.length >= 2 ? dg37(segment) : null;
        if (g !== null && g < meilleure.dg) {
          const touche3 = i >= a.length - 4;
          meilleure = {
            dg: g, apparie: segment.length, touche3,
            schema: `5'-${a.slice(0, debut)}[${segment}]${a.slice(i)}-3'`
          };
        }
        debut = -1;
      }
    }
  }
  return meilleure;
}

/** ΔG de la meilleure épingle à cheveux : une tige appariée refermée sur une
 *  boucle d'au moins trois bases. La pénalité de boucle est celle, classique,
 *  de Jaeger — approchée par un logarithme au-delà de trente bases. */
export function epingle(seq: string, boucleMin = 3): Structure {
  if (!/^[ACGT]{6,}$/.test(seq)) return NULLE;
  const PENALITE: Record<number, number> = {
    3: 5.4, 4: 5.6, 5: 5.7, 6: 5.4, 7: 6.0, 8: 5.5, 9: 6.4, 10: 6.5,
    12: 6.7, 14: 6.9, 16: 7.1, 18: 7.3, 20: 7.5, 25: 7.9, 30: 8.2
  };
  const penalite = (n: number): number => {
    if (PENALITE[n] !== undefined) return PENALITE[n] as number;
    const cles = Object.keys(PENALITE).map(Number).sort((x, y) => x - y);
    const dernier = cles[cles.length - 1] as number;
    if (n > dernier) return (PENALITE[dernier] as number) + 1.75 * R * T37 * Math.log(n / dernier) / 1000;
    const plusProche = cles.reduce((m, c) => (Math.abs(c - n) < Math.abs(m - n) ? c : m), cles[0] as number);
    return PENALITE[plusProche] as number;
  };

  let meilleure = NULLE;
  for (let i = 0; i < seq.length; i++) {
    for (let j = i + boucleMin + 1; j < seq.length; j++) {
      // Tige : seq[i..] apparié à seq[..j] en remontant.
      let taille = 0;
      while (i + taille < j - taille &&
             j - taille < seq.length &&
             seq[i + taille] === complementInverse(seq[j - taille] as string) &&
             j - taille - (i + taille) - 1 >= boucleMin) {
        taille++;
      }
      if (taille < 3) continue;
      const tige = seq.slice(i, i + taille);
      const g = dg37(tige);
      if (g === null) continue;
      const boucle = j - taille - (i + taille) + 1;
      const total = g + penalite(Math.max(boucleMin, boucle));
      if (total < meilleure.dg) {
        meilleure = {
          dg: total, apparie: taille, touche3: j >= seq.length - 4,
          schema: `tige ${taille} pb, boucle ${boucle} nt`
        };
      }
    }
  }
  return meilleure;
}
