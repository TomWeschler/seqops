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

Une seule exception, et elle est dans les mains de l'opérateur : le bouton
« Vérifier sur NCBI » ouvre le formulaire blastn dans un autre onglet avec les
oligonucléotides sélectionnés. L'application ne joint jamais le NCBI elle-même
— elle prépare le FASTA, le clic ouvre l'onglet — et ce qui part, ce sont des
oligonucléotides de vingt bases, pas la séquence de l'échantillon. Le fichier
de résultats qui en revient (« Hit table » ou JSON) se réimporte dans l'outil :
il est relu dans le navigateur et rapproché des paires par le nom des requêtes,
que l'outil a lui-même écrit. Amorces, sonde, classeur Excel et FASTA portent
partout le même nom — `paire3_F`, `paire3_R`, `paire3_sonde`.

## Ce que ça fait aujourd'hui

| | |
|---|---|
| Lire un `.ab1` | Bases, qualités PHRED, pics, quatre traces, échantillon, appareil, date. Le chromatogramme est dessiné, zoomable, avec la qualité base par base. |
| Écrêter | Méthode de Mott modifiée (celle de phred et de sangeranalyseR) : les extrémités médiocres sont coupées, jamais cachées. |
| Lire et écrire un `.fas` | Plusieurs enregistrements, aller-retour sans perte, modification d'un segment, réécriture du fichier. |
| Corriger | Espaces, numérotation, casse, U d'ARN, lacunes, caractères invalides, et codes IUPAC ramenés à N par défaut — **chaque intervention est journalisée**, code d'origine compris. |
| Trancher les ambiguïtés | « Prochaine ambiguïté › » amène sur la position dans le chromatogramme, propose la base du pic dominant avec son rapport au second, et corrige base à base. |
| Analyser | Composition, GC, biais, GC glissant, Tm (Wallace, GC %, plus proche voisin SantaLucia 1998), masse, cadres ouverts, motifs IUPAC. |
| Chercher des amorces | Balayage exhaustif des couples possibles. Réglages par défaut du laboratoire : Tm 59–61 °C, 18–22 nt, amplicon 70–200 nt, 40–60 % GC. Règles de forme : pas plus de quatre fois la même base, pas plus de quatre G d'affilée (trois pour une sonde), fin 3′ en G ou C avec au plus trois G+C sur les cinq dernières, et auto-complémentarité contrôlée en paires de bases comme chez OligoCalc — les mêmes règles s'appliquent à la sonde, avec ses propres seuils, réglables dans sa section. |
| Chercher une sonde | Sonde d'hydrolyse (qPCR) entre les deux amorces : 69–71 °C, 18–32 nt, jamais de G en 5′, plus de C que de G, collée à F (brin +) ou à R (brin −). |
| Comprendre le classement | Le score de chaque paire s'explique au survol : une phrase par défaut mesuré, et ce qu'il coûte. Sa décomposition est produite par le calcul lui-même, pas reconstituée par l'affichage. |
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
