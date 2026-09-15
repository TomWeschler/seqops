/** Le parcours réel : déposer un fichier, regarder, corriger, lancer, exporter.
 *
 *  Ces épreuves tournent sur l'application construite, dans un vrai navigateur.
 *  Elles vérifient aussi la promesse tenue à l'entreprise : rien ne sort du
 *  poste. */
import {expect, test} from '@playwright/test';
import type {Page} from '@playwright/test';
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromatogrammeAvecHeterozygotes, chromatogrammeJouet} from '../unit/_abif.js';

const BASES =
  'ACGTACGTGGCCAATTCCGGATCGATCGATTACAGGCATCAGCATCAGCATCGACTACGATCAGCATCAGCATCAGCATCAGCTACGATCAGCATCAGC';
const FASTA = `>essai description libre\n${'ACGTACGTAA'.repeat(12)}\n>autre\nTTTTGGGGCCCC\n`;

const dossier = mkdtempSync(join(tmpdir(), 'seqops-'));
const cheminFasta = join(dossier, 'essai.fas');
const cheminAb1 = join(dossier, 'lecture.ab1');
writeFileSync(cheminFasta, FASTA);
writeFileSync(cheminAb1, Buffer.from(chromatogrammeJouet(BASES)));

// Un chromatogramme qui porte des ambiguïtés en son milieu, là où l'écrêtage
// ne les emportera pas.
const AMBIGU = BASES.split('');
for (const p of [40, 55, 70]) AMBIGU[p] = 'N';
const cheminAmbigu = join(dossier, 'ambigu.ab1');
writeFileSync(cheminAmbigu, Buffer.from(chromatogrammeJouet(AMBIGU.join(''))));

// Un chromatogramme porteur de vrais hétérozygotes : une seconde trace qui
// culmine au même endroit que la première, comme sur un échantillon
// hétérozygote réel.
const cheminHetero = join(dossier, 'hetero.ab1');
writeFileSync(cheminHetero, Buffer.from(chromatogrammeAvecHeterozygotes(BASES, [30, 45], 0.6)));

/** Le premier chargement se recharge une fois : le service worker de
 *  public/isolation.js doit prendre la main pour rétablir COOP/COEP. Toute
 *  interaction lancée avant ce rechargement est coupée par la navigation — ce
 *  n'est pas un défaut, c'est la vie de la page. On attend donc que l'isolation
 *  soit acquise avant de commencer quoi que ce soit, une fois pour toutes les
 *  épreuves. */
async function pageStable(page: Page): Promise<void> {
  await expect.poll(async () => {
    try { return await page.evaluate(() => globalThis.crossOriginIsolated); }
    catch { return false; }        // la navigation a détruit le contexte : on repasse
  }, {timeout: 20_000}).toBe(true);
}

test.beforeEach(async ({page}) => {
  const erreurs: string[] = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  await page.goto('/');
  await pageStable(page);
  await expect(page.locator('h1')).toContainText('seqops');
  (page as unknown as {_erreurs: string[]})._erreurs = erreurs;
});

test.afterEach(async ({page}) => {
  expect((page as unknown as {_erreurs: string[]})._erreurs).toEqual([]);
});

test('un .fas se charge, s’affiche et s’exporte modifié', async ({page}) => {
  await page.setInputFiles('#fichiers', cheminFasta);
  await expect(page.locator('#liste li')).toHaveCount(1);
  await expect(page.locator('#liste li')).toContainText('essai.fas');
  await expect(page.locator('#stats')).toContainText('120');

  // Une modification à la main est annoncée, et repartir du fichier l'efface.
  await page.click('.edition summary');
  await page.fill('#ed-debut', '1');
  await page.fill('#ed-fin', '10');
  await page.fill('#ed-texte', 'GGGG');
  await page.click('#btn-editer');
  await expect(page.locator('#liste li .pastille.warn')).toHaveText('modifié');
  await expect(page.locator('#stats')).toContainText('114');

  const telechargement = page.waitForEvent('download');
  await page.click('#btn-fasta');
  const fichier = await telechargement;
  const flux = await fichier.createReadStream();
  const contenu = (await new Promise<Buffer>((res, rej) => {
    const morceaux: Buffer[] = [];
    flux.on('data', (c) => morceaux.push(c as Buffer));
    flux.on('end', () => res(Buffer.concat(morceaux)));
    flux.on('error', rej);
  })).toString();
  expect(contenu).toContain('>essai description libre');
  expect(contenu.split('\n')[1]).toMatch(/^GGGG/);
  expect(contenu).toContain('>autre');           // l'autre enregistrement est intact

  await page.click('#btn-annuler-edition');
  await expect(page.locator('#stats')).toContainText('120');
});

test('un .ab1 montre son chromatogramme, sa qualité et son écrêtage', async ({page}) => {
  await page.setInputFiles('#fichiers', cheminAb1);
  await expect(page.locator('#meta')).toContainText('échantillon-test');
  await expect(page.locator('#meta')).toContainText('3730xl');
  await expect(page.locator('#meta')).toContainText('Après écrêtage');

  // La toile porte quelque chose : on lit ses pixels plutôt que de croire
  // qu'un appel de dessin suffit.
  const dessine = await page.evaluate(() => {
    const c = document.querySelector('canvas') as HTMLCanvasElement;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let allumes = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) allumes++;
    return allumes;
  });
  expect(dessine).toBeGreaterThan(500);

  // L'écrêtage raccourcit la séquence proposée, et se désactive.
  const avec = await page.locator('#stats').innerText();
  await page.uncheck('#opt-ecreter');
  const sans = await page.locator('#stats').innerText();
  expect(avec).not.toEqual(sans);
});

