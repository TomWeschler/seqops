/** Ce qu'un calcul reçoit pour rendre compte et pour s'arrêter. */
export interface Contexte {
  /** Signale l'avancement. Appelée souvent : l'implémentation limite d'elle-même
   *  la fréquence des messages, un calcul n'a pas à s'en soucier. */
  signaler(fait: number, total: number, message?: string): void;
  /** Vrai dès que quelqu'un a demandé l'arrêt. Un calcul long DOIT la consulter
   *  régulièrement et rendre alors ce qu'il a déjà trouvé. */
  annule(): boolean;
}

export interface Calcul<P, R> {
  readonly nom: string;
  readonly libelle: string;
  executer(params: P, ctx: Contexte): R;
}
