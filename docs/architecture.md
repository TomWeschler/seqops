# Architecture

## Les contraintes, et ce qu'elles imposent

| Contrainte | Conséquence retenue |
|---|---|
| Hébergement gratuit | Site statique sur GitHub Pages, dépôt public. Pages ne servant pas d'en-têtes choisis, la CSP passe en balise `<meta>` et l'isolation d'origine par un service worker sans cache — chacun éprouvé. |
| Utilisable sur un PC d'entreprise | Rien à installer, rien à administrer : un onglet. Pas de police ni de script tiers, donc rien à débloquer chez l'informatique. |
| Les séquences ne sortent pas du poste | Aucun serveur d'application. Tout le calcul est fait par le navigateur, dans des travailleurs. La politique de sécurité du contenu interdit toute connexion sortante. |
| Ouvrir `.ab1` et `.fas`, modifier, exporter | Lecture ABIF en TypeScript, lecture/écriture FASTA, rapports texte et HTML. Le fichier d'origine n'est jamais réécrit sur place : l'utilisateur enregistre une copie. |
| Analyses longues | Un contrat de tâches (`src/jobs/types.ts`) : lancement non bloquant, avancement, arrêt, résultat partiel. Un seul exécuteur aujourd'hui, local. |
| Code sous git | Dépôt privé, épreuves automatiques, déploiement continu depuis la branche principale. |

## Décision : 100 % dans le navigateur, et ce qui ferait changer d'avis

Le choix est assumé, pas subi : **tant que le navigateur suffit, il n'y a pas
de serveur**. Un serveur, c'est une machine à faire valider, à tenir à jour, à
surveiller, et un endroit de plus où des séquences peuvent traîner. Le jour où
il faudra le faire, on le fera — le contrat de tâches est là pour que ce jour-là
ne soit pas une réécriture.

Ce que le navigateur avale vraiment, mesuré sur le balayage exhaustif d'amorces
(machine de développement, un seul fil, amplicon 150–800 nt) :

| Séquence | Durée | Couples examinés |
|---|---|---|
| 1 kb | 2,5 s | 778 000 |
| 5 kb | 25 s | 8,2 millions |
| 20 kb | 1 min 41 | 33 millions |
| 50 kb | 4 min 08 | 81 millions |

Une lecture Sanger fait 500 à 1 000 bases, un plasmide 3 à 10 kb : on est très
loin du plafond, et la tâche est interruptible avec résultat partiel. Le coût
tient au calcul de dimères, pas à la taille : un moteur compilé (primer3 en
WebAssembly) ferait mieux et plus juste, dans le même onglet.

Les trois signaux qui justifieraient un niveau 2 — aucun n'est atteint :

1. **Un calcul impossible dans un onglet.** BLAST contre une base publique
   entière, alignement de centaines de lectures : ce n'est pas une question de
   patience, les données de référence ne tiennent pas sur le poste.
2. **Un besoin de réseau.** Le pipeline de spécificité de PrimeSpecPCR interroge
   le NCBI. C'est incompatible avec « rien ne sort du poste » pour des séquences
   d'échantillons ; ça ne l'est pas pour des séquences publiques — mais c'est
   alors une décision explicite, prise par l'entreprise, pas un effet de bord.
3. **Un calcul qui dépasse la patience de l'opérateur** malgré l'optimisation et
   les travailleurs multiples (le balayage se découpe par tranches de séquence :
   quatre fils, quatre fois moins d'attente, si le besoin s'en fait sentir).

Avant d'ouvrir un serveur, on épuise donc trois cartouches : mieux compiler
(WebAssembly), paralléliser (plusieurs travailleurs), et réduire le problème
(pré-filtrer les candidats). Elles sont moins coûteuses que la première réunion
avec l'informatique.

## Deux niveaux, un seul contrat

```
┌──────────────────────────── le navigateur ────────────────────────────┐
│  interface ──► Executeur ──► travailleur ──► calculs ──► core         │
│                    ▲                                                  │
│                    │ même interface                                   │
│  ┌─────────────────┴──────────────────────────────────────────────┐   │
│  │ NIVEAU 2 (pas branché) : ExecuteurDistant ──► machine du labo  │   │
│  │  R/sangeranalyseR · primer3 · MAFFT, en conteneur, réseau      │   │
│  │  interne, sous validation informatique                         │   │
│  └────────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────────┘
```

Le **niveau 1** est ce qui existe, et c'est le seul qui tourne : tout dans le
navigateur. Un balayage exhaustif d'amorces sur quelques kilobases y tient
largement (voir les mesures ci-dessus) ; c'est le cas d'usage « tester tous les
couples possibles et garder les meilleurs ».

