/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEFAULT_INPUT_LANGUAGE: string
  readonly VITE_DEFAULT_OUTPUT_LANGUAGE: string
  readonly VITE_DEFAULT_SECOND_OUTPUT_LANGUAGE: string
  readonly VITE_APP_NAME: string
  readonly VITE_DEFAULT_THEME: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
