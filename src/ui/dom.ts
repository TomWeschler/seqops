/** Le strict nécessaire pour fabriquer du DOM sans bibliothèque. */

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, racine: ParentNode = document): T => {
  const e = racine.querySelector<T>(sel);
  if (!e) throw new Error(`Élément introuvable : ${sel}`);
  return e;
};

export const ech = (s: unknown): string =>
  String(s).replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c] as string));

export const nb = (v: number, d = 0): string =>
  Number(v).toLocaleString('fr-FR', {minimumFractionDigits: d, maximumFractionDigits: d});

export function telecharger(nom: string, contenu: string | Blob, type = 'text/plain;charset=utf-8'): void {
  const blob = contenu instanceof Blob ? contenu : new Blob([contenu], {type});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nom;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Nom de fichier sûr : ni chemin, ni caractère interdit sous Windows. */
export function nomSur(base: string, suffixe: string): string {
  const propre = base.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
  return (propre || 'seqops') + suffixe;
}
