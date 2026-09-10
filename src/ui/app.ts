/** L'application : charger des fichiers, regarder, corriger, lancer, exporter.
 *
 *  L'état tient dans une seule structure et chaque action la remplace : c'est
 *  ce qui permet d'afficher un avant/après honnête et de tout journaliser. */

import {ecreterMott, lireAbif, ErreurAbif} from '../core/abif.js';
import type {Ecretage, LectureAbif} from '../core/abif.js';
import {ecrireFasta, lireFasta, remplacerSegment, remplacerSequence} from '../core/fasta.js';
import type {Enregistrement} from '../core/fasta.js';
import {composition, corriger} from '../core/sequence.js';
import type {Correction, OptionsCorrection} from '../core/sequence.js';
import {rapportHtml, rapportTexte} from '../core/rapport.js';
import type {ResultatAmorces} from '../calculs/amorces.js';
import {ExecuteurLocal} from '../jobs/executeur-local.js';
import type {Executeur, Tache} from '../jobs/types.js';
import {dessiner} from './chromatogramme.js';
import {$, ech, nb, nomSur, telecharger} from './dom.js';

export const VERSION = '0.1.0';

export interface DocumentSeq {
  readonly id: string;
  readonly nom: string;
  readonly genre: 'ab1' | 'fas';
  readonly abif?: LectureAbif;
  readonly ecretage?: Ecretage;
  enrs: Enregistrement[];
  enrIndex: number;
  /** Séquence modifiée à la main ; absente tant qu'on n'a rien changé. */
  edite?: string;
  journalEdition: string[];
}

interface Etat {
  docs: DocumentSeq[];
  actif: number;
  vue: {premiere: number; combien: number};
  amorces?: {tache: string; resultat?: ResultatAmorces};
}

const etat: Etat = {docs: [], actif: -1, vue: {premiere: 0, combien: 40}};
let executeur: Executeur;

/* ── Chargement ──────────────────────────────────────────────────────────── */

const identifiant = () => (globalThis.crypto?.randomUUID?.() ?? String(Math.random())).slice(0, 8);

export async function chargerFichier(f: File): Promise<DocumentSeq> {
  const nom = f.name;
  if (/\.ab1$/i.test(nom)) {
    const abif = lireAbif(await f.arrayBuffer());
    const ecretage = abif.qualites.length ? ecreterMott(abif.qualites) : undefined;
    return {id: identifiant(), nom, genre: 'ab1', abif, ecretage, enrs: [], enrIndex: 0, journalEdition: []};
  }
  const texte = await f.text();
  const enrs = lireFasta(texte);
  if (!enrs.length) throw new Error(`${nom} ne contient aucune séquence lisible.`);
  return {id: identifiant(), nom, genre: 'fas', enrs, enrIndex: 0, journalEdition: []};
}

async function accepter(fichiers: FileList | File[]): Promise<void> {
  const err = $('#erreur');
  const soucis: string[] = [];
  for (const f of Array.from(fichiers)) {
    try {
      etat.docs.push(await chargerFichier(f));
      etat.actif = etat.docs.length - 1;
    } catch (e) {
      soucis.push(e instanceof ErreurAbif || e instanceof Error ? `${f.name} : ${e.message}` : String(e));
    }
  }
  err.hidden = soucis.length === 0;
  err.textContent = soucis.join(' — ');
  etat.vue = {premiere: 0, combien: 40};
  etat.amorces = undefined;
  rendre();
}

/* ── Lecture de l'état ───────────────────────────────────────────────────── */

export const docActif = (): DocumentSeq | null => etat.docs[etat.actif] ?? null;

function optionsCorrection(): OptionsCorrection {
  return {
    uracile: ($('#opt-uracile') as HTMLInputElement).checked,
    lacunes: ($('#opt-lacunes') as HTMLInputElement).checked,
    ambigusEnN: ($('#opt-ambigus') as HTMLInputElement).checked,
    retirerInvalides: ($('#opt-invalides') as HTMLInputElement).checked
  };
}

