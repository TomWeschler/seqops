/** L'application : charger des fichiers, regarder, corriger, lancer, exporter.
 *
 *  L'état tient dans une seule structure et chaque action la remplace : c'est
 *  ce qui permet d'afficher un avant/après honnête et de tout journaliser. */

import {ecreterMott, lireAbif, picLePlusHaut, ErreurAbif} from '../core/abif.js';
import type {Ecretage, LectureAbif} from '../core/abif.js';
import {ecrireFasta, lireFasta, remplacerSegment, remplacerSequence} from '../core/fasta.js';
import type {Enregistrement} from '../core/fasta.js';
import {composition, corriger, prochaineAmbiguite, IUPAC} from '../core/sequence.js';
import type {Correction, OptionsCorrection} from '../core/sequence.js';
import {rapportHtml, rapportTexte} from '../core/rapport.js';
import type {ResultatAmorces, Sonde} from '../calculs/amorces.js';
import type {ResultatAnalyse} from '../calculs/analyse.js';
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
  /** Corrections base à base sur un chromatogramme, par index de base appelée
   *  dans le fichier — donc stables quels que soient l'écrêtage et la
   *  correction appliqués ensuite. */
  editionsBases: Map<number, string>;
  journalEdition: string[];
}

interface Etat {
  docs: DocumentSeq[];
  actif: number;
  vue: {premiere: number; combien: number};
  amorces?: {tache: string; resultat?: ResultatAmorces};
  analyse?: {tache: string; resultat?: ResultatAnalyse};
}

const etat: Etat = {docs: [], actif: -1, vue: {premiere: 0, combien: 40}};
/** Base sélectionnée dans la ligne sous le chromatogramme (index fichier). */
let choisie = -1;
/** Position, dans la séquence corrigée, de la dernière ambiguïté visitée. */
let ambiguiteCourante = -1;
let executeur: Executeur;

/* ── Chargement ──────────────────────────────────────────────────────────── */

const identifiant = () => (globalThis.crypto?.randomUUID?.() ?? String(Math.random())).slice(0, 8);

export async function chargerFichier(f: File): Promise<DocumentSeq> {
  const nom = f.name;
  if (/\.ab1$/i.test(nom)) {
    const abif = lireAbif(await f.arrayBuffer());
    const ecretage = abif.qualites.length ? ecreterMott(abif.qualites) : undefined;
    return {id: identifiant(), nom, genre: 'ab1', abif, ecretage, enrs: [], enrIndex: 0,
            editionsBases: new Map(), journalEdition: []};
  }
  const texte = await f.text();
  const enrs = lireFasta(texte);
  if (!enrs.length) throw new Error(`${nom} ne contient aucune séquence lisible.`);
  return {id: identifiant(), nom, genre: 'fas', enrs, enrIndex: 0,
          editionsBases: new Map(), journalEdition: []};
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
    let bases = doc.abif?.bases ?? '';
    if (doc.editionsBases.size) {
      const lettres = bases.split('');
      for (const [i, b] of doc.editionsBases) if (i >= 0 && i < lettres.length) lettres[i] = b;
      bases = lettres.join('');
    }
    if (ecreter && doc.ecretage) return bases.slice(doc.ecretage.debut, doc.ecretage.fin);
    return bases;
  }
  return doc.enrs[doc.enrIndex]?.seq ?? '';
}

/** Décalage entre la séquence affichée et les bases du fichier : l'écrêtage.
 *  C'est lui qui permet de retrouver le pic d'où vient une base corrigée. */
function decalage(doc: DocumentSeq): number {
  const ecreter = ($('#opt-ecreter') as HTMLInputElement).checked;
  return doc.genre === 'ab1' && ecreter && doc.ecretage ? doc.ecretage.debut : 0;
}

/** Index de la base dans le fichier .ab1, à partir d'une position de la
 *  séquence corrigée. Passe par la table des sources : une correction qui
 *  retire un caractère décale tout ce qui suit. */
