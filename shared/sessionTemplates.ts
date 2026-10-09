export const SESSION_TEMPLATE_IDS = [
  'interview-screening',
  'interview-ai-timed',
  'interview-competency',
  'interview-oneway-video',
  'meeting',
] as const;

export type SessionTemplateId = (typeof SESSION_TEMPLATE_IDS)[number];
export type SessionKind = 'interview' | 'meeting';

export const DEFAULT_SESSION_TEMPLATE_ID: SessionTemplateId = 'interview-competency';

export const QUESTION_TIMER_OPTIONS = [60, 120, 180] as const;
export const PREP_TIMER_OPTIONS = [0, 15, 30, 45, 60] as const;

export type SessionTemplate = {
  id: SessionTemplateId;
  label: string;
  shortLabel: string;
  kind: SessionKind;
  description: string;
  /** Auto-detect (Jev) window; existing 30/60 setting still overrides in Settings. */
  defaultAnswerWindowSeconds: 30 | 60;
  /** Generous window for manual Answer now extraction. */
  manualExtractWindowSeconds: number;
  questionLabel: string;
  emptyQuestion: string;
  manualPlaceholder: string;
  prominentManualInput: boolean;
  defaultAutoDetect: boolean;
  maxTokens: number;
  timer: {
    enabled: boolean;
    defaultSeconds: number;
    options: readonly number[];
    prepDefaultSeconds: number;
    prepOptions: readonly number[];
  };
  prompt: {
    role: string;
    answerShape: string;
    extractKnown: string;
    extractUnknown: string;
  };
};

const INTERVIEW_GROUNDING = [
  'Use the candidate profile and notes below. Ground every specific claim there.',
  'Do not invent employers, dates, titles, or metrics.',
  'Do not refuse with hedges such as "I don\'t want to invent specifics" or "I don\'t have enough information".',
  'If a needed fact is truly missing from the profile and notes, keep a usable spoken answer and mark only that fact in a brief bracket like [team size]. Never pad the answer with placeholders.',
].join('\n');

const EXTRACT_FULL_QUESTION = [
  'From the transcript, extract the FULL current interviewer question asked by the other party (not the candidate).',
  'Include all preamble, setup, and every sub-part or follow-on in the same turn.',
  'Err on the side of LONGER. Never truncate, summarise, or drop the opening context.',
  'First line MUST be exactly: <<<QUESTION>>>the full question text<<<END>>>',
  'Then write the candidate answer only. If there is no interview question, output <<<QUESTION>>><<<END>>> and nothing else.',
].join(' ');