/** La séquence telle qu'elle sort du fichier, avant correction : bases du
 *  chromatogramme (écrêtées si demandé) ou enregistrement FASTA choisi. */
export function sequenceSource(doc: DocumentSeq, ecreter: boolean): string {
  if (doc.genre === 'ab1') {
    const bases = doc.abif?.bases ?? '';
    if (ecreter && doc.ecretage) return bases.slice(doc.ecretage.debut, doc.ecretage.fin);
    return bases;
  }
  return doc.enrs[doc.enrIndex]?.seq ?? '';
}

function correctionCourante(doc: DocumentSeq): Correction {
  const ecreter = ($('#opt-ecreter') as HTMLInputElement).checked;
  return corriger(sequenceSource(doc, ecreter), optionsCorrection());
}

export function sequenceCourante(doc: DocumentSeq): string {
  return doc.edite ?? correctionCourante(doc).seq;
}

/* ── Rendu ───────────────────────────────────────────────────────────────── */

function rendreListe(): void {
  const ul = $('#liste');
  ul.innerHTML = etat.docs.map((d, i) => {
    const detail = d.genre === 'ab1'
      ? `${nb(d.abif?.bases.length ?? 0)} bases${d.abif?.echantillon ? ' · ' + ech(d.abif.echantillon) : ''}`
      : `${d.enrs.length} enregistrement${d.enrs.length > 1 ? 's' : ''}`;
    return `<li data-i="${i}" class="${i === etat.actif ? 'actif' : ''}">
      <span class="pastille ${d.genre}">${d.genre}</span>
      <span class="nom">${ech(d.nom)} <span class="note">${detail}</span></span>
      ${d.edite !== undefined ? '<span class="pastille warn">modifié</span>' : ''}
      <button class="sup" data-sup="${i}" title="Retirer">×</button></li>`;
  }).join('');
}

function rendreMeta(doc: DocumentSeq): void {
  const cases: [string, string, string][] = [];
  if (doc.genre === 'ab1' && doc.abif) {
    const a = doc.abif;
    const q = a.qualites.length
      ? a.qualites.reduce((s, v) => s + v, 0) / a.qualites.length : 0;
    cases.push(['Échantillon', ech(a.echantillon || '—'), `${ech(a.modele || a.machine || 'appareil inconnu')}`]);
    cases.push(['Bases lues', nb(a.bases.length), a.corrige ? 'appel corrigé (PBAS.2)' : 'appel du logiciel']);
    cases.push(['Qualité moyenne', q ? nb(q, 1) : '—', 'PHRED, lecture entière']);
    if (doc.ecretage) {
      cases.push(['Après écrêtage', nb(doc.ecretage.fin - doc.ecretage.debut),
                  `−${doc.ecretage.retireDebut} / −${doc.ecretage.retireFin} bases, Q̄ ${nb(doc.ecretage.qualiteMoyenne, 1)}`]);
    }
    cases.push(['Date de course', ech(a.date || '—'), `ABIF v${a.version}`]);
  } else {
    const e = doc.enrs[doc.enrIndex];
    cases.push(['Enregistrement', ech(e?.id ?? '—'), ech(e?.description || 'sans description')]);
    cases.push(['Longueur source', nb(e?.seq.length ?? 0), 'bases telles qu’écrites']);
    cases.push(['Dans le fichier', nb(doc.enrs.length), 'enregistrements']);
  }
  $('#meta').innerHTML = cases.map(([l, v, s]) =>
    `<div class="kpi"><div class="klbl">${l}</div><div class="kval">${v}</div><div class="ksub">${s}</div></div>`).join('');

  const boite = $('#chromato-boite');
  const aTrace = doc.genre === 'ab1' && (doc.abif?.pics.length ?? 0) > 0;
  boite.hidden = !aTrace;
  if (aTrace && doc.abif) {
    const pos = $('#position') as HTMLInputElement;
    pos.max = String(Math.max(0, doc.abif.bases.length - etat.vue.combien));
    pos.value = String(Math.min(etat.vue.premiere, Number(pos.max)));
    rendreChromato(doc);
  }
}