export function indexFichier(doc: DocumentSeq, positionCorrigee: number): number {
  const corr = correctionCourante(doc);
  const dansSource = corr.sources[positionCorrigee];
  return dansSource === undefined ? -1 : dansSource + decalage(doc);
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
      ${d.edite !== undefined || d.editionsBases.size ? '<span class="pastille warn">modifié</span>' : ''}
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
  rendreLigneBases(doc);
  const marquer = ($('#voir-ecrete') as HTMLInputElement).checked;
  dessiner($('#chromato') as HTMLCanvasElement, doc.abif, {
    premiere: etat.vue.premiere, combien: etat.vue.combien,
    ...(marquer && doc.ecretage ? {ecretage: {debut: doc.ecretage.debut, fin: doc.ecretage.fin}} : {})
  });
}

const LETTRES = ['A', 'C', 'G', 'T', 'N', 'R', 'Y', 'S', 'W', 'K', 'M'] as const;

/** La ligne des bases appelées, sous le chromatogramme : on lit la séquence
 *  là où on regarde les pics, et on la corrige au même endroit. */
function rendreLigneBases(doc: DocumentSeq): void {
  const ligne = $('#bases-ligne');
  if (doc.genre !== 'ab1' || !doc.abif) { ligne.innerHTML = ''; return; }
  const bases = sequenceSource(doc, false);           // sans écrêtage : index du fichier
  const premiere = etat.vue.premiere;
  const derniere = Math.min(bases.length, premiere + etat.vue.combien);
  const ecretage = doc.ecretage;
  const morceaux: string[] = [];
  for (let i = premiere; i < derniere; i++) {
    const b = bases[i] as string;
    const classes = ['b', `b-${'ACGT'.includes(b) ? b : 'N'}`];
    if (doc.editionsBases.has(i)) classes.push('edite');
    if (ecretage && (i < ecretage.debut || i >= ecretage.fin)) classes.push('hors');
    if (i === choisie) classes.push('choisie');
    const q = doc.abif.qualites[i];
    const titre = `position ${i + 1}${q === undefined ? '' : ` · qualité ${q}`}`;
    morceaux.push(`<span class="${classes.join(' ')}" data-base="${i}" title="${titre}">${ech(b)}</span>`);
  }
  ligne.innerHTML = morceaux.join('');
  rendrePalette(doc);
}

function rendrePalette(doc: DocumentSeq): void {
  const palette = $('#palette');
  if (choisie < 0 || doc.genre !== 'ab1' || !doc.abif) { palette.hidden = true; return; }
  const bases = sequenceSource(doc, false);
  const actuelle = bases[choisie] ?? '?';
  const pic = picLePlusHaut(doc.abif, choisie);
  palette.hidden = false;
  palette.innerHTML =
    `<span class="note">Base <strong>${nb(choisie + 1)}</strong> du fichier — lue <strong class="b-${'ACGT'.includes(actuelle) ? actuelle : 'N'}">${ech(actuelle)}</strong>` +
    (pic ? ` · pic le plus haut <strong class="b-${pic.base}">${pic.base}</strong>` +
           ` (${pic.rapport === Infinity ? 'seul pic' : `${nb(pic.rapport, 1)}× le second`})` : '') +
    '</span>' +
    LETTRES.map((l) => `<button class="lettre b-${'ACGT'.includes(l) ? l : 'N'}${l === actuelle ? ' actuelle' : ''}"` +
      ` data-lettre="${l}">${l}</button>`).join('') +
    (doc.editionsBases.has(choisie)
      ? '<button data-lettre="__annuler">Rétablir</button>' : '');
}

function corrigerBase(doc: DocumentSeq, index: number, lettre: string): void {
  const original = (doc.abif?.bases ?? '')[index];
  if (original === undefined) return;
  // Une correction manuelle repart du fichier : garder par-dessus une
  // réécriture de segment donnerait une séquence dont plus personne ne saurait
  // dire d'où elle vient.
  if (doc.edite !== undefined) {
    delete doc.edite;
    doc.journalEdition.push('correction base à base : retour à la séquence du fichier');
  }
  if (lettre === '__annuler' || lettre === original) {
    doc.editionsBases.delete(index);
    doc.journalEdition.push(`position ${index + 1} : rétablie en ${original}`);
  } else {
    doc.editionsBases.set(index, lettre);
    doc.journalEdition.push(`position ${index + 1} : ${original} → ${lettre}`);
  }
  rendre();
}

