# Architecture

## Les contraintes, et ce qu'elles imposent

| Contrainte | Conséquence retenue |
|---|---|
| Hébergement gratuit | Site statique. Cloudflare Pages (dépôt privé accepté, gratuit). GitHub Pages exigerait un dépôt public ou un compte payant. |
| Utilisable sur un PC d'entreprise | Rien à installer, rien à administrer : un onglet. Pas de police ni de script tiers, donc rien à débloquer chez l'informatique. |
| Les séquences ne sortent pas du poste | Aucun serveur d'application. Tout le calcul est fait par le navigateur, dans des travailleurs. La politique de sécurité du contenu interdit toute connexion sortante. |
| Ouvrir `.ab1` et `.fas`, modifier, exporter | Lecture ABIF en TypeScript, lecture/écriture FASTA, rapports texte et HTML. Le fichier d'origine n'est jamais réécrit sur place : l'utilisateur enregistre une copie. |
| Analyses longues | Un contrat de tâches (`src/jobs/types.ts`) : lancement non bloquant, avancement, arrêt, résultat partiel. Un seul exécuteur aujourd'hui, local. |
| Code sous git | Dépôt privé, épreuves automatiques, déploiement continu depuis la branche principale. |

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

Le **niveau 1** est ce qui existe : tout dans le navigateur. Un balayage
exhaustif d'amorces sur quelques kilobases y tient largement ; c'est le cas
d'usage « tester tous les couples possibles et garder les meilleurs ».

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
l'isolation d'origine, donc les en-têtes COOP/COEP de `public/_headers` — un
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

- **Un vrai `.ab1`.** Le lecteur est éprouvé sur des fichiers de synthèse
  conformes au format ; il faut le confronter à des fichiers de vos
  séquenceurs, de plusieurs chimies. C'est la première chose à faire avec un
  fichier réel en main.
- **Le poste d'entreprise lui-même** : proxy, politique de sécurité du
  navigateur, taille des fichiers ouverts, version du navigateur installée.
- **La comparaison des chiffres** avec l'outil que le laboratoire utilise
  aujourd'hui : une Tm ou un écrêtage qui diffèrent doivent être expliqués
  avant d'être adoptés.