function rendreChromato(doc: DocumentSeq): void {
  if (doc.genre !== 'ab1' || !doc.abif) return;
  const marquer = ($('#voir-ecrete') as HTMLInputElement).checked;
  dessiner($('#chromato') as HTMLCanvasElement, doc.abif, {
    premiere: etat.vue.premiere, combien: etat.vue.combien,
    ...(marquer && doc.ecretage ? {ecretage: {debut: doc.ecretage.debut, fin: doc.ecretage.fin}} : {})
  });
}

function rendreSequence(doc: DocumentSeq): void {
  const corr = correctionCourante(doc);
  const seq = sequenceCourante(doc);
  const c = composition(seq);
  const co = corr.comptes;
  const touches = co.uracile + co.lacunes + co.ambigus + co.invalides;
  $('#stats').innerHTML = [
    ['Longueur', nb(seq.length) + ' nt', c.autres ? `${nb(c.autres)} ambiguë(s)` : 'aucune ambiguïté'],
    ['GC', nb(c.gc, 1) + ' %', `AT ${nb(c.at, 1)} %`],
    ['Corrections', nb(touches), touches ? 'voir le rapport' : 'séquence propre'],
    ['Modifications', nb(doc.journalEdition.length), doc.edite === undefined ? 'aucune' : 'à la main']
  ].map(([l, v, s]) =>
    `<div class="kpi"><div class="klbl">${l}</div><div class="kval">${v}</div><div class="ksub">${s}</div></div>`).join('');

  const limite = Math.min(seq.length, 6000);
  const largeur = String(seq.length).length;
  const lignes: string[] = [];
  for (let i = 0; i < limite; i += 60) {
    let ligne = `<span class="num">${String(i + 1).padStart(largeur, ' ')}</span>  `;
    for (let j = i; j < Math.min(i + 60, limite); j++) {
      if (j > i && (j - i) % 10 === 0) ligne += ' ';
      const b = seq[j] as string;
      const cls = 'b-' + ('ACGT'.includes(b) ? b : 'N') + (doc.edite === undefined && corr.reparees.has(j) ? ' repar' : '');
      ligne += `<span class="${cls}">${b}</span>`;
    }
    lignes.push(ligne);
  }
  $('#seqvue').innerHTML = lignes.join('\n') +
    (limite < seq.length ? `\n<span class="num">… ${nb(seq.length - limite)} bases non affichées</span>` : '');

  ($('#ed-fin') as HTMLInputElement).max = String(seq.length);
  ($('#ed-debut') as HTMLInputElement).max = String(seq.length);
}

function rendreTaches(taches: readonly Tache[]): void {
  $('#taches').innerHTML = taches.length === 0
    ? '<li class="vide">Aucune analyse lancée.</li>'
    : taches.map((t) => {
      const pct = t.progression.total ? Math.round((t.progression.fait / t.progression.total) * 100) : 0;
      const etats: Record<string, string> = {
        en_cours: '<span class="pastille">en cours</span>',
        terminee: '<span class="pastille ok">terminée</span>',
        annulee: '<span class="pastille warn">arrêtée</span>',
        echouee: '<span class="pastille bad">échouée</span>',
        en_attente: '<span class="pastille">en attente</span>'
      };
      return `<li class="tache"><div class="t">
        <span class="nom">${ech(t.libelle)}</span>${etats[t.etat] ?? ''}
        ${t.etat === 'en_cours' ? `<button data-arret="${t.id}">Arrêter</button>` : ''}
      </div>
      <div class="jauge"><span style="width:${pct}%"></span></div>
      <div class="msg">${pct} % — ${ech(t.erreur ?? t.progression.message)}${t.partiel ? ' (résultat partiel)' : ''}</div>
      </li>`;
    }).join('');
}

