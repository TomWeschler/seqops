/** Rétablir l'isolation d'origine là où l'hébergeur ne pose pas les en-têtes.
 *
 *  GitHub Pages ne permet pas de choisir les en-têtes de réponse. Le service
 *  worker de `public/isolation.js` les ajoute lui-même ; il faut alors un
 *  rechargement pour que la page soit servie à travers lui. Un seul, tracé dans
 *  sessionStorage : une page qui se recharge en boucle est pire que pas d'isolation.
 *
 *  Si rien n'y fait (navigateur sans service worker, page ouverte en file://,
 *  politique d'entreprise), l'application fonctionne quand même : seul l'arrêt
 *  d'un calcul long perd ses résultats partiels, et le pied de page le dit. */

const CLE = 'seqops:isolation-rechargee';

export async function assurerIsolation(): Promise<'native' | 'service-worker' | 'absente'> {
  if (globalThis.crossOriginIsolated) {
    return sessionStorage.getItem(CLE) === '1' ? 'service-worker' : 'native';
  }
  if (!('serviceWorker' in navigator) || !globalThis.isSecureContext) return 'absente';

  try {
    await navigator.serviceWorker.register(new URL('isolation.js', document.baseURI), {scope: './'});
    await navigator.serviceWorker.ready;
  } catch {
    return 'absente';
  }
  if (sessionStorage.getItem(CLE) === '1') return 'absente';   // déjà essayé, sans effet
  sessionStorage.setItem(CLE, '1');
  location.reload();
  return 'absente';
}