/** Add a template here — UI, /api/answer, and defaults all read this list. */
export const SESSION_TEMPLATES: SessionTemplate[] = [
  {
    id: 'interview-screening',
    label: 'Interview: Screening',
    shortLabel: 'Screening',
    kind: 'interview',
    description: 'About 30 minutes. Conversational, concise spoken answers.',
    defaultAnswerWindowSeconds: 60,
    manualExtractWindowSeconds: 120,
    questionLabel: 'Question',
    emptyQuestion: 'Waiting for an interview question…',
    manualPlaceholder: 'Type a question to answer…',
    prominentManualInput: false,
    defaultAutoDetect: true,
    maxTokens: 1024,
    timer: { enabled: false, defaultSeconds: 0, options: QUESTION_TIMER_OPTIONS, prepDefaultSeconds: 0, prepOptions: PREP_TIMER_OPTIONS },
    prompt: {
      role: [
        'You are an interview copilot for a ~30 minute screening call.',
        'Speak as the candidate in a live interview.',
        'Give a confident, concise spoken-style answer the candidate can say aloud immediately.',
        INTERVIEW_GROUNDING,
      ].join('\n'),
      answerShape:
        'Keep answers short and conversational (about 20–45 seconds spoken). A brief example is enough; do not deliver a long STAR essay unless asked.',
      extractKnown:
        'The interview question is already extracted. Answer only that question as the candidate would. Do not repeat the question. Do not add a preamble.',
      extractUnknown: EXTRACT_FULL_QUESTION,
    },
  },
  {
    id: 'interview-ai-timed',
    label: 'Interview: AI / timed format',
    shortLabel: 'AI / timed',
    kind: 'interview',
    description: 'Each question may have a 1–3 minute limit. Keep answers speakable within the timer.',
    defaultAnswerWindowSeconds: 60,
    manualExtractWindowSeconds: 120,
    questionLabel: 'Question',
    emptyQuestion: 'Waiting for an interview question…',
    manualPlaceholder: 'Type a question to answer…',
    prominentManualInput: false,
    defaultAutoDetect: true,
    maxTokens: 1024,
    timer: { enabled: true, defaultSeconds: 120, options: QUESTION_TIMER_OPTIONS, prepDefaultSeconds: 0, prepOptions: [0] },
    prompt: {
      role: [
        'You are an interview copilot for a timed or AI-paced interview.',
        'Speak as the candidate in a live interview.',
        'Give a confident, concise spoken-style answer the candidate can say aloud immediately.',
        INTERVIEW_GROUNDING,
      ].join('\n'),
      answerShape:
        'Each question may have a clock. Keep the spoken answer short enough to finish inside the time limit, with a tight opening and no rambling.',
      extractKnown:
        'The interview question is already extracted. Answer only that question as the candidate would. Do not repeat the question. Do not add a preamble.',
      extractUnknown: EXTRACT_FULL_QUESTION,
    },
  },
  {
    id: 'interview-competency',
    label: 'Interview: General / competency',
    shortLabel: 'Competency',
    kind: 'interview',
    description: 'Behavioural and competency questions. STAR spoken answers.',
    defaultAnswerWindowSeconds: 60,
    manualExtractWindowSeconds: 120,
    questionLabel: 'Question',
    emptyQuestion: 'Waiting for an interview question…',
    manualPlaceholder: 'Type a question to answer…',
    prominentManualInput: false,
    defaultAutoDetect: true,
    maxTokens: 1024,
    timer: { enabled: false, defaultSeconds: 0, options: QUESTION_TIMER_OPTIONS, prepDefaultSeconds: 0, prepOptions: PREP_TIMER_OPTIONS },
    prompt: {
      role: [
        'You are an interview copilot. Speak as the candidate in a live interview.',
        'Give a confident, concise spoken-style answer the candidate can say aloud immediately.',
        INTERVIEW_GROUNDING,
      ].join('\n'),
      answerShape:
        'Behavioural questions: STAR (Situation, Task, Action, Result) in short spoken sentences. Other questions: 3–5 spoken key points.',
      extractKnown:
        'The interview question is already extracted. Answer only that question as the candidate would. Do not repeat the question. Do not add a preamble.',
      extractUnknown: EXTRACT_FULL_QUESTION,
    },
  },
  {
    id: 'interview-oneway-video',
    label: 'Interview: One-way AI video (3 min per question)',
    shortLabel: 'One-way AI video',
    kind: 'interview',
    description:
      'HireVue / Sapia / Willo / Spark Hire style: on-screen question, ~30s prep, up to 3 min recording, one take, no follow-ups.',
    defaultAnswerWindowSeconds: 60,
    manualExtractWindowSeconds: 120,
    questionLabel: 'Question',
    emptyQuestion: 'Paste or type the on-screen question…',
    manualPlaceholder: 'Paste the on-screen question (one-way AI video)…',
    prominentManualInput: true,
    defaultAutoDetect: true,
    maxTokens: 2048,
    timer: {
      enabled: true,
      defaultSeconds: 180,
      options: QUESTION_TIMER_OPTIONS,
      prepDefaultSeconds: 30,
      prepOptions: PREP_TIMER_OPTIONS,
    },
    prompt: {
      role: [
        'You are an interview copilot for a one-way recorded AI video interview (HireVue, Sapia, Willo, Spark Hire style).',
        'The question is often on-screen text (sometimes also read by an avatar). There is usually ~30s–1 min prep, then a fixed recording window (up to 3 minutes). One take, no human follow-ups, typically 3–8 questions.',
        'Speak as the candidate.',
        INTERVIEW_GROUNDING,
      ].join('\n'),
      answerShape: [
        'Size the spoken answer to about 2 to 2.5 minutes (roughly 250–330 words), comfortably inside a 3-minute recording window.',
        'Output format:',
        '1) First lines: 4–8 short keyword bullets the candidate can glance at while speaking (not full sentences).',
        '2) Then the spoken answer: STAR structure, a clear opening line, and a closing summary.',
      ].join('\n'),
      extractKnown:
        'The interview question is already extracted (often pasted from on-screen text). Answer only that question as the candidate would. Do not repeat the question in the spoken answer.',
      extractUnknown: EXTRACT_FULL_QUESTION,
    },
  },
  {
    id: 'meeting',
    label: 'Meeting',
    shortLabel: 'Meeting',
    kind: 'meeting',
    description: 'Not an interview. Summary, suggested reply or points to raise, and action items.',
    defaultAnswerWindowSeconds: 60,
    manualExtractWindowSeconds: 90,
    questionLabel: 'Latest discussion',
    emptyQuestion: 'Waiting for discussion…',
    manualPlaceholder: 'Type a topic or question to brief on…',
    prominentManualInput: false,
    defaultAutoDetect: false,
    maxTokens: 1024,
    timer: { enabled: false, defaultSeconds: 0, options: QUESTION_TIMER_OPTIONS, prepDefaultSeconds: 0, prepOptions: PREP_TIMER_OPTIONS },
    prompt: {
      role: [
        'You are a meeting copilot, not an interview coach. Do not speak as a job candidate.',
        'Use notes and profile only if they are relevant. Do not invent facts, owners, or dates.',
      ].join('\n'),
      answerShape: [
        'From the latest discussion, write:',
        '1) Concise summary',
        '2) Suggested reply or points to raise',
        '3) Action items',
      ].join('\n'),
      extractKnown: 'The topic or ask is already given. Brief on that. Do not add a long preamble.',
      extractUnknown: [
        'From the transcript, identify the latest discussion topic or ask (including preamble and sub-parts). Err on the side of LONGER. Never truncate.',
        'First line MUST be exactly: <<<QUESTION>>>the topic or ask<<<END>>>',
        'Then write the summary, suggested reply, and action items. If there is nothing to brief, output <<<QUESTION>>><<<END>>> and nothing else.',
      ].join(' '),
    },
  },
];

export function isSessionTemplateId(id: string | undefined | null): id is SessionTemplateId {
  return Boolean(id && (SESSION_TEMPLATE_IDS as readonly string[]).includes(id));
}

export function getSessionTemplate(id: string | undefined | null): SessionTemplate {
  return SESSION_TEMPLATES.find((t) => t.id === id) ?? SESSION_TEMPLATES.find((t) => t.id === DEFAULT_SESSION_TEMPLATE_ID)!;
}

export function applyTemplateDefaults(id: string | undefined | null): {
  sessionTemplateId: SessionTemplateId;
  questionTimerSeconds: number;
  prepTimerSeconds: number;
  autoDetect: boolean;
} {
  const t = getSessionTemplate(id);
  return {
    sessionTemplateId: t.id,
    questionTimerSeconds: t.timer.enabled ? t.timer.defaultSeconds : 0,
    prepTimerSeconds: t.timer.enabled ? t.timer.prepDefaultSeconds : 0,
    autoDetect: t.defaultAutoDetect,
  };
}