/** Ce qui cloche dans la séquence, dit en rouge : des N, des codes ambigus, des
 *  caractères qui n'avaient rien à y faire. Un chiffre douteux recopié dans un
 *  cahier de manip coûte plus cher qu'un bandeau voyant. */
function alerteQualite(doc: DocumentSeq): string {
  const corr = correctionCourante(doc);
  const c = composition(sequenceCourante(doc));
  const griefs: string[] = [];
  if (c.autres > 0) {
    const detail = Object.entries(c.amb).sort().map(([l, n]) => `${n} ${l}`).join(', ');
    griefs.push(`<strong>${nb(c.autres)} position${c.autres > 1 ? 's' : ''} ambiguë${c.autres > 1 ? 's' : ''}</strong> (${ech(detail)})`);
  }
  if (corr.comptes.invalides > 0) {
    griefs.push(`<strong>${nb(corr.comptes.invalides)} caractère${corr.comptes.invalides > 1 ? 's' : ''} invalide${corr.comptes.invalides > 1 ? 's' : ''}</strong> dans le fichier`);
  }
  if (corr.comptes.lacunes > 0) {
    griefs.push(`${nb(corr.comptes.lacunes)} lacune${corr.comptes.lacunes > 1 ? 's' : ''} d’alignement`);
  }
  if (!griefs.length) return '';
  return `<p class="alerte">⚠ ${griefs.join(' · ')} — ces positions ne valent pas une base lue,
    et aucune amorce ne sera dessinée dessus. Le bouton « Prochaine ambiguïté » les parcourt une à une.</p>`;
}

function rendreSequence(doc: DocumentSeq): void {
  const corr = correctionCourante(doc);
  const seq = sequenceCourante(doc);
  const c = composition(seq);
  const co = corr.comptes;
  const touches = co.uracile + co.lacunes + co.ambigus + co.invalides;
  const modifs = doc.journalEdition.length;
  $('#stats').innerHTML = [
    ['Longueur', nb(seq.length) + ' nt', c.autres ? `<span class="rouge">${nb(c.autres)} ambiguë(s)</span>` : 'aucune ambiguïté'],
    ['GC', nb(c.gc, 1) + ' %', `AT ${nb(c.at, 1)} %`],
    ['Ambiguïtés', c.autres ? `<span class="rouge">${nb(c.autres)}</span>` : '0',
     c.autres ? 'à trancher avant de commander' : 'aucune'],
    ['Corrections', nb(touches), touches ? 'voir le rapport' : 'séquence propre'],
    ['Modifications', nb(modifs), modifs ? 'à la main' : 'aucune']
  ].map(([l, v, s]) =>
    `<div class="kpi"><div class="klbl">${l}</div><div class="kval">${v}</div><div class="ksub">${s}</div></div>`).join('');
  const alerte = $('#alerte-sequence');
  alerte.innerHTML = alerteQualite(doc);

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
      const fini = t.etat !== 'en_cours';
      return `<li class="tache"><div class="t">
        <span class="nom">${ech(t.libelle)}</span>${etats[t.etat] ?? ''}
        ${fini ? '' : `<button data-arret="${t.id}">Arrêter</button>`}
        ${fini ? `<button class="croix" data-oubli="${t.id}" title="Retirer cette analyse"
                    aria-label="Retirer ${ech(t.libelle)}">✕</button>` : ''}
      </div>
      <div class="jauge"><span style="width:${pct}%"></span></div>
      <div class="msg">${pct} % — ${ech(t.erreur ?? t.progression.message)}${t.partiel ? ' (résultat partiel)' : ''}</div>
      </li>`;
    }).join('');
}