test('une recherche d’amorces rend compte, aboutit, et s’exporte', async ({page}) => {
  await page.setInputFiles('#fichiers', cheminFasta);
  await page.fill('#amp-min', '60');
  await page.fill('#amp-max', '120');
  await page.click('#btn-amorces');
  await expect(page.locator('#taches .tache')).toHaveCount(1);
  await expect(page.locator('#taches .pastille')).toHaveText(/terminée|arrêtée/, {timeout: 30_000});
  await expect(page.locator('#resultats')).toContainText(/paires|Aucune paire/);

  const telechargement = page.waitForEvent('download');
  await page.click('#btn-rapport-txt');
  expect((await telechargement).suggestedFilename()).toMatch(/_rapport\.txt$/);
});

test('l’isolation d’origine est rétablie, même sans en-têtes du serveur', async ({page}) => {
  // GitHub Pages ne pose pas COOP/COEP ; le service worker de public/isolation.js
  // les ajoute. Sans cette épreuve, on ne saurait qu'il a cessé de marcher le
  // jour où un arrêt de calcul perdrait ses résultats — c'est-à-dire trop tard.
  // pageStable() a déjà attendu le rechargement ; on constate le résultat.
  expect(await page.evaluate(() => globalThis.crossOriginIsolated)).toBe(true);
  expect(await page.evaluate(() => typeof SharedArrayBuffer !== 'undefined')).toBe(true);
  await expect(page.locator('#isolation')).toContainText('isolation d’origine : oui');
});

test('une analyse longue peut être arrêtée', async ({page}) => {
  // Une séquence assez grande pour que le balayage dure : c'est le cas d'usage
  // « tester tous les couples possibles » qu'on doit pouvoir interrompre.
  await page.evaluate(() => {
    let x = 3;
    let s = '';
    for (let i = 0; i < 120000; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; s += 'ACGT'[(x >>> 16) & 3]; }
    const f = new File([`>grande\n${s}\n`], 'grande.fas', {type: 'text/plain'});
    return window.seqops!.accepter([f]);
  });
  await expect(page.locator('#liste li')).toContainText('grande.fas');
  await page.click('#btn-amorces');
  await expect(page.locator('#taches .tache')).toContainText('en cours');
  await page.click('#taches button[data-arret]');
  await expect(page.locator('#taches .pastille.warn')).toHaveText('arrêtée', {timeout: 15_000});
  // Et le point qui fait tout l'intérêt de l'arrêt : ce qui était déjà trouvé
  // est rendu, pas jeté.
  await expect(page.locator('#taches .msg')).toContainText('résultat partiel');
  await expect(page.locator('#resultats')).toContainText('interrompue');
});

test('une analyse terminée se retire par sa croix', async ({page}) => {
  await page.setInputFiles('#fichiers', cheminFasta);
  await page.click('#btn-analyse');
  await expect(page.locator('#taches .pastille')).toHaveText('terminée', {timeout: 30_000});
  await expect(page.locator('#analyse-res')).toContainText('Cadres ouverts');

  // La croix n'apparaît que sur ce qui est fini : on ne perd pas un calcul en cours.
  await expect(page.locator('#taches .croix')).toHaveCount(1);
  await page.click('#taches .croix');
  await expect(page.locator('#taches .tache')).toHaveCount(0);
  // Et ce qu'elle affichait s'en va avec elle.
  await expect(page.locator('#analyse-res')).toContainText('retirée');
});

test('la sonde apparaît dans le résultat quand on la demande', async ({page}) => {
  await page.evaluate(() => {
    let x = 17;
    let s = '';
    for (let i = 0; i < 2500; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; s += 'ACGT'[(x >>> 16) & 3]; }
    const f = new File([`>cible\n${s}\n`], 'cible.fas', {type: 'text/plain'});
    return window.seqops!.accepter([f]);
  });
  await page.check('#opt-sonde');
  await page.fill('#amp-min', '120');
  await page.fill('#amp-max', '400');
  await page.click('#btn-amorces');
  await expect(page.locator('#taches .pastille')).toHaveText(/terminée|arrêtée/, {timeout: 60_000});
  await expect(page.locator('#resultats')).toContainText('sondes candidates', {timeout: 30_000});
  await expect(page.locator('#resultats th', {hasText: 'Sonde'})).toBeVisible();
  const premiere = page.locator('#resultats tbody tr').first();
  await expect(premiere).toContainText('Tm');
  // Près de F OU de R : la sonde se colle à l'une des deux, c'est le contrat.
  await expect(premiere).toContainText(/nt de [FR]/);
});

test('les codes ambigus sont ramenés à N par défaut', async ({page}) => {
  await page.setInputFiles('#fichiers', cheminFasta);
  await expect(page.locator('#opt-ambigus')).toBeChecked();
});

test('chaque analyse a sa section', async ({page}) => {
  await page.setInputFiles('#fichiers', cheminFasta);
  await expect(page.locator('#p-analyse h2')).toHaveText('Analyse de la séquence');
  await expect(page.locator('#p-amorces h2')).toHaveText('Recherche d’amorces');
  await expect(page.locator('#p-analyse #btn-analyse')).toBeVisible();
  await expect(page.locator('#p-amorces #btn-amorces')).toBeVisible();
  await expect(page.locator('#p-amorces #opt-sonde')).toBeVisible();
});

