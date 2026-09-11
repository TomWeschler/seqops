# seqops

Correction, analyse et design d'amorces sur séquences ADN — **entièrement dans
le navigateur**. On y ouvre des chromatogrammes `.ab1` et des fichiers `.fas`,
on corrige, on analyse, on cherche des amorces, on exporte un rapport ou le
`.fas` modifié.

Contrainte fondatrice, dont tout le reste découle : **aucune séquence ne quitte
le poste**. Il n'y a pas de serveur d'application, pas d'appel sortant, et la
politique de sécurité du contenu (`public/_headers`) l'interdit techniquement.
Ce n'est pas une limite en attendant mieux, c'est la fonctionnalité principale
sur un poste d'entreprise.

## Ce que ça fait aujourd'hui

| | |
|---|---|
| Lire un `.ab1` | Bases, qualités PHRED, pics, quatre traces, échantillon, appareil, date. Le chromatogramme est dessiné, zoomable, avec la qualité base par base. |
| Écrêter | Méthode de Mott modifiée (celle de phred et de sangeranalyseR) : les extrémités médiocres sont coupées, jamais cachées. |
| Lire et écrire un `.fas` | Plusieurs enregistrements, aller-retour sans perte, modification d'un segment, réécriture du fichier. |
| Corriger | Espaces, numérotation, casse, U d'ARN, lacunes, caractères invalides, et codes IUPAC ramenés à N par défaut — **chaque intervention est journalisée**, code d'origine compris. |
| Trancher les ambiguïtés | « Prochaine ambiguïté › » amène sur la position dans le chromatogramme, propose la base du pic dominant avec son rapport au second, et corrige base à base. |
| Analyser | Composition, GC, biais, GC glissant, Tm (Wallace, GC %, plus proche voisin SantaLucia 1998), masse, cadres ouverts, motifs IUPAC. |
| Chercher des amorces | Balayage exhaustif des couples possibles, avec Tm, GC, pince GC en 3', répétitions et dimères. Long, interruptible, rend un résultat partiel. |
| Chercher une sonde | Sonde d'hydrolyse (qPCR) entre les deux amorces : Tm et longueur réglables, jamais de G en 5', brin le plus riche en C, collée à F ou à R (écart réglable). |
| Vérifier la spécificité | Sites d'hybridation de chaque amorce sur la cible **et sur tous les autres fichiers ouverts** (paralogue, vecteur), et détection des produits parasites — la deuxième bande du gel. |
| Calculer juste | Tm dans les conditions réelles de la réaction (K⁺, Mg²⁺, dNTP, amorce) et non à 50 mM de sodium ; épingles et dimères évalués en ΔG. |
| Débusquer les hétérozygotes | Positions à deux pics que l'appel de bases a tranchées sans le dire, cherchées dans la zone exploitable, avec le code IUPAC proposé. |
| Exporter | Rapport texte (cahier de manip, dépôt git) et rapport HTML autonome (envoi, impression), `.fas` corrigé. |

## Démarrer

```bash
npm ci
npm run dev        # http://localhost:5173
npm run tout       # types, épreuves unitaires, construction, épreuves de bout en bout
```

Les épreuves de bout en bout utilisent le navigateur de la machine :
`PW_CHROME=/chemin/vers/chrome npm run e2e`.

## Structure

```
src/core/       lecture .ab1, lecture/écriture .fas, opérations de séquence, rapports
src/calculs/    les calculs, purs et sans DOM, avec leur registre
src/jobs/       le contrat des tâches et l'exécuteur local (travailleurs du navigateur)
src/ui/         l'application : fichiers, chromatogramme, séquence, tâches
tests/unit/     épreuves des fonctions (vitest) — dont un fabricant de .ab1 de synthèse
tests/e2e/      le parcours réel dans un vrai navigateur (playwright)
docs/           architecture, décisions, exploitation
```

## Déploiement

GitHub Pages, publié par l'intégration continue à chaque poussée sur `main` qui
passe les épreuves. GitHub Pages ne servant pas d'en-têtes choisis, la politique
de sécurité passe par une balise `<meta>` et l'isolation d'origine par un
service worker qui ne met rien en cache — les deux sont éprouvés
automatiquement. Voir [`docs/exploitation.md`](docs/exploitation.md).

## Licence

MIT. Les moteurs tiers envisagés ont leurs propres licences, examinées dans
`docs/architecture.md`.
