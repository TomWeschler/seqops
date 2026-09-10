/** Exécuteur distant — PAS ENCORE ACTIF, et volontairement.
 *
 *  La contrainte du projet est que les séquences ne quittent pas le poste :
 *  aucun exécuteur distant n'est donc branché, et la politique de sécurité du
 *  contenu (public/_headers) interdit techniquement tout appel sortant. Ce
 *  fichier fixe le protocole pour le jour où le laboratoire disposera de sa
 *  propre machine de calcul — un conteneur avec R/sangeranalyseR, primer3 et
 *  MAFFT, sur le réseau interne.
 *
 *  Protocole prévu (HTTP, sur une origine explicitement autorisée) :
 *    POST /taches            {calcul, params}      → 202 {id}
 *    GET  /taches/{id}                             → {etat, progression, resultat?}
 *    POST /taches/{id}/arret                       → 202
 *
 *  Ce qu'il faudra trancher AVANT de l'activer, et qui ne relève pas du code :
 *    — qui héberge la machine, et sous quelle validation informatique ;
 *    — ce qui est envoyé (une séquence consensus n'est pas un .ab1 brut) ;
 *    — la trace : qui a lancé quoi, sur quelles données, et quand.
 *  Voir docs/architecture.md, section « Niveau 2 ». */

export const PROTOCOLE_DISTANT = {
  creer: 'POST /taches',
  suivre: 'GET /taches/{id}',
  arreter: 'POST /taches/{id}/arret'
} as const;
