/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_XTRA_API: string;
  readonly VITE_NUIT_BASE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