test('les bases s’affichent et se corrigent sous le chromatogramme', async ({page}) => {
  await page.setInputFiles('#fichiers', cheminAb1);
  const ligne = page.locator('#bases-ligne .b');
  await expect(ligne.first()).toBeVisible();
  const combien = await ligne.count();
  expect(combien).toBeGreaterThan(10);
  await expect(page.locator('#palette')).toBeHidden();   // rien de sélectionné, rien à montrer

  // Cliquer une base ouvre la palette, qui dit ce qu'on a sous les yeux.
  const cible = ligne.nth(5);
  const avant = (await cible.innerText()).trim();
  await cible.click();
  await expect(page.locator('#palette')).toBeVisible();
  await expect(page.locator('#palette')).toContainText('du fichier');

  // Corriger par la palette : la base change, et le fichier est dit modifié.
  const remplacante = avant === 'G' ? 'C' : 'G';
  await page.click(`#palette .lettre[data-lettre="${remplacante}"]`);
  await expect(page.locator('#bases-ligne .b').nth(5)).toHaveText(remplacante);
  await expect(page.locator('#liste .pastille.warn')).toHaveText('modifié');
  await expect(page.locator('#bases-ligne .b.edite')).toHaveCount(1);

  // Recliquer la base la désélectionne : la palette se referme vraiment.
  await page.locator('#bases-ligne .b').nth(5).click();
  await expect(page.locator('#palette')).toBeHidden();

  // Et rétablir la rend au fichier.
  await page.locator('#bases-ligne .b').nth(5).click();
  await page.click('#palette [data-lettre="__annuler"]');
  await expect(page.locator('#bases-ligne .b').nth(5)).toHaveText(avant);
  await expect(page.locator('#bases-ligne .b.edite')).toHaveCount(0);
});

test('chaque lettre tombe exactement sous son pic', async ({page}) => {
  // L'alignement ne se vérifie pas à l'œil : on lit les pixels de la toile,
  // on y cherche le sommet du pic de chaque base, et on le compare au centre
  // de la lettre. C'est la seule manière d'empêcher le décalage de revenir.
  await page.setInputFiles('#fichiers', cheminAb1);
  await expect(page.locator('#bases-ligne .b').first()).toBeVisible();

  const mesurer = () => page.evaluate(() => {
    const COULEURS: Record<string, [number, number, number]> = {
      A: [0x4a, 0xde, 0x80], C: [0x38, 0xbd, 0xf8], G: [0xfb, 0xd1, 0x24], T: [0xf8, 0x71, 0x71]
    };
    const toile = document.querySelector('canvas') as HTMLCanvasElement;
    const boiteToile = toile.getBoundingClientRect();
    const dpr = toile.width / toile.clientWidth;
    const image = toile.getContext('2d')!.getImageData(0, 0, toile.width, toile.height);

    /** Colonne (en pixels CSS) où la courbe de cette base culmine, cherchée
     *  autour d'une position attendue.
     *
     *  On ne prend pas « la première colonne la plus haute » : sur un trait
     *  épais et anti-crénelé, ce choix penche systématiquement à gauche et
     *  fabrique un décalage qui n'existe pas. On prend le barycentre des
     *  colonnes du sommet, pondéré par leur hauteur — estimateur symétrique,
     *  donc sans biais. */
    const sommet = (base: string, centreCss: number, rayon: number): number | null => {
      const cible = COULEURS[base];
      if (!cible) return null;
      const colonnes: {x: number; h: number}[] = [];
      for (let dx = -rayon; dx <= rayon; dx++) {
        const xCss = centreCss + dx;
        const xDev = Math.round(xCss * dpr);
        if (xDev < 0 || xDev >= image.width) continue;
        for (let y = 0; y < image.height; y++) {
          const k = (y * image.width + xDev) * 4;
          const proche = Math.abs(image.data[k]! - cible[0]) < 60 &&
                         Math.abs(image.data[k + 1]! - cible[1]) < 60 &&
                         Math.abs(image.data[k + 2]! - cible[2]) < 60 &&
                         image.data[k + 3]! > 120;
          if (proche) { colonnes.push({x: xCss, h: image.height - y}); break; }
        }
      }
      if (!colonnes.length) return null;
      const sommetH = Math.max(...colonnes.map((c) => c.h));
      const retenues = colonnes.filter((c) => c.h >= sommetH - 3);
      const poids = retenues.reduce((s, c) => s + (c.h - (sommetH - 4)), 0);
      if (poids <= 0) return null;
      return retenues.reduce((s, c) => s + c.x * (c.h - (sommetH - 4)), 0) / poids;
    };

    const resultats: {base: string; ecart: number}[] = [];
    // On mesure la LETTRE, pas sa case : la case va jusqu'à mi-chemin des
    // voisines, son centre n'est pas le pic dès que l'écartement est irrégulier.
    const cases = Array.from(document.querySelectorAll('#bases-ligne .b i'));
    const lettreDe = (n: number) => (cases[n]?.textContent ?? '').trim();
    for (const [rang, el] of cases.entries()) {
      const lettre = (el.textContent ?? '').trim();
      if (!'ACGT'.includes(lettre)) continue;
      // Deux bases identiques voisines dessinent deux bosses de la même couleur
      // qui se recouvrent : le « sommet » lu n'est plus celui d'un pic isolé.
      // On ne mesure que ce que la méthode sait mesurer.
      if (lettreDe(rang - 1) === lettre || lettreDe(rang + 1) === lettre) continue;
      const boite = el.getBoundingClientRect();
      const centre = boite.left + boite.width / 2 - boiteToile.left;
      const pic = sommet(lettre, centre, 12);
      if (pic !== null) resultats.push({base: lettre, ecart: Math.abs(pic - centre)});
    }
    return resultats;
  });

  const verdict = (ecarts: {ecart: number}[]) => {
    expect(ecarts.length).toBeGreaterThan(20);
    const moyen = ecarts.reduce((s, e) => s + e.ecart, 0) / ecarts.length;
    // Le sommet lu dans les pixels est celui d'un trait épais et anti-crénelé :
    // il ne tombera jamais exactement sur le centre de la lettre. Ce seuil dit
    // « pas de décalage visible » ; la géométrie exacte est vérifiée plus bas.
    expect(moyen).toBeLessThan(2);
    expect(Math.max(...ecarts.map((e) => e.ecart))).toBeLessThan(4);
  };

  verdict(await mesurer());

  // Et après un changement de taille de fenêtre : la géométrie du tracé dépend
  // de la largeur, la ligne doit la suivre.
  await page.setViewportSize({width: 900, height: 900});
  await page.waitForTimeout(400);
  verdict(await mesurer());

  // La mesure par les pixels bute sur l'épaisseur du trait et son
  // anti-crénelage : elle ne descendra pas sous ~1,5 px, quoi qu'on fasse. On
  // vérifie donc aussi la géométrie elle-même, en comparant la lettre à la
  // position que le tracé DONNE au pic — là, l'écart doit être nul à un
  // arrondi près.
  const geometrie = await page.evaluate(() => {
    const doc = window.seqops!.etat.docs[0]!;
    const vue = window.seqops!.etat.vue;
    const toile = document.querySelector('canvas') as HTMLCanvasElement;
    const L = toile.clientWidth;
    const pics = doc.abif!.pics;
    const premiere = vue.premiere;
    const combien = Math.min(vue.combien, pics.length - premiere);
    const derniere = premiere + combien - 1;
    const xDebut = pics[premiere]!;
    const etendue = Math.max(1, pics[derniere]! - xDebut);
    const enX = (e: number) => ((e - xDebut) / etendue) * (L - 16) + 8;
    // Origine du repère du tracé : le bord de 1 px n'en fait pas partie.
    const origine = toile.getBoundingClientRect().left + 1;
    const ecarts: number[] = [];
    for (const el of Array.from(document.querySelectorAll('#bases-ligne .b i'))) {
      const i = Number((el.parentElement as HTMLElement).dataset.base);
      const r = el.getBoundingClientRect();
      ecarts.push(Math.abs(r.left + r.width / 2 - origine - enX(pics[i]!)));
    }
    return ecarts;
  });
  expect(geometrie.length).toBeGreaterThan(20);
  expect(Math.max(...geometrie)).toBeLessThan(1);
});

