/** Le parcours réel : déposer un fichier, regarder, corriger, lancer, exporter.
 *
 *  Ces épreuves tournent sur l'application construite, dans un vrai navigateur.
 *  Elles vérifient aussi la promesse tenue à l'entreprise : rien ne sort du
 *  poste. */
import {expect, test} from '@playwright/test';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromatogrammeJouet} from '../unit/_abif.js';

const BASES =
  'ACGTACGTGGCCAATTCCGGATCGATCGATTACAGGCATCAGCATCAGCATCGACTACGATCAGCATCAGCATCAGCATCAGCTACGATCAGCATCAGC';
const FASTA = `>essai description libre\n${'ACGTACGTAA'.repeat(12)}\n>autre\nTTTTGGGGCCCC\n`;

const dossier = mkdtempSync(join(tmpdir(), 'seqops-'));
const cheminFasta = join(dossier, 'essai.fas');
const cheminAb1 = join(dossier, 'lecture.ab1');
writeFileSync(cheminFasta, FASTA);
writeFileSync(cheminAb1, Buffer.from(chromatogrammeJouet(BASES)));

test.beforeEach(async ({page}) => {
  const erreurs: string[] = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  await page.goto('/');
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

test('une analyse longue peut être arrêtée', async ({page}) => {
  // Une séquence assez grande pour que le balayage dure : c'est le cas d'usage
  // « tester tous les couples possibles » qu'on doit pouvoir interrompre.
  await page.evaluate(() => {
    let x = 3;
    let s = '';
    for (let i = 0; i < 60000; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; s += 'ACGT'[(x >>> 16) & 3]; }
    const f = new File([`>grande\n${s}\n`], 'grande.fas', {type: 'text/plain'});
    return window.seqops!.accepter([f]);
  });
  await expect(page.locator('#liste li')).toContainText('grande.fas');
  await page.click('#btn-amorces');
  await expect(page.locator('#taches .tache')).toContainText('en cours');
  await page.click('#taches button[data-arret]');
  await expect(page.locator('#taches .pastille.warn')).toHaveText('arrêtée', {timeout: 15_000});
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
