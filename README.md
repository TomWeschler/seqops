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
| Corriger | Espaces, numérotation, casse, U d'ARN, lacunes, codes IUPAC, caractères invalides — **chaque intervention est journalisée**. |
| Analyser | Composition, GC, biais, GC glissant, Tm (Wallace, GC %, plus proche voisin SantaLucia 1998), masse, cadres ouverts, motifs IUPAC. |
| Chercher des amorces | Balayage exhaustif des couples possibles, avec Tm, GC, pince GC en 3', répétitions et dimères. Long, interruptible, rend un résultat partiel. |
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

Cloudflare, gratuit, dépôt privé accepté : `npx wrangler login` puis
`npm run deploiement`, ou par le tableau de bord — les deux voies sont décrites
dans [`docs/exploitation.md`](docs/exploitation.md).
GitHub Pages n'est pas utilisable ici : sur un dépôt privé, il exige un compte
payant.

## Ce projet doit sortir du dépôt où il est né

Il vit provisoirement dans `seqops/` du dépôt `kanban`. La marche à suivre pour
lui donner son propre dépôt privé, historique compris, est dans
[`docs/nouveau-depot.md`](docs/nouveau-depot.md) — c'est la prochaine chose à
faire.

## Licence

MIT. Les moteurs tiers envisagés ont leurs propres licences, examinées dans
`docs/architecture.md`.