Le **niveau 2** est prévu, pas installé (`src/jobs/executeur-distant.ts` fixe le
protocole). Il ne servira qu'aux calculs qu'un onglet ne peut pas faire : BLAST
sur une base entière, alignement de centaines de lectures, appel de consensus
sur un projet complet. Le brancher est un choix d'entreprise avant d'être un
choix technique : il faudra dire qui héberge la machine, ce qu'on lui envoie
(une séquence consensus n'est pas un `.ab1` brut), et qui garde la trace.

## Pourquoi un contrat de tâches plutôt que des appels directs

Un calcul long lancé dans le fil de la page gèle l'onglet, ne peut pas être
arrêté et ne dit rien de son avancement. Le contrat impose les quatre choses
qui manquent : lancer sans bloquer, rendre compte, arrêter, et **rendre ce qui
a déjà été trouvé** quand on arrête. C'est cette dernière qui compte le plus
pour un balayage exhaustif : arrêté à 60 %, il a déjà de bonnes paires.

L'arrêt propre exige un drapeau en mémoire partagée (`SharedArrayBuffer`), donc
l'isolation d'origine, donc les en-têtes COOP/COEP — posés par le service worker
`public/isolation.js` là où l'hébergeur ne les sert pas (`public/_headers` reste
la référence de ce qu'il imite) — un
calcul enfermé dans une boucle synchrone ne lit pas ses messages, mais il peut
lire un entier. Sans ces en-têtes (par exemple en développement), l'arrêt
supprime le travailleur : net, mais sans résultat partiel. L'application dit
lequel des deux régimes est actif, en pied de page.

## Les moteurs open source, et ce qu'on en fera

Aucun n'est utilisable tel quel dans un navigateur : ce sont des programmes R,
Python et C. Trois voies, dans l'ordre de préférence.

1. **Réimplémenter ce qui est court et bien spécifié.** L'écrêtage de Mott, les
   Tm, la composition, le balayage d'amorces : c'est fait, c'est éprouvé, et ça
   ne coûte aucune dépendance. C'est le bon choix tant que l'algorithme tient
   en une page.
2. **Compiler en WebAssembly** ce qui est du C autonome : primer3 est le
   candidat évident pour remplacer notre balayage maison par un vrai moteur
   thermodynamique. À faire dans un travailleur, avec ses tables embarquées.
3. **Déporter au niveau 2** ce qui ne s'y prête pas : R et ses paquets
   Bioconductor, MAFFT, BLAST.

| Moteur | Nature | Licence | Ce qu'on en attend |
|---|---|---|---|
| [sangeranalyseR](https://github.com/roblanf/sangeranalyseR) | R / Bioconductor | MIT | Référence pour l'écrêtage, les pics secondaires, le consensus de lectures appariées. Réimplémenter d'abord ; déporter le consensus multi-lectures si besoin. |
| [PrimeSpecPCR](https://github.com/Adv20202/PrimeSpecPCR) | Python | MIT | Le pipeline « spécificité d'espèce » : NCBI → MAFFT → primer3 → test de spécificité. Suppose un accès NCBI, donc **niveau 2 uniquement**, et sur des séquences publiques. |
| [primer3](https://primer3.org/) | C | **GPL-2 ou ultérieure** | Le moteur de design. Attention : une application qui l'embarque et qui serait **distribuée** hérite de la GPL. En usage interne, la question ne se pose pas ; à trancher avant toute diffusion hors de l'entreprise. |
| MAFFT | C | à vérifier avant usage | Alignement multiple, niveau 2. |

## Ce qui reste à éprouver

- **Un vrai `.ab1` : fait, une fois.** Le lecteur a été confronté à un fichier
  d'AB 3730xl (1 659 bases, appel corrigé PBAS.2, ordre des canaux GATC,
  21 560 points par trace). Ce qui en est ressorti :
  - l'ordre des canaux annoncé par `FWO_` est bien le bon — vérifié en
    comparant, base par base, la lettre appelée au canal dominant : 85 %
    d'accord, le reste s'expliquant par les pics qui se chevauchent ;
  - **ce fichier ne porte aucune qualité PHRED** (pas d'entrée `PCON`).
    L'écrêtage n'a donc rien à écrêter : la case est désormais désactivée et
    l'interface le dit, au lieu de rester cochée pour rien ;
  - l'écartement des pics y va de 6 à 26 échantillons pour une moyenne de 13.
    C'est cette irrégularité qui a révélé le défaut d'alignement de la ligne de
    bases ; le fabricant de chromatogrammes de synthèse des épreuves la
    reproduit maintenant.
  Restent à éprouver : d'autres chimies, d'autres appareils, et des fichiers
  porteurs de qualités.
- **Le poste d'entreprise lui-même** : proxy, politique de sécurité du
  navigateur, taille des fichiers ouverts, version du navigateur installée.
- **La comparaison des chiffres** avec l'outil que le laboratoire utilise
  aujourd'hui : une Tm ou un écrêtage qui diffèrent doivent être expliqués
  avant d'être adoptés.
