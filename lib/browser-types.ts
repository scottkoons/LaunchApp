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
