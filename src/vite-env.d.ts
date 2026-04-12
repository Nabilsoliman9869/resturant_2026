/// <reference types="vite/client" />

declare const __MAT3AM_VITE_BOOT_STAMP__: string;

interface ImportMetaEnv {
  readonly VITE_XTRA_API: string;
  readonly VITE_NUIT_BASE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