test('la prochaine ambiguïté se trouve, se propose et se corrige', async ({page}) => {
  await page.setInputFiles('#fichiers', cheminAmbigu);

  // Le bouton est dans « Lecture », avec le chromatogramme qu'il déplace, et
  // nulle part ailleurs.
  await expect(page.locator('#p-lecture #btn-ambiguite')).toBeVisible();
  await expect(page.locator('#p-sequence #btn-ambiguite')).toHaveCount(0);

  // L'anomalie est annoncée en rouge avant même qu'on la cherche.
  await expect(page.locator('#alerte-sequence .alerte')).toContainText('ambiguës');

  await page.click('#btn-ambiguite');
  const boite = page.locator('#ambiguite');
  await expect(boite).toContainText('de la séquence');
  await expect(boite).toContainText('base');           // le repère du fichier aussi
  await expect(boite).toContainText('pic le plus haut');

  // La lettre proposée est celle du pic dominant, pré-remplie.
  const propose = await page.inputValue('#ambiguite-lettre');
  expect(propose).toMatch(/^[ACGT]$/);

  const ambiguitesAvant = await page.locator('#stats .kpi .rouge').first().innerText();
  await page.click('#btn-ambiguite-appliquer');
  // Une ambiguïté de moins, et la suivante est déjà proposée.
  await expect(page.locator('#stats .kpi .rouge').first()).not.toHaveText(ambiguitesAvant);
  await expect(boite).toContainText('pic le plus haut');

  // Une lettre impossible est refusée, pas interprétée.
  await page.fill('#ambiguite-lettre', 'Z');
  await page.click('#btn-ambiguite-appliquer');
  await expect(boite.locator('.err')).toContainText('IUPAC');
});

test('les pics doubles se cherchent, se parcourent et se corrigent', async ({page}) => {
  await page.setInputFiles('#fichiers', cheminHetero);
  await page.click('#btn-doubles');
  await expect(page.locator('#bilan-doubles')).toContainText('à deux pics');
  await expect(page.locator('#bilan-doubles')).toHaveClass(/rouge/);
  await expect(page.locator('#bases-ligne .b.double')).not.toHaveCount(0);

  await page.click('#btn-double-suivant');
  const boite = page.locator('#ambiguite');
  await expect(boite).toContainText('second pic');
  // Le code proposé décrit LES DEUX bases, pas l'une des deux.
  expect(await page.inputValue('#double-lettre')).toMatch(/^[RYSWKM]$/);

  await page.click('#btn-double-appliquer');
  await expect(page.locator('#liste .pastille.warn')).toHaveText('modifié');
  // La séquence porte maintenant une ambiguïté de plus, annoncée en rouge.
  await expect(page.locator('#alerte-sequence .alerte')).toContainText('ambigu');
});

