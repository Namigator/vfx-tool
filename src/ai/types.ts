export type AiConnection = {
  provider: 'openai' | 'anthropic' | 'gemini';
  baseUrl: string; model: string; apiKey?: string; vision: boolean;
};
export type AiMessage = { role: 'user' | 'assistant'; text: string; images?: string[] };
export type AiRequest = { connection: AiConnection; system: string; messages: AiMessage[]; maxTokens: number; guideTopics?: string[] };
export type AiReply = { text: string; usage?: { inputTokens: number; outputTokens: number } };
export type AiFrame = { tick: number; image: string };
