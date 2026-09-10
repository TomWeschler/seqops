# Créer le dépôt neuf

Le projet a démarré dans `seqops/` d'un dépôt existant (`kanban`), faute d'en
avoir un à lui. Voici comment lui donner le sien **sans perdre l'historique**.
Tout est prêt pour la sortie : le workflow d'intégration continue est déjà dans
`seqops/.github/workflows/ci.yml`, écrit pour une racine de dépôt.

## 1. Créer le dépôt vide (chez GitHub, 2 minutes)

*New repository* → nom `seqops` → **Private** → **ne cocher ni README, ni
.gitignore, ni licence** (le dépôt doit rester vide, sinon l'import ci-dessous
part en conflit).

## 2. Extraire l'historique de `seqops/`

Depuis un clone de `kanban`, sur la branche qui porte le travail :

```bash
cd /chemin/vers/kanban
git checkout claude/dna-correction-analysis-tool-mg2opg
git pull

# Rejoue l'historique du sous-répertoire comme s'il avait toujours été à la racine
git subtree split --prefix=seqops -b seqops-seul

cd ..
mkdir seqops && cd seqops
git init -b main
git pull ../kanban seqops-seul
```

À ce stade, `ls` doit montrer `package.json`, `src/`, `tests/`, `docs/`,
`.github/` à la racine. Vérifier que tout tient debout **avant** de pousser :

```bash
npm ci
npm run tout      # types, épreuves unitaires, construction, bout en bout
```

## 3. Pousser

```bash
git remote add origin https://github.com/<vous>/seqops.git
git push -u origin main
```

L'intégration continue se déclenche à la première poussée. Sur dépôt privé,
l'enveloppe gratuite est de 2 000 minutes par mois ; ce parcours en consomme
moins de trois.

## 4. Brancher Cloudflare Pages

*Workers & Pages* → *Create* → *Pages* → *Connect to Git* → dépôt `seqops`.

| Réglage | Valeur |
|---|---|
| Commande de construction | `npm ci && npm run build` |
| Dossier de sortie | `dist` |
| Dossier racine | *(vide — le projet est à la racine)* |

Après le premier déploiement, ouvrir le site et vérifier en pied de page :
**« isolation d'origine : oui »**. Si c'est « non », `public/_headers` n'a pas
été appliqué et l'arrêt des calculs longs perdra les résultats partiels.

Facultatif mais sain : Cloudflare Access devant le site (gratuit jusqu'à
50 utilisateurs) pour le réserver aux gens de l'entreprise.

## 5. Nettoyer `kanban`

Une fois la sortie vérifiée, le travail n'a plus rien à faire dans l'autre
dépôt :

```bash
cd /chemin/vers/kanban
git push origin --delete claude/dna-correction-analysis-tool-mg2opg
git branch -D claude/dna-correction-analysis-tool-mg2opg seqops-seul
```

Rien d'autre à défaire : la branche n'a jamais été fusionnée dans `main`, et
elle est la seule à avoir touché `seqops/` et `.github/`.

## 6. Après la sortie

- Supprimer ce fichier et la section « Sortir le projet de ce dépôt » de
  `docs/exploitation.md` : ils n'ont plus d'objet.
- Ajouter la licence MIT à la racine (`LICENSE`), annoncée par le README.
- Protéger `main` (revue exigée, épreuves obligatoires) si vous serez plusieurs.