function rendreAnalyse(r: ResultatAnalyse): void {
  const box = $('#analyse-res');
  const c = r.composition;
  const kpis: [string, string, string][] = [
    ['Longueur', `${nb(c.longueur)} nt`,
     c.autres ? `<span class="rouge">${nb(c.autres)} ambiguë(s)</span>` : 'aucune ambiguïté'],
    ['GC', `${nb(c.gc, 1)} %`, `biais ${c.skewGC >= 0 ? '+' : ''}${nb(c.skewGC, 3)}`],
    ['Tm', r.tm === null ? '—' : `${nb(r.tm, 1)} °C`, r.tm === null ? 'hors domaine du calcul' : 'plus proche voisin'],
    ['Masse', r.masse === null ? '—' : `${nb(r.masse / 1000, 1)} kDa`, 'simple brin'],
    ['Cadres ouverts', nb(r.orfs.length), 'ATG → stop']
  ];
  const bases = (['A', 'C', 'G', 'T'] as const).map((b) =>
    `<tr><td class="mono b-${b}"><strong>${b}</strong></td><td class="mono">${nb(c.n[b])}</td>
     <td class="mono">${nb((c.n[b] / (c.longueur || 1)) * 100, 2)} %</td></tr>`).join('');

  const orfs = r.orfs.length
    ? `<div class="tbl"><table><thead><tr><th>Cadre</th><th>Début</th><th>Fin</th><th>aa</th>
       <th>Stop</th><th>Protéine</th></tr></thead><tbody>` +
      r.orfs.slice(0, 25).map((o) => `<tr><td class="mono">${o.cadre}</td>
        <td class="mono">${nb(o.debut)}</td><td class="mono">${nb(o.fin)}</td>
        <td class="mono">${nb(o.longueurAA)}</td>
        <td>${o.avecStop ? '<span class="pastille ok">oui</span>' : '<span class="pastille warn">tronqué</span>'}</td>
        <td class="mono" style="word-break:break-all">${ech(o.prot.slice(0, 60))}${o.prot.length > 60 ? ' …' : ''}</td>
        </tr>`).join('') + '</tbody></table></div>' +
      (r.orfs.length > 25 ? `<p class="note">${nb(r.orfs.length)} cadres au total, les 25 plus longs affichés.</p>` : '')
    : '<p class="vide">Aucun cadre ouvert de la longueur demandée.</p>';

  const doc = docActif();
  box.innerHTML =
    `${doc ? alerteQualite(doc) : ''}
     <div class="kpis">${kpis.map(([l, v, sub]) =>
      `<div class="kpi"><div class="klbl">${l}</div><div class="kval">${v}</div><div class="ksub">${sub}</div></div>`).join('')}</div>
     ${grapheGC(r)}
     <h3>Bases</h3><div class="tbl"><table><thead><tr><th>Code</th><th>Nombre</th><th>Part</th></tr></thead>
     <tbody>${bases}</tbody></table></div>
     <h3>Cadres ouverts</h3>${orfs}`;
}

/** Le GC glissant : un tracé, pas un tableau de mille lignes. On échantillonne,
 *  parce qu'un point par base sur un génome ne dit rien de plus et fige la page. */
