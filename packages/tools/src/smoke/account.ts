// The title's sign-in and character screens (P1.E04.T05, packages/client/src/ui/Account.js) as the online smoke specs
// drive them: their stable hooks are the steps' `data-form`, the actions' `data-do` and the rows' `data-id`.
import type { Page } from '@playwright/test';

export interface Pilot {
  username: string;
  password: string;
  /** the first character's name */
  name: string;
}

/** From the title: Play → create an account → the first character, of `people`, named and made → the account's list,
 * that character picked. */
export async function signUp(page: Page, p: Pilot, people = 'thalune'): Promise<void> {
  await page.click('.title-screen [data-act="start"]');
  await page.click('.acct [data-form="signin"] [data-do="to-register"]');
  await page.fill('.acct [data-form="register"] [name="username"]', p.username);
  await page.fill('.acct [data-form="register"] [name="password"]', p.password);
  await page.click('.acct [data-form="register"] [data-do="register"]');
  // (a new account has no characters: the flow goes straight on to make one)
  await page.fill('.acct [data-form="create"] [name="name"]', p.name);
  await page.click(`.acct [data-form="create"] [data-people] [data-v="${people}"]`);
  await page.click('.acct [data-form="create"] [data-do="create"]');
  await page.waitForSelector('.acct-step:not(.leaving) .acct-char[data-id][aria-selected="true"]');
}

/** From the title of a tab already signed in: Play → the account's list. */
export async function openList(page: Page): Promise<void> {
  await page.click('.title-screen [data-act="start"]');
  await page.waitForSelector('.acct-step:not(.leaving) .acct-char[data-id][aria-selected="true"]');
}

/** Enters the world as the picked character. */
export async function enterPicked(page: Page): Promise<void> {
  await page.click('.acct [data-do="enter"]');
}