test('un seuil plus exigeant trouve moins de pics doubles', async ({page}) => {
  await page.setInputFiles('#fichiers', cheminHetero);
  await page.click('#btn-doubles');
  const large = await page.locator('#bilan-doubles').innerText();
  await page.fill('#seuil-double', '90');
  await page.click('#btn-doubles');
  const strict = await page.locator('#bilan-doubles').innerText();
  expect(strict).not.toEqual(large);
  await expect(page.locator('#bilan-doubles')).toContainText('Aucun second pic');
});

test('les conditions de réaction se règlent et changent les Tm', async ({page}) => {
  // Quatre recherches dans une même épreuve : on prend une cible courte, sinon
  // c'est la patience de l'épreuve qui est mesurée, pas le comportement.
  test.setTimeout(180_000);
  await page.evaluate(() => {
    let x = 23;
    let s = '';
    for (let i = 0; i < 700; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; s += 'ACGT'[(x >>> 16) & 3]; }
    return window.seqops!.accepter([new File([`>cible\n${s}\n`], 'cible.fas', {type: 'text/plain'})]);
  });
  await page.click('#btn-amorces');
  await expect(page.locator('#resultats table')).toBeVisible({timeout: 60_000});
  await expect(page.locator('#resultats th', {hasText: 'ΔG'})).toBeVisible();
  // Autant de cellules que d'en-têtes : une colonne ajoutée sans son titre
  // décale tout le tableau, et ça ne se voit qu'à l'œil — donc jamais.
  const colonnes = await page.locator('#resultats thead th').count();
  const cellules = await page.locator('#resultats tbody tr').first().locator('td').count();
  expect(cellules).toBe(colonnes);

  // Méthode par défaut : ajustée au sel. Le magnésium ne lui dit rien — et
  // c'est pour cela que son champ est éteint.
  // On compare le bloc de résultats entier, et non sa première ligne : quand un
  // réglage déplace les Tm hors de la fenêtre, il n'y a plus AUCUNE ligne — et
  // c'est encore une réponse.
  const auSel = await page.locator('#resultats').innerText();
  await expect(page.locator('#c-mg').locator('xpath=ancestor::div[1]')).toHaveClass(/eteint/);
  await page.fill('#c-mg', '6');
  await page.click('#btn-amorces');
  await expect(page.locator('#taches .tache').first()).toContainText(/terminée|arrêtée/, {timeout: 60_000});
  await page.waitForTimeout(300);
  expect(await page.locator('#resultats').innerText()).toEqual(auSel);

  // Le sodium de cette formule, lui, compte.
  await page.fill('#c-na', '500');
  await page.click('#btn-amorces');
  await expect(page.locator('#taches .tache').first()).toContainText(/terminée|arrêtée/, {timeout: 60_000});
  await page.waitForTimeout(300);
  expect(await page.locator('#resultats').innerText()).not.toEqual(auSel);

  // En plus proche voisin, c'est l'inverse : le magnésium change tout.
  await page.fill('#c-na', '50');
  await page.selectOption('#tm-methode', 'ppv');
  await expect(page.locator('#reglage-na')).toBeHidden();
  await page.fill('#c-mg', '1.5');
  await page.click('#btn-amorces');
  await expect(page.locator('#taches .tache').first()).toContainText(/terminée|arrêtée/, {timeout: 60_000});
  await page.waitForTimeout(300);
  const ppv = await page.locator('#resultats').innerText();
  await page.fill('#c-mg', '6');
  await page.click('#btn-amorces');
  await expect(page.locator('#taches .tache').first()).toContainText(/terminée|arrêtée/, {timeout: 60_000});
  await page.waitForTimeout(300);
  expect(await page.locator('#resultats').innerText()).not.toEqual(ppv);
});

test('les amorces s’exportent en classeur, tout ou ligne à ligne', async ({page}) => {
  await page.evaluate(() => {
    let x = 53;
    let s = '';
    for (let i = 0; i < 1500; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; s += 'ACGT'[(x >>> 16) & 3]; }
    return window.seqops!.accepter([new File([`>cible\n${s}\n`], 'cible.fas', {type: 'text/plain'})]);
  });
  await page.fill('#amp-min', '150');
  await page.fill('#amp-max', '400');
  await page.click('#btn-amorces');
  await expect(page.locator('#resultats table')).toBeVisible({timeout: 60_000});

  // Tout est coché au départ, et le bilan compte les oligonucléotides, pas les paires.
  await expect(page.locator('#bilan-selection')).toContainText('oligonucléotides à commander');
  const lignes = await page.locator('#resultats .choix').count();
  expect(lignes).toBeGreaterThan(1);

  // Tout décocher désarme l'export ; une seule ligne le réarme.
  await page.uncheck('#tout-cocher');
  await expect(page.locator('#bilan-selection')).toContainText('Aucune paire');
  await expect(page.locator('#btn-xlsx')).toBeDisabled();
  await page.locator('#resultats .choix').first().check();
  await expect(page.locator('#bilan-selection')).toContainText('1 paire');
  await expect(page.locator('#btn-xlsx')).toBeEnabled();

  const telechargement = page.waitForEvent('download');
  await page.click('#btn-xlsx');
  const fichier = await telechargement;
  expect(fichier.suggestedFilename()).toMatch(/_design\.xlsx$/);
  const chemin = join(dossier, 'export.xlsx');
  await fichier.saveAs(chemin);
  // Un vrai ZIP, pas un fichier vide déguisé : la signature PK, et la taille.
  const octets = readFileSync(chemin);
  expect(octets.length).toBeGreaterThan(1000);
  expect(octets.subarray(0, 2).toString()).toBe('PK');

  // Le PDF : la signature du format, et la fin de fichier qu'un lecteur cherche.
  const versPdf = page.waitForEvent('download');
  await page.click('#btn-pdf');
  const pdf = await versPdf;
  expect(pdf.suggestedFilename()).toMatch(/_amorces\.pdf$/);
  const cheminPdf = join(dossier, 'export.pdf');
  await pdf.saveAs(cheminPdf);
  const octetsPdf = readFileSync(cheminPdf);
  expect(octetsPdf.subarray(0, 8).toString()).toBe('%PDF-1.4');
  expect(octetsPdf.toString('latin1')).toContain('%%EOF');
  expect(octetsPdf.toString('latin1')).toContain('paire1_F');

  // Le FASTA : ce qu'on dépose chez le fournisseur, et ce qu'on redonne à BLAST.
  const versFas = page.waitForEvent('download');
  await page.click('#btn-fas');
  const fas = await versFas;
  expect(fas.suggestedFilename()).toMatch(/_amorces\.fas$/);
  const cheminFas = join(dossier, 'export.fas');
  await fas.saveAs(cheminFas);
  const texte = readFileSync(cheminFas, 'utf-8');
  expect(texte.startsWith('>paire1_F ')).toBe(true);
  expect(texte).toMatch(/^[ACGT]+$/m);
});