function grapheGC(r: ResultatAnalyse): string {
  if (r.gc.length < 2) return '<p class="note">Séquence trop courte pour la fenêtre demandée.</p>';
  const MAX = 1000;
  const pas = Math.max(1, Math.ceil(r.gc.length / MAX));
  const vus = r.gc.filter((_, i) => i % pas === 0);
  const W = 1000, H = 120, m = 14;
  const x = (i: number) => m + (W - 2 * m) * (vus.length === 1 ? 0 : i / (vus.length - 1));
  const y = (v: number) => H - m - (H - 2 * m) * (v / 100);
  const d = vus.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.gc).toFixed(1)}`).join(' ');
  const moyenne = r.composition.gc;
  return `<h3>GC en fenêtre glissante</h3>
    <svg class="graphe" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"
         aria-label="GC en fenêtre glissante, de 0 à 100 %">
      ${[0, 25, 50, 75, 100].map((v) =>
        `<line x1="${m}" x2="${W - m}" y1="${y(v)}" y2="${y(v)}" stroke="#252535" stroke-width="1"/>`).join('')}
      <line x1="${m}" x2="${W - m}" y1="${y(moyenne)}" y2="${y(moyenne)}" stroke="#60607a"
            stroke-width="1" stroke-dasharray="4 4"/>
      <path d="${d}" fill="none" stroke="#38bdf8" stroke-width="1.6" vector-effect="non-scaling-stroke"/>
    </svg>
    <p class="note">${nb(r.gc.length)} positions calculées ; pointillé : moyenne de ${nb(moyenne, 1)} %.
    Échelle verticale 0–100 %.</p>`;
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
  const avecSonde = r.paires.some((p) => p.sonde);
  const celluleSonde = (s?: Sonde) => s
    ? `<td class="mono">${ech(s.seq)}<br><span class="note">brin ${s.brin} · ${nb(s.debut)}..${nb(s.fin)}
       · Tm ${nb(s.tm, 1)} °C · GC ${nb(s.gc, 0)} %<br>
       ${s.collee === 'F'
         ? `à ${nb(s.distanceAvant)} nt de F`
         : `à ${nb(s.distanceArriere)} nt de R`}${
         Math.min(s.distanceAvant, s.distanceArriere) === 0 ? ' (collée)' : ''}</span></td>`
    : '';
  box.innerHTML = `<p class="note">${nb(r.paires.length)} meilleures paires sur ${nb(r.pairesExaminees)} couples
    examinés${r.interrompu ? ', recherche interrompue — résultat partiel' : ''}${
      avecSonde ? ` ; ${nb(r.candidatsSonde)} sondes candidates recensées, ${nb(r.sansSonde)} paires écartées faute de sonde` : ''}.</p>
    <div class="tbl"><table><thead><tr><th>#</th><th>Amorce avant</th><th>Amorce arrière</th>
    ${avecSonde ? '<th>Sonde</th>' : ''}
    <th>Amplicon</th><th>Tm F / R</th><th>ΔTm</th><th>Score</th></tr></thead><tbody>` +
    r.paires.map((p, i) => `<tr>
      <td class="mono">${i + 1}</td>
      <td class="mono">${ech(p.avant.seq)}<br><span class="note">${nb(p.avant.debut)}..${nb(p.avant.fin)} · GC ${nb(p.avant.gc, 0)} %</span></td>
      <td class="mono">${ech(p.arriere.seq)}<br><span class="note">${nb(p.arriere.debut)}..${nb(p.arriere.fin)} · GC ${nb(p.arriere.gc, 0)} %</span></td>
      ${avecSonde ? celluleSonde(p.sonde) : ''}
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
  for (const id of ['#p-lecture', '#p-sequence', '#p-analyse', '#p-amorces', '#p-taches']) {
    $(id).hidden = !montrer;
  }
  if (!doc) return;
  rendreMeta(doc);
  rendreSequence(doc);
}

/** Va à la prochaine base ambiguë : centre le chromatogramme dessus, la
 *  sélectionne, et propose la base du pic le plus haut. Ne boucle pas toute
 *  seule au début — sauter en arrière sans le dire ferait croire qu'on avance. */