function rendreAmorces(r: ResultatAmorces): void {
  const box = $('#resultats');
  if (!r.paires.length) {
    // Sans paire, deux situations opposées qu'il ne faut surtout pas confondre :
    // la recherche est allée au bout et les critères sont trop stricts, ou bien
    // elle a été interrompue avant d'apparier quoi que ce soit. Dire « aucune
    // paire ne satisfait ces critères » dans le second cas, c'est faire croire
    // à un résultat là où il n'y a pas eu de recherche.
    box.innerHTML = r.interrompu
      ? `<p class="vide">Recherche interrompue avant l’appariement :
          ${nb(r.candidatsAvant)} amorces avant et ${nb(r.candidatsArriere)} arrière
          avaient été recensées, aucun couple n’avait encore été examiné.
          Relancez pour aller au bout.</p>`
      : `<p class="vide">Aucune paire ne satisfait ces critères
          (${nb(r.candidatsAvant)} amorces avant, ${nb(r.candidatsArriere)} arrière,
          ${nb(r.pairesExaminees)} couples examinés).</p>`;
    return;
  }
  box.innerHTML = `<p class="note">${nb(r.paires.length)} meilleures paires sur ${nb(r.pairesExaminees)} couples
    examinés${r.interrompu ? ', recherche interrompue — résultat partiel' : ''}.</p>
    <div class="tbl"><table><thead><tr><th>#</th><th>Amorce avant</th><th>Amorce arrière</th>
    <th>Amplicon</th><th>Tm F / R</th><th>ΔTm</th><th>Score</th></tr></thead><tbody>` +
    r.paires.map((p, i) => `<tr>
      <td class="mono">${i + 1}</td>
      <td class="mono">${ech(p.avant.seq)}<br><span class="note">${nb(p.avant.debut)}..${nb(p.avant.fin)} · GC ${nb(p.avant.gc, 0)} %</span></td>
      <td class="mono">${ech(p.arriere.seq)}<br><span class="note">${nb(p.arriere.debut)}..${nb(p.arriere.fin)} · GC ${nb(p.arriere.gc, 0)} %</span></td>
      <td class="mono">${nb(p.amplicon)} nt</td>
      <td class="mono">${nb(p.avant.tm, 1)} / ${nb(p.arriere.tm, 1)}</td>
      <td class="mono">${nb(p.deltaTm, 1)}</td>
      <td class="mono">${nb(p.score, 2)}</td></tr>`).join('') +
    '</tbody></table></div>';
}

export function rendre(): void {
  rendreListe();
  const doc = docActif();
  const montrer = doc !== null;
  for (const id of ['#p-lecture', '#p-sequence', '#p-taches']) $(id).hidden = !montrer;
  if (!doc) return;
  rendreMeta(doc);
  rendreSequence(doc);
}

/* ── Exports ─────────────────────────────────────────────────────────────── */

function contenuRapport(doc: DocumentSeq) {
  const corr = correctionCourante(doc);
  const seq = sequenceCourante(doc);
  return {
    titre: 'Rapport de séquence',
    source: `${doc.nom}${doc.genre === 'fas' ? ` (${doc.enrs[doc.enrIndex]?.id ?? ''})` : ''}`,
    version: VERSION,
    etabliLe: new Date(),
    options: {...optionsCorrection(), ecretage: ($('#opt-ecreter') as HTMLInputElement).checked,
              modifications: doc.journalEdition.length},
    seq,
    correction: corr,
    composition: composition(seq),
    ...(etat.amorces?.resultat ? {amorces: etat.amorces.resultat.paires} : {}),
    ...(doc.genre === 'ab1' && doc.ecretage
      ? {qualite: {moyenne: doc.ecretage.qualiteMoyenne, retireDebut: doc.ecretage.retireDebut,
                   retireFin: doc.ecretage.retireFin}}
      : {})
  };
}