test('le bouton NCBI prépare le FASTA et n’ouvre l’onglet que sur clic', async ({page}) => {
  // window.open est remplacé : l'épreuve doit prouver ce que l'outil DEMANDE,
  // sans jamais joindre le NCBI — et sans dépendre du réseau.
  await page.addInitScript(() => {
    (window as unknown as {ouvertures: string[]}).ouvertures = [];
    window.open = ((url: string) => {
      (window as unknown as {ouvertures: string[]}).ouvertures.push(String(url));
      return null;
    }) as typeof window.open;
  });
  const sortants: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).origin !== 'http://127.0.0.1:4173') sortants.push(r.url());
  });
  await page.reload();
  await page.evaluate(() => {
    let x = 53;
    let s = '';
    for (let i = 0; i < 1500; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; s += 'ACGT'[(x >>> 16) & 3]; }
    return window.seqops!.accepter([new File([`>cible\n${s}\n`], 'cible.fas', {type: 'text/plain'})]);
  });
  await page.fill('#amp-min', '150');
  await page.fill('#amp-max', '400');
  await page.click('#btn-amorces');
  await expect(page.locator('#resultats table')).toBeVisible({timeout: 60_000});

  // Rien ne part tant qu'on n'a pas cliqué, et le bouton suit la sélection.
  const ouvertures = () => page.evaluate(() => (window as unknown as {ouvertures: string[]}).ouvertures);
  expect(await ouvertures()).toEqual([]);
  await page.uncheck('#tout-cocher');
  await expect(page.locator('#btn-blast')).toBeDisabled();
  await page.locator('#resultats .choix').first().check();
  await expect(page.locator('#btn-blast')).toBeEnabled();

  await page.click('#btn-blast');
  const [url] = await ouvertures();
  expect(url).toContain('https://blast.ncbi.nlm.nih.gov/Blast.cgi?PROGRAM=blastn');
  expect(url).toContain('&QUERY=');
  // Seule la requête est ajoutée : les réglages de la page restent ceux du NCBI.
  expect(url).not.toContain('DATABASE=');
  const requete = decodeURIComponent((url as string).split('&QUERY=')[1] as string);
  expect(requete).toContain('>paire1_F');
  // Le FASTA reste lisible dans la page, pour qui doit le coller à la main.
  await expect(page.locator('#blast-texte')).toContainText('>paire1_F');
  // Et le piège du réglage par défaut est écrit : en megablast, un oligo de
  // vingt bases ne ressort pas, et le NCBI ne dit pas pourquoi.
  await expect(page.locator('#conseil-blast')).toContainText('Word size');
  await expect(page.locator('#conseil-blast')).toContainText('28 bases');
  // Et la page elle-même n'a toujours joint personne.
  expect(sortants).toEqual([]);
});

/** Le fichier tel que le NCBI le rend : des commentaires « # Query » qui
 *  portent nos noms, puis les lignes d'alignement. */
const HIT_TABLE = [
  '# blastn',
  '# Query: lcl|Query_1 paire1_F 100..121',
  '# Fields: query acc.ver, subject acc.ver, % identity, alignment length, mismatches, gap opens, q. start, q. end, s. start, s. end, evalue, bit score',
  '# 2 hits found',
  'Query_1\tNG_012246.1\t100.000\t30\t0\t0\t1\t22\t1\t22\t1e-06\t44.1',
  'Query_1\tXM_099999.1\t100.000\t12\t0\t0\t1\t12\t5\t16\t433\t24.3',
  '# Query: lcl|Query_2 paire1_R 300..321',
  '# 0 hits found',
  ''
].join('\n');
const cheminBlast = join(dossier, 'hit-table.txt');
writeFileSync(cheminBlast, HIT_TABLE);

