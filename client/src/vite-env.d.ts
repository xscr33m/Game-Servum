/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API base URL for dashboard development (e.g. "http://localhost:3001/api") */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