function fasta(doc: DocumentSeq): string {
  const seq = sequenceCourante(doc);
  if (doc.genre === 'fas') {
    return ecrireFasta(remplacerSequence(doc.enrs, doc.enrIndex, seq));
  }
  const nom = (doc.abif?.echantillon || doc.nom.replace(/\.ab1$/i, '')).replace(/\s+/g, '_');
  return ecrireFasta([{id: nom, description: `seqops ${VERSION} — depuis ${doc.nom}`, seq}]);
}

/* ── Branchements ────────────────────────────────────────────────────────── */

export function demarrer(ex?: Executeur, isolation: 'native' | 'service-worker' | 'absente' = 'absente'): void {
  executeur = ex ?? new ExecuteurLocal();
  executeur.surChangement(rendreTaches);
  rendreTaches([]);

  $('#version').textContent = `seqops ${VERSION}`;
  const dit = {
    native: 'isolation d’origine : oui (en-têtes du serveur)',
    'service-worker': 'isolation d’origine : oui (service worker)',
    absente: 'isolation d’origine : non — l’arrêt d’un calcul supprime ses résultats partiels'
  };
  $('#isolation').textContent = globalThis.crossOriginIsolated
    ? dit[isolation === 'absente' ? 'native' : isolation]
    : dit.absente;

  const depot = $('#depot');
  const entree = $('#fichiers') as HTMLInputElement;
  $('#btn-parcourir').addEventListener('click', () => entree.click());
  entree.addEventListener('change', () => { if (entree.files) void accepter(entree.files); entree.value = ''; });
  for (const ev of ['dragenter', 'dragover'] as const) {
    depot.addEventListener(ev, (e) => { e.preventDefault(); depot.classList.add('survol'); });
  }
  for (const ev of ['dragleave', 'drop'] as const) {
    depot.addEventListener(ev, (e) => { e.preventDefault(); depot.classList.remove('survol'); });
  }
  depot.addEventListener('drop', (e) => {
    const dt = (e as DragEvent).dataTransfer;
    if (dt?.files.length) void accepter(dt.files);
  });

  $('#liste').addEventListener('click', (e) => {
    const cible = e.target as HTMLElement;
    const sup = cible.dataset.sup;
    if (sup !== undefined) {
      etat.docs.splice(Number(sup), 1);
      etat.actif = Math.min(etat.actif, etat.docs.length - 1);
      etat.amorces = undefined;
      rendre();
      return;
    }
    const li = cible.closest('li');
    if (li?.dataset.i !== undefined) {
      etat.actif = Number(li.dataset.i);
      etat.vue.premiere = 0;
      etat.amorces = undefined;
      rendre();
    }
  });

  for (const id of ['#opt-uracile', '#opt-lacunes', '#opt-ambigus', '#opt-invalides', '#opt-ecreter']) {
    $(id).addEventListener('change', () => {
      const doc = docActif();
      // Changer les options de correction repart du fichier : garder une
      // modification manuelle par-dessus une autre correction produirait une
      // séquence dont plus personne ne saurait dire d'où elle vient.
      if (doc && doc.edite !== undefined) {
        delete doc.edite;
        doc.journalEdition.push('options de correction changées : retour au fichier');
      }
      rendre();
    });
  }

  const zoom = $('#zoom') as HTMLInputElement;
  const position = $('#position') as HTMLInputElement;
  zoom.addEventListener('input', () => {
    etat.vue.combien = Number(zoom.value);
    const doc = docActif();
    if (doc) rendreMeta(doc);
  });
  position.addEventListener('input', () => {
    etat.vue.premiere = Number(position.value);
    const doc = docActif();
    if (doc) rendreChromato(doc);
  });
  $('#voir-ecrete').addEventListener('change', () => {
    const doc = docActif();
    if (doc) rendreChromato(doc);
  });

  $('#btn-copier').addEventListener('click', async (e) => {
    const doc = docActif();
    if (!doc) return;
    const bouton = e.target as HTMLButtonElement;
    const avant = bouton.textContent;
    try {
      await navigator.clipboard.writeText(sequenceCourante(doc));
      bouton.textContent = 'Copié';
    } catch {
      bouton.textContent = 'Échec';
    }
    setTimeout(() => { bouton.textContent = avant; }, 1200);
  });
  $('#btn-fasta').addEventListener('click', () => {
    const doc = docActif();
    if (doc) telecharger(nomSur(doc.nom.replace(/\.[^.]+$/, ''), '_seqops.fas'), fasta(doc));
  });
  $('#btn-rapport-txt').addEventListener('click', () => {
    const doc = docActif();
    if (doc) telecharger(nomSur(doc.nom.replace(/\.[^.]+$/, ''), '_rapport.txt'), rapportTexte(contenuRapport(doc)));
  });
  $('#btn-rapport-html').addEventListener('click', () => {
    const doc = docActif();
    if (doc) telecharger(nomSur(doc.nom.replace(/\.[^.]+$/, ''), '_rapport.html'),
                         rapportHtml(contenuRapport(doc)), 'text/html;charset=utf-8');
  });

  $('#btn-editer').addEventListener('click', () => {
    const doc = docActif();
    if (!doc) return;
    const debut = Number(($('#ed-debut') as HTMLInputElement).value);
    const fin = Number(($('#ed-fin') as HTMLInputElement).value);
    const texte = ($('#ed-texte') as HTMLInputElement).value.toUpperCase().replace(/[^ACGTRYSWKMBDHVN]/g, '');
    const seq = sequenceCourante(doc);
    const err = $('#erreur');
    try {
      const apres = remplacerSegment([{id: 'x', description: '', seq}], 0, debut, fin, texte)[0];
      doc.edite = apres?.seq ?? seq;
      doc.journalEdition.push(`${debut}..${fin} → « ${texte || '(supprimé)'} »`);
      err.hidden = true;
      rendre();
    } catch (e) {
      err.hidden = false;
      err.textContent = e instanceof Error ? e.message : String(e);
    }
  });
  $('#btn-annuler-edition').addEventListener('click', () => {
    const doc = docActif();
    if (!doc) return;
    delete doc.edite;
    doc.journalEdition.push('retour à la séquence du fichier');
    rendre();
  });

  $('#taches').addEventListener('click', (e) => {
    const id = (e.target as HTMLElement).dataset.arret;
    if (id) executeur.annuler(id);
  });

  $('#btn-analyse').addEventListener('click', () => {
    const doc = docActif();
    if (!doc) return;
    executeur.lancer('sequence/analyse', {brut: sequenceCourante(doc)}, {
      libelle: `Analyse — ${doc.nom}`
    });
  });

  $('#btn-amorces').addEventListener('click', () => {
    const doc = docActif();
    if (!doc) return;
    const seq = sequenceCourante(doc);
    const params = {
      seq,
      ampliconMin: Number(($('#amp-min') as HTMLInputElement).value),
      ampliconMax: Number(($('#amp-max') as HTMLInputElement).value),
      tmMin: Number(($('#tm-min') as HTMLInputElement).value),
      tmMax: Number(($('#tm-max') as HTMLInputElement).value)
    };
    $('#resultats').innerHTML = '<p class="vide">Recherche en cours…</p>';
    const id = executeur.lancer<ResultatAmorces>('amorces/balayage', params, {
      libelle: `Amorces — ${doc.nom} (${nb(seq.length)} nt)`,
      surFin: (t) => {
        if (t.resultat) {
          etat.amorces = {tache: t.id, resultat: t.resultat};
          rendreAmorces(t.resultat);
        } else {
          $('#resultats').innerHTML = `<p class="err">${ech(t.erreur ?? 'aucun résultat')}</p>`;
        }
      }
    });
    etat.amorces = {tache: id};
  });

  rendre();
}

/** Exposé pour les épreuves de bout en bout, qui n'ont pas de presse-papiers
 *  ni de glisser-déposer fiables. */
export const _essais = {accepter, etat};