test('les résultats BLAST se rapprochent des paires par leur nom', async ({page}) => {
  await page.evaluate(() => {
    let x = 53;
    let s = '';
    for (let i = 0; i < 1500; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; s += 'ACGT'[(x >>> 16) & 3]; }
    return window.seqops!.accepter([new File([`>cible\n${s}\n`], 'cible.fas', {type: 'text/plain'})]);
  });
  await page.fill('#amp-min', '150');
  await page.fill('#amp-max', '400');
  await page.click('#btn-amorces');
  await expect(page.locator('#resultats table')).toBeVisible({timeout: 60_000});

  // Les noms sont les mêmes des deux côtés : c'est eux qui font le lien.
  await expect(page.locator('#resultats .nom-oligo').first()).toHaveText('paire1_F');
  // Pas de colonne BLAST tant que rien n'est importé.
  await expect(page.locator('#resultats th', {hasText: 'BLAST'})).toHaveCount(0);

  await page.setInputFiles('#fichier-blast', cheminBlast);
  await expect(page.locator('#resultats th', {hasText: 'BLAST'})).toHaveCount(1);
  await expect(page.locator('#resultats')).toContainText('2 oligonucléotides reconnus');

  // paire1_F : un seul alignement couvre tout l'oligonucléotide (l'autre fait
  // douze bases et n'amorce rien) ; paire1_R : cherchée, aucun site ; la sonde
  // n'était pas dans le fichier, d'où le point.
  const premiere = page.locator('#resultats tbody tr').first();
  await expect(premiere.locator('td').nth(10)).toHaveText(/F 1/);
  await expect(premiere.locator('td').nth(10)).toHaveText(/R 0/);
  await expect(premiere.locator('td').nth(10)).toHaveText(/S ·/);

  // Une colonne de plus dans le tableau, et autant d'en-têtes que de cellules.
  const enTetes = await page.locator('#resultats thead th').count();
  const cellules = await premiere.locator('td').count();
  expect(cellules).toBe(enTetes);

  // Relancer une recherche oublie le rapprochement : les numéros de paires
  // changeraient, et le rapprochement deviendrait faux sans prévenir.
  await page.click('#btn-amorces');
  await expect(page.locator('#resultats table')).toBeVisible({timeout: 60_000});
  await expect(page.locator('#resultats th', {hasText: 'BLAST'})).toHaveCount(0);
});

test('un fichier BLAST sans nos noms le dit, au lieu de laisser croire à zéro site', async ({page}) => {
  const anonyme = join(dossier, 'anonyme.csv');
  writeFileSync(anonyme, 'Query_276890,NG_012246.1,100.000,25,0,0,1,25,1,25,1e-06,50.1\n');
  await page.evaluate(() => {
    let x = 53;
    let s = '';
    for (let i = 0; i < 1500; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; s += 'ACGT'[(x >>> 16) & 3]; }
    return window.seqops!.accepter([new File([`>cible\n${s}\n`], 'cible.fas', {type: 'text/plain'})]);
  });
  await page.fill('#amp-min', '150');
  await page.fill('#amp-max', '400');
  await page.click('#btn-amorces');
  await expect(page.locator('#resultats table')).toBeVisible({timeout: 60_000});
  await page.setInputFiles('#fichier-blast', anonyme);
  await expect(page.locator('#resultats .err')).toContainText('Aucun nom d’oligonucléotide reconnu');
  await expect(page.locator('#resultats th', {hasText: 'BLAST'})).toHaveCount(0);
});

test('la spécificité est vérifiée sur les autres fichiers ouverts', async ({page}) => {
  // Deux fois la même séquence : chaque amorce s'hybride forcément deux fois.
  // C'est le cas du paralogue, et aucune paire ne doit passer.
  await page.evaluate(() => {
    let x = 41;
    let s = '';
    for (let i = 0; i < 1200; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; s += 'ACGT'[(x >>> 16) & 3]; }
    return window.seqops!.accepter([
      new File([`>cible\n${s}\n`], 'cible.fas', {type: 'text/plain'}),
      new File([`>paralogue\n${s}\n`], 'paralogue.fas', {type: 'text/plain'})
    ]);
  });
  // Le fichier actif est le dernier chargé ; on revient sur la cible.
  await page.locator('#liste li').first().click();
  await expect(page.locator('#spec-cibles')).toContainText('paralogue.fas');

  await page.fill('#amp-min', '150');
  await page.fill('#amp-max', '400');
  await page.click('#btn-amorces');
  await expect(page.locator('#taches .tache').first()).toContainText(/terminée|arrêtée/, {timeout: 60_000});
  await expect(page.locator('#resultats')).toContainText('manque de spécificité');

  // Sans l'exigence, les paires reviennent — avec leur défaut affiché en rouge.
  await page.uncheck('#spec-exiger');
  await page.click('#btn-amorces');
  await expect(page.locator('#resultats table')).toBeVisible({timeout: 60_000});
  await expect(page.locator('#resultats tbody tr').first()).toContainText('parasite');
  await expect(page.locator('#resultats .rouge').first()).toBeVisible();
});

test('les valeurs par défaut sont celles du laboratoire', async ({page}) => {
  await page.setInputFiles('#fichiers', cheminFasta);
  const attendu: Record<string, string> = {
    '#tm-min': '59', '#tm-max': '61',
    '#lg-min': '18', '#lg-max': '22',
    '#amp-min': '70', '#amp-max': '200',
    '#gc-min': '40', '#gc-max': '60',
    '#sonde-tm-min': '69', '#sonde-tm-max': '71',
    '#sonde-lg-min': '18', '#sonde-lg-max': '32',
    '#rep-max': '4', '#rep-g-max': '4', '#pince-max': '3',
    '#auto-max': '4', '#epingle-max': '3', '#apparie3-max': '3'
  };
  for (const [champ, valeur] of Object.entries(attendu)) {
    await expect(page.locator(champ)).toHaveValue(valeur);
  }
  await expect(page.locator('#fin3-gc')).toBeChecked();
  // La qPCR est le cas courant du laboratoire : la sonde est demandée d'emblée.
  await expect(page.locator('#opt-sonde')).toBeChecked();
  // La sonde a ses propres seuils de forme : trois G d'affilée au plus, là où
  // une amorce en tolère quatre, et l'auto-complémentarité d'OligoCalc.
  for (const [champ, valeur] of Object.entries({
    '#sonde-rep-g-max': '3', '#sonde-pince-max': '3',
    '#sonde-auto-max': '4', '#sonde-epingle-max': '3', '#sonde-apparie3-max': '3'
  })) {
    await expect(page.locator(champ)).toHaveValue(valeur);
  }
  // La Tm ajustée au sel est la méthode par défaut, et son champ est visible.
  await expect(page.locator('#tm-methode')).toHaveValue('sel');
  await expect(page.locator('#reglage-na')).toBeVisible();
});

