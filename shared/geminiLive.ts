import { toGeminiLiveCode } from '../worker/src/languages';

export type GeminiLiveMode = 'transcribe' | 'translate';

/** Live `setup` / `bidiGenerateContentSetup` body. Transcription fields are top-level. */
export function geminiLiveSetup(
  mode: GeminiLiveMode,
  model: string,
  targetLanguage = 'en',
): Record<string, unknown> {
  const modelName = model.startsWith('models/') ? model : `models/${model}`;
  if (mode === 'translate') {
    return {
      model: modelName,
      generationConfig: {
        responseModalities: ['AUDIO'],
        translationConfig: {
          targetLanguageCode: toGeminiLiveCode(targetLanguage),
          echoTargetLanguage: false,
        },
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    };
  }
  return {
    model: modelName,
    generationConfig: { responseModalities: ['TEXT'] },
    inputAudioTranscription: { languageCodes: [] as string[] },
  };
}
