export type SpeechResultEvent = {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      [index: number]: { transcript: string };
    };
  };
};
export type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
export type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};
export type ModelDocument = Document & {
  modelContext?: {
    registerTool: (
      tool: {
        name: string;
        title: string;
        description: string;
        inputSchema: Record<string, unknown>;
        annotations: Record<string, boolean>;
        execute: (input: unknown) => Promise<unknown>;
      },
      options: { signal: AbortSignal },
    ) => void | Promise<void>;
  };
};
export function noteInput(input: unknown) {
  if (
    !input ||
    typeof input !== 'object' ||
    !('text' in input) ||
    typeof input.text !== 'string' ||
    !input.text.trim() ||
    input.text.length > 100000
  )
    throw new Error('Provide a nonempty note, up to 100000 characters.');
  return input.text.trim();
}
