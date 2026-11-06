/**
 * Pyr news by email (Ames 2026-11-05): very occasional news, asked, never
 * assumed. The server (functions/blog-mail.js, ewBlogMail) keeps each
 * player's answer and puts a yes on the list in Resend, by the email they
 * sign in with. Asked in four places, and each player answers once:
 *   - the Request beta access form (a box, unticked),
 *   - a card on their first visit (PyrNewsCard.vue),
 *   - a bell a few minutes after the Five Days Achievement, for anyone who
 *     closed the card without answering (AchievementToast.vue),
 *   - Settings, where they can join or leave any time.
 */
import { secureWrite } from './secure_write';

export type NewsFrom = 'card' | 'bell' | 'beta' | 'settings';
export interface NewsStatus { answer: 'yes' | 'no' | null; onList: boolean }

let cached: Promise<NewsStatus> | null = null;

/** Their answer and whether they are on the list. Asked once a page load. */
export function newsStatus(fresh = false): Promise<NewsStatus> {
  if (!cached || fresh) {
    cached = secureWrite<NewsStatus>('news.status');
    cached.catch(() => { cached = null; });
  }
  return cached;
}

export async function answerNews(yes: boolean, from: NewsFrom, name?: string): Promise<NewsStatus> {
  const r = await secureWrite<NewsStatus>('news.answer', { yes, from, ...(name ? { name } : {}) });
  cached = Promise.resolve(r);
  return r;
}

/** After the Five Days Achievement. The server sends the bell a few minutes
 *  later, once, and only to someone who has not answered. */
export function askAfterFiveDays() {
  secureWrite('news.bell').catch(() => { /* the card or Settings can still ask */ });
}

/** The bell's own marker, in its text: its Yes and No thanks buttons. */
export const NEWS_MARK = /\s*#nge-pyr-news\b/;
export const NEWS_LINE = "Very occasional news from Pyr by email: new datasets, events and ways to help. We'll never share your information.";
