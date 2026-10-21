/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GPS_MAX_ACCURACY_M?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
