import './style.css';
import {demarrer, _essais} from './ui/app.js';
import {assurerIsolation} from './ui/isolation.js';

// L'isolation d'origine est tentée d'abord : si elle exige un rechargement,
// autant qu'il arrive avant que l'utilisateur ait ouvert un fichier.
void assurerIsolation().then((etat) => demarrer(undefined, etat));

// Une passerelle pour les épreuves de bout en bout : elles déposent un fichier
// sans passer par le glisser-déposer, que Playwright simule mal.
declare global {
  interface Window { seqops?: typeof _essais }
}
window.seqops = _essais;