function allerAmbiguiteSuivante(doc: DocumentSeq): void {
  const seq = sequenceCourante(doc);
  const boite = $('#ambiguite');
  const suivante = prochaineAmbiguite(seq, ambiguiteCourante);
  if (suivante === -1) {
    const reste = prochaineAmbiguite(seq, -1);
    boite.hidden = false;
    boite.innerHTML = reste === -1
      ? '<p class="ok-vert">Aucune ambiguïté dans cette séquence.</p>'
      : `<p class="note">Fin de la séquence atteinte. <button id="btn-ambiguite-debut">Reprendre au début</button></p>`;
    ambiguiteCourante = -1;
    if (reste !== -1) {
      $('#btn-ambiguite-debut').addEventListener('click', () => allerAmbiguiteSuivante(doc));
    }
    return;
  }
  ambiguiteCourante = suivante;
  const lettre = seq[suivante] as string;
  const index = indexFichier(doc, suivante);

  // Centrer la vue du chromatogramme sur la position, et l'y sélectionner.
  if (doc.genre === 'ab1' && index >= 0) {
    choisie = index;
    etat.vue.premiere = Math.max(0, index - Math.floor(etat.vue.combien / 2));
    rendreMeta(doc);
  }

  const pic = doc.genre === 'ab1' && doc.abif && index >= 0 ? picLePlusHaut(doc.abif, index) : null;
  const restantes = seq.length - suivante;
  boite.hidden = false;
  boite.innerHTML =
    `<div class="barre" style="margin:0">
       <span class="quoi">Position <strong>${nb(suivante + 1)}</strong> de la séquence${
         index >= 0 ? ` <span class="note">(base ${nb(index + 1)} du fichier)</span>` : ''} — lue
         <strong class="b-N">${ech(lettre)}</strong>
         ${IUPAC_LISIBLE(lettre)}</span>
       ${pic
         ? `<span class="note">pic le plus haut :
              <strong class="b-${pic.base}">${pic.base}</strong>
              ${pic.rapport === Infinity ? '(seul pic)' : `(${nb(pic.rapport, 1)}× le second)`}</span>`
         : '<span class="note">pas de trace : aucune proposition</span>'}
       <label class="champ">corriger en
         <input type="text" id="ambiguite-lettre" maxlength="1" style="width:3.2rem;text-align:center"
                value="${pic ? pic.base : ''}"></label>
       <button id="btn-ambiguite-appliquer" class="primary">Appliquer</button>
       <button id="btn-ambiguite-passer">Passer</button>
       <span class="note">${nb(restantes)} bases après celle-ci</span>
     </div>`;

  $('#btn-ambiguite-passer').addEventListener('click', () => allerAmbiguiteSuivante(doc));
  $('#btn-ambiguite-appliquer').addEventListener('click', () => {
    const val = ($('#ambiguite-lettre') as HTMLInputElement).value.toUpperCase();
    if (!/^[ACGTRYSWKMBDHVN]$/.test(val)) {
      boite.insertAdjacentHTML('beforeend',
        '<p class="err">Seule une lettre du code IUPAC est acceptée.</p>');
      return;
    }
    if (doc.genre === 'ab1' && index >= 0) {
      corrigerBase(doc, index, val);
    } else {
      // Sans chromatogramme, on réécrit la base dans la séquence elle-même.
      const seqDuMoment = sequenceCourante(doc);
      doc.edite = seqDuMoment.slice(0, suivante) + val + seqDuMoment.slice(suivante + 1);
      doc.journalEdition.push(`position ${suivante + 1} : ${lettre} → ${val}`);
      rendre();
    }
    // On recule d'un cran : la position corrigée n'est plus ambiguë, la
    // recherche suivante repartira juste après elle.
    ambiguiteCourante = suivante;
    allerAmbiguiteSuivante(doc);
  });
}