test('le score s’explique au survol, en phrases', async ({page}) => {
  await page.evaluate(() => {
    let x = 89;
    let s = '';
    for (let i = 0; i < 1200; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; s += 'ACGT'[(x >>> 16) & 3]; }
    return window.seqops!.accepter([new File([`>cible\n${s}\n`], 'cible.fas', {type: 'text/plain'})]);
  });
  await page.click('#btn-amorces');
  await expect(page.locator('#resultats table')).toBeVisible({timeout: 60_000});

  const bulle = page.locator('#infobulle');
  await expect(bulle).toBeHidden();
  await page.locator('#resultats td.score').first().hover();
  await expect(bulle).toBeVisible();

  // Ce qu'on veut lire : le sens du score, puis des phrases — pas une colonne
  // de nombres nus.
  await expect(bulle).toContainText('plus il est bas, mieux c’est');
  await expect(bulle).toContainText('classe');
  const lignes = bulle.locator('li');
  expect(await lignes.count()).toBeGreaterThan(0);
  const premiere = await lignes.first().innerText();
  expect(premiere.length).toBeGreaterThan(30);        // une phrase, pas un chiffre
  expect(premiere).toMatch(/\+\d/);                   // et sa contribution

  // Elle s'efface dès qu'on la quitte.
  await page.locator('#p-amorces h2').hover();
  await expect(bulle).toBeHidden();

  // Et elle s'atteint au clavier, pour qui ne survole pas.
  await page.locator('#resultats td.score').first().focus();
  await expect(bulle).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(bulle).toBeHidden();
});

test('les colonnes portent les noms du métier', async ({page}) => {
  await page.evaluate(() => {
    let x = 67;
    let s = '';
    for (let i = 0; i < 1200; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; s += 'ACGT'[(x >>> 16) & 3]; }
    return window.seqops!.accepter([new File([`>cible\n${s}\n`], 'cible.fas', {type: 'text/plain'})]);
  });
  await page.click('#btn-amorces');
  await expect(page.locator('#resultats table')).toBeVisible({timeout: 60_000});
  await expect(page.locator('#resultats th').nth(2)).toHaveText('Amorce Forward 5′-3′');
  await expect(page.locator('#resultats th').nth(3)).toHaveText('Amorce Reverse 5′-3′');
});

test('les réglages d’amorces sont rangés, la sonde s’éteint quand on ne la veut pas', async ({page}) => {
  await page.setInputFiles('#fichiers', cheminFasta);
  await expect(page.locator('#p-amorces fieldset')).toHaveCount(5);
  // La sonde suit immédiatement la forme des amorces : les deux blocs portent
  // les mêmes règles, on doit pouvoir les comparer sans faire défiler.
  await expect(page.locator('#p-amorces legend').first()).toHaveText('Amorces');
  await expect(page.locator('#p-amorces legend').nth(1)).toHaveText('Forme des amorces');
  await expect(page.locator('#p-amorces legend').nth(2)).toHaveText('Sonde (qPCR)');
  await expect(page.locator('#p-amorces legend').nth(3)).toHaveText('Réaction');
  await expect(page.locator('#p-amorces legend').nth(4)).toHaveText('Spécificité');
  // L'auto-complémentarité se règle des deux côtés, sous le même intitulé.
  await expect(page.locator('#p-amorces .sous-titre', {hasText: 'Auto-complémentarité'}))
    .toHaveCount(2);
  for (const champ of ['#sonde-auto-max', '#sonde-epingle-max', '#sonde-apparie3-max',
                       '#sonde-rep-g-max', '#sonde-pince-max']) {
    await expect(page.locator(`#bloc-sonde ${champ}`)).toBeVisible();
  }
  // Cochée par défaut, donc allumée ; décocher l'éteint, recocher la rallume.
  await expect(page.locator('#bloc-sonde')).not.toHaveClass(/eteint/);
  await expect(page.locator('#sonde-dist')).toHaveValue('1');
  await page.uncheck('#opt-sonde');
  await expect(page.locator('#bloc-sonde')).toHaveClass(/eteint/);
  await page.check('#opt-sonde');
  await expect(page.locator('#bloc-sonde')).not.toHaveClass(/eteint/);
  // La phrase explicative a été retirée : elle n'a pas à revenir.
  await expect(page.locator('#p-amorces')).not.toContainText('fluorophore');
});

test('rien ne sort du poste', async ({page}) => {
  const sortants: string[] = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.origin !== 'http://127.0.0.1:4173') sortants.push(r.url());
  });
  await page.setInputFiles('#fichiers', [cheminFasta, cheminAb1]);
  await page.click('#btn-analyse');
  await expect(page.locator('#taches .pastille')).toHaveText(/terminée/, {timeout: 30_000});
  expect(sortants).toEqual([]);
});
