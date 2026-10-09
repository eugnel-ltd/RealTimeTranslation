export interface WorkerEnv {
  AZURE_SPEECH_KEY?: string;
  AZURE_SPEECH_REGION: string;
  AZURE_TRANSLATOR_KEY?: string;
  AZURE_TRANSLATOR_REGION: string;
  GEMINI_API_KEY?: string;
  GEMINI_TRANSLATE_MODEL: string;
  GEMINI_LIVE_TRANSCRIBE_MODEL: string;
  GEMINI_LIVE_TRANSLATE_MODEL: string;
  ANTHROPIC_API_KEY?: string;
  TYPESAFE_API_KEY?: string;
  TYPESAFE_MODEL: string;
  ACCESS_AUD?: string;
  ACCESS_TEAM_DOMAIN: string;
  SKIP_ACCESS_CHECK: string;
  DEFAULT_ANSWER_MODEL: string;
  ASSETS: Fetcher;
}

export function truthy(value: string | undefined): boolean {
  return value === 'true' || value === '1' || value === 'yes';
}
