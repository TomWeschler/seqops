/** Le contrat entre l'interface et ce qui calcule.
 *
 *  Tout passe par là : un calcul ne sait pas s'il tourne dans un travailleur
 *  du navigateur ou, un jour, sur une machine du laboratoire. C'est ce qui
 *  permettra d'ajouter un exécuteur distant sans toucher ni aux calculs ni à
 *  l'interface — voir docs/architecture.md. */

export type EtatTache = 'en_attente' | 'en_cours' | 'terminee' | 'echouee' | 'annulee';

export interface Progression {
  readonly fait: number;
  readonly total: number;
  readonly message: string;
}

export interface Tache<R = unknown> {
  readonly id: string;
  readonly calcul: string;
  readonly libelle: string;
  readonly creeeLe: number;
  readonly etat: EtatTache;
  readonly progression: Progression;
  readonly resultat?: R;
  readonly erreur?: string;
  /** Vrai quand le résultat est celui d'une tâche interrompue : partiel, mais
   *  exploitable. Un balayage d'amorces arrêté à 60 % a déjà trouvé des paires. */
  readonly partiel?: boolean;
}

export interface OptionsLancement<R> {
  readonly libelle?: string;
  readonly surProgression?: (p: Progression) => void;
  readonly surFin?: (t: Tache<R>) => void;
}

export interface Executeur {
  readonly nom: string;
  /** Rend l'identifiant de la tâche, tout de suite : une analyse longue ne
   *  bloque pas celui qui la lance. */
  lancer<R>(calcul: string, params: unknown, options?: OptionsLancement<R>): string;
  annuler(id: string): void;
  /** Retire une tâche finie de la liste. Une tâche en cours n'est pas oubliée
   *  sans être arrêtée : on ne perd pas la trace d'un calcul qui tourne. */
  oublier(id: string): void;
  taches(): readonly Tache[];
  /** Appelé à chaque changement d'état d'une tâche. */
  surChangement(ecoute: (taches: readonly Tache[]) => void): () => void;
}

/* ── Le protocole des travailleurs ──────────────────────────────────────── */

export type MessageVersTravailleur =
  | {readonly type: 'lancer'; readonly id: string; readonly calcul: string; readonly params: unknown;
     readonly drapeau?: Int32Array};

export type MessageDuTravailleur =
  | {readonly type: 'progression'; readonly id: string; readonly fait: number; readonly total: number; readonly message: string}
  | {readonly type: 'fini'; readonly id: string; readonly resultat: unknown; readonly partiel: boolean}
  | {readonly type: 'erreur'; readonly id: string; readonly message: string};
