/** Le nom d'un oligonucléotide, écrit une fois pour toutes.
 *
 *  Le même oligonucléotide apparaît dans le tableau des résultats, dans le
 *  classeur Excel, dans le FASTA envoyé au NCBI et dans le fichier de
 *  résultats qui en revient. S'il ne porte pas le même nom partout, le
 *  rapprochement se fait à l'œil, et à l'œil on se trompe de ligne.
 *
 *  Le nom ne contient volontairement pas celui du fichier : il part sur un
 *  site tiers, et un nom de fichier de séquençage porte souvent un numéro
 *  d'échantillon. Le fichier a sa propre colonne dans le classeur. */

export type RoleOligo = 'F' | 'R' | 'sonde';

/** `paire3_F` : le rang de la paire tel qu'il est affiché (1 pour la première),
 *  puis le rôle. */
export function nomOligo(rangPaire: number, role: RoleOligo): string {
  return `paire${rangPaire}_${role}`;
}

/** L'inverse, tolérant : le NCBI recopie le nom au milieu d'une ligne plus
 *  longue (« lcl|Query_276888 paire1_F 3825..3846 »), parfois avec une casse
 *  différente. On retrouve le nom partout où il se cache. */
export function lireNomOligo(texte: string): {rangPaire: number; role: RoleOligo} | null {
  const m = /paire(\d+)_(F|R|sonde)\b/i.exec(String(texte ?? ''));
  if (!m) return null;
  const rangPaire = Number(m[1]);
  if (!Number.isFinite(rangPaire) || rangPaire < 1) return null;
  const brut = (m[2] as string).toLowerCase();
  const role: RoleOligo = brut === 'f' ? 'F' : brut === 'r' ? 'R' : 'sonde';
  return {rangPaire, role};
}
