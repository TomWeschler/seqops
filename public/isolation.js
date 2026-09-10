/* Service worker : il ne met rien en cache, il ajoute des en-têtes.
 *
 * GitHub Pages sert des fichiers statiques et ne laisse pas choisir les
 * en-têtes de réponse. Or l'isolation d'origine (COOP + COEP) conditionne
 * SharedArrayBuffer, dont dépend l'arrêt propre d'un calcul long : sans elle,
 * arrêter un balayage d'amorces tue le travailleur et perd les paires déjà
 * trouvées. Un service worker peut réécrire les réponses avant qu'elles
 * n'atteignent la page : c'est ce qu'il fait ici, et rien d'autre.
 *
 * Il ne met RIEN en cache, volontairement. Un cache mal tenu, c'est une
 * application qui reste des mois en arrière sans que personne ne s'en aperçoive.
 * Ici, chaque requête part au réseau ; le service worker n'ajoute que trois
 * lignes d'en-tête au retour. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  // Une requête opaque ne se réécrit pas : on la laisse passer intacte.
  if (req.mode === 'no-cors' && new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((reponse) => {
        if (reponse.status === 0) return reponse;
        const entetes = new Headers(reponse.headers);
        entetes.set('Cross-Origin-Embedder-Policy', 'require-corp');
        entetes.set('Cross-Origin-Opener-Policy', 'same-origin');
        entetes.set('Cross-Origin-Resource-Policy', 'same-origin');
        return new Response(reponse.body, {
          status: reponse.status, statusText: reponse.statusText, headers: entetes
        });
      })
      // Hors ligne ou serveur muet : on rend l'échec tel quel, sans le déguiser.
      .catch((e) => { throw e; })
  );
});