const IUPAC_LISIBLE = (lettre: string): string => {
  const cls = IUPAC[lettre];
  return cls && cls.length > 1 ? `<span class="note">(${cls.split('').join(' ou ')})</span>` : '';
};

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
      choisie = -1;
      ambiguiteCourante = -1;
      $('#ambiguite').hidden = true;
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

  // La ligne de bases : cliquer choisit, la palette corrige, le clavier va vite.
  $('#bases-ligne').addEventListener('click', (e) => {
    const cible = (e.target as HTMLElement).dataset.base;
    const doc = docActif();
    if (!doc || cible === undefined) return;
    choisie = choisie === Number(cible) ? -1 : Number(cible);
    rendreLigneBases(doc);
    $('#bases-ligne').focus();
  });
  $('#palette').addEventListener('click', (e) => {
    const lettre = (e.target as HTMLElement).dataset.lettre;
    const doc = docActif();
    if (!doc || lettre === undefined || choisie < 0) return;
    corrigerBase(doc, choisie, lettre);
  });
  $('#bases-ligne').addEventListener('keydown', (e) => {
    const doc = docActif();
    if (!doc || doc.genre !== 'ab1') return;
    const ev = e as KeyboardEvent;
    const bases = sequenceSource(doc, false);
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
      ev.preventDefault();
      const pas = ev.key === 'ArrowRight' ? 1 : -1;
      choisie = Math.max(0, Math.min(bases.length - 1, (choisie < 0 ? etat.vue.premiere : choisie) + pas));
      // Suivre la sélection si elle sort de la fenêtre affichée.
      if (choisie < etat.vue.premiere) etat.vue.premiere = choisie;
      if (choisie >= etat.vue.premiere + etat.vue.combien) {
        etat.vue.premiere = choisie - etat.vue.combien + 1;
      }
      rendreMeta(doc);
      return;
    }
    if (ev.key === 'Escape') { choisie = -1; rendreLigneBases(doc); return; }
    const lettre = ev.key.toUpperCase();
    if (choisie >= 0 && /^[ACGTRYSWKMBDHVN]$/.test(lettre)) {
      ev.preventDefault();
      corrigerBase(doc, choisie, lettre);
    }
  });

  $('#btn-ambiguite').addEventListener('click', () => {
    const doc = docActif();
    if (doc) allerAmbiguiteSuivante(doc);
  });

  // Le bloc « sonde » s'éteint visuellement quand la case est décochée : on
  // voit d'un coup d'œil si ces réglages comptent.
  const majSonde = () => {
    $('#bloc-sonde').classList.toggle('eteint', !($('#opt-sonde') as HTMLInputElement).checked);
  };
  $('#opt-sonde').addEventListener('change', majSonde);
  majSonde();

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
    const cible = e.target as HTMLElement;
    if (cible.dataset.arret) { executeur.annuler(cible.dataset.arret); return; }
    const oubli = cible.dataset.oubli;
    if (!oubli) return;
    executeur.oublier(oubli);
    // Retirer une analyse retire aussi ce qu'elle affichait : garder à l'écran
    // le résultat d'une tâche effacée, c'est ne plus savoir d'où il vient.
    if (etat.amorces?.tache === oubli) {
      etat.amorces = undefined;
      $('#resultats').innerHTML = '';
    }
    if (etat.analyse?.tache === oubli) {
      etat.analyse = undefined;
      $('#analyse-res').innerHTML = '<p class="vide">Analyse retirée. Relancez-la si besoin.</p>';
    }
  });

  $('#btn-analyse').addEventListener('click', () => {
    const doc = docActif();
    if (!doc) return;
    $('#analyse-res').innerHTML = '<p class="vide">Analyse en cours…</p>';
    executeur.lancer<ResultatAnalyse>('sequence/analyse', {
      brut: sequenceCourante(doc),
      fenetreGC: Number(($('#fenetre-gc') as HTMLInputElement).value) || 50,
      orfMinAA: Number(($('#orf-min') as HTMLInputElement).value) || 30
    }, {
      libelle: `Analyse — ${doc.nom}`,
      surFin: (t) => {
        if (t.resultat) { etat.analyse = {tache: t.id, resultat: t.resultat}; rendreAnalyse(t.resultat); }
        else $('#analyse-res').innerHTML = `<p class="err">${ech(t.erreur ?? 'aucun résultat')}</p>`;
      }
    });
  });

  $('#btn-amorces').addEventListener('click', () => {
    const doc = docActif();
    if (!doc) return;
    const seq = sequenceCourante(doc);
    const val = (id: string) => Number(($(id) as HTMLInputElement).value);
    const params = {
      seq,
      ampliconMin: val('#amp-min'), ampliconMax: val('#amp-max'),
      tmMin: val('#tm-min'), tmMax: val('#tm-max'),
      tmOptimale: (val('#tm-min') + val('#tm-max')) / 2,
      longMin: val('#lg-min'), longMax: val('#lg-max'),
      sonde: ($('#opt-sonde') as HTMLInputElement).checked,
      sondeTmMin: val('#sonde-tm-min'), sondeTmMax: val('#sonde-tm-max'),
      sondeTmOptimale: (val('#sonde-tm-min') + val('#sonde-tm-max')) / 2,
      sondeLongMin: val('#sonde-lg-min'), sondeLongMax: val('#sonde-lg-max'),
      sondeDistanceMax: val('#sonde-dist')
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
