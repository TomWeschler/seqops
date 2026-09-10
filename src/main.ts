import './style.css';
import {demarrer, _essais} from './ui/app.js';

demarrer();

// Une passerelle pour les épreuves de bout en bout : elles déposent un fichier
// sans passer par le glisser-déposer, que Playwright simule mal.
declare global {
  interface Window { seqops?: typeof _essais }
}
window.seqops = _essais;
