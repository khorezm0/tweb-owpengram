/*
 * Originally from:
 * https://github.com/zhukov/webogram
 * Copyright (C) 2014 Igor Zhukov <igor.beatle@gmail.com>
 * https://github.com/zhukov/webogram/blob/master/LICENSE
 */

import type {TrueDcId} from '@types';
import {BASE_DC_ID} from '@lib/accounts/authKeyFingerprint';

/** The domains of the official deployment - the one the Webogram api credentials below belong to */
const OFFICIAL_MAIN_DOMAINS = ['web.telegram.org', 'webk.telegram.org'];

/**
 * The domains this deployment is served from: `.env`'s `VITE_MAIN_DOMAINS`
 * (comma-separated) over the official ones as the default. Only gates the `t.me`
 * auth sync (telegramMeWebManager): a self-hosted domain stays off `isMainDomain`
 * below, so its own `VITE_API_ID`/`VITE_API_HASH` stay in use.
 */
const envMainDomains = import.meta.env.VITE_MAIN_DOMAINS?.split(',').map((domain) => domain.trim()).filter(Boolean);
export const MAIN_DOMAINS = envMainDomains?.length ? envMainDomains : OFFICIAL_MAIN_DOMAINS;

/**
 * The app's name: the fallback push notification's title (push.ts) - the page's
 * `<title>` takes the same `.env` var through vite.config's handlebars context.
 * `.env`'s `VITE_APP_TITLE` over the default.
 */
export const APP_TITLE = import.meta.env.VITE_APP_TITLE || 'Telegram Web';

export const DEFAULT_BACKGROUND_SLUG = 'pattern';

const threads = Math.min(4, navigator.hardwareConcurrency ?? 4);

const App = {
  id: +import.meta.env.VITE_API_ID,
  hash: import.meta.env.VITE_API_HASH,
  pushServerKey: import.meta.env.VITE_PUSH_SERVER_KEY,
  version: import.meta.env.VITE_VERSION,
  versionFull: import.meta.env.VITE_VERSION_FULL,
  build: +import.meta.env.VITE_BUILD,
  langPackVersion: +import.meta.env.VITE_LANG_PACK_VERSION,
  langPack: 'webk',
  langPackCode: 'en',
  domains: MAIN_DOMAINS,
  baseDcId: BASE_DC_ID as TrueDcId,
  isMainDomain: OFFICIAL_MAIN_DOMAINS.includes(location.hostname),
  suffix: 'K',
  threads,
  lottieWorkers: threads,
  cryptoWorkers: threads,
  interclientBroadcastChannel: 'tgweb'
};

// * "Telegram WebK 2.2 (681)" - how the app names itself, in the main menu and under Settings
export function getAppVersionText() {
  return `Telegram Web${App.suffix} ${App.version} (${App.build})`;
}

if(App.isMainDomain) { // use Webogram credentials then
  App.id = 2496;
  App.hash = '8da85b0d5bfe62527e5b244c209159c3';
  App.pushServerKey = 'BHEbKOXt-GD8MCTTYiAYT3I5R4MB0epIE7Tbbymj1uR0xJRE_7m27eXTVAC_P19TeZnO9413lRz-0oZ87JRPKPM';
}

export default App;
