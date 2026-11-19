/* eslint-disable spaced-comment */
/// <reference types="vite/client" />
/// <reference types="vitest" />

interface ImportMetaEnv {
  readonly VITE_API_ID: string;
  readonly VITE_API_HASH: string;
  readonly VITE_VERSION: string;
  readonly VITE_VERSION_FULL: string;
  readonly VITE_BUILD: string;
  readonly VITE_MTPROTO_WORKER: string;
  readonly VITE_MTPROTO_SW: string;
  readonly VITE_MTPROTO_HTTP: string;
  readonly VITE_MTPROTO_HTTP_UPLOAD: string;
  readonly VITE_MTPROTO_AUTO: string;
  readonly VITE_MTPROTO_HAS_HTTP: string;
  readonly VITE_MTPROTO_HAS_WS: string;
  readonly VITE_SAFARI_PROXY_WEBSOCKET: string;
  // self-hosted deployments - see `.env` and `.env.local.example`. Optional: each
  // has the official value as its default in code when absent or empty
  readonly VITE_APP_TITLE?: string;
  readonly VITE_MAIN_DOMAINS?: string;
  readonly VITE_TME_HOSTS?: string;
  readonly VITE_MTPROTO_WS_URL?: string;
  readonly VITE_MTPROTO_HTTP_URL?: string;
  readonly VITE_MTPROTO_RSA_KEYS?: string;
  readonly VITE_API_LAYER?: string;
  // injected via `define` by vite.preview.config.ts; absent in every other build
  readonly VITE_PREVIEW?: boolean;
  // injected via `define` by vite.preview.config.ts when start-preview.sh is
  // invoked with --no-worker; Modes.noWorker honours it without ?noWorker=1.
  readonly VITE_NO_WORKER?: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
