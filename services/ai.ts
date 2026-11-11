// Análise da foto no Amazon Bedrock pela API Converse (bedrock-runtime): uma
// chamada, resposta forçada numa ferramenta com JSON Schema → cor da via, tipos
// de agarra, ângulo e estilo. Sem caixas das agarras: testado em foto real, os
// modelos erram a posição (ver README). Converse é igual para qualquer modelo,
// então trocar Claude por Nova é só mudar AI_MODEL.
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { AI_MODEL } from './common.ts';

export const COLORS = ['green', 'purple', 'yellow', 'white', 'wood', 'red', 'blue', 'black', 'orange', 'pink', 'other'] as const;
export const HOLD_TYPES = ['crimp', 'sloper', 'jug', 'pinch', 'pocket', 'volume', 'edge'] as const;
export const WALL_ANGLES = ['slab', 'vertical', 'overhang', 'roof'] as const;
export const STYLE_TAGS = ['dynamic', 'static', 'compression', 'balance', 'power', 'technical', 'coordination', 'heel_hook', 'toe_hook', 'mantle'] as const;

export interface AiResult {
  color: (typeof COLORS)[number];
  holds: { x: number; y: number; w: number; h: number }[];
  holdTypes: (typeof HOLD_TYPES)[number][];
  wallAngle: (typeof WALL_ANGLES)[number];
  styleTags: (typeof STYLE_TAGS)[number][];
}

const SCHEMA = {
  type: 'object',
  required: ['color', 'holdTypes', 'wallAngle', 'styleTags'],
  properties: {
    color: { type: 'string', enum: COLORS, description: 'Color of the marked hold.' },
    holdTypes: { type: 'array', items: { type: 'string', enum: HOLD_TYPES } },
    wallAngle: { type: 'string', enum: WALL_ANGLES },
    styleTags: { type: 'array', maxItems: 3, items: { type: 'string', enum: STYLE_TAGS } },
  },
};

const SYSTEM = `You analyze photos of indoor bouldering walls for a climber's training log.
In a gym, every boulder problem is set with holds of a single color; walls contain many problems of different colors.
The user tells you the color of the problem they climbed (detected on their phone from the hold they tapped) and roughly where that hold is.
Call the "report" tool with:
- color: the problem's color. Keep the given color unless the photo clearly shows otherwise ("wood" = natural/unpainted wood).
- holdTypes: the distinct hold types of the holds of THAT color (they form the problem). Ignore holds of other colors.
- wallAngle: the wall angle where the problem is.
- styleTags: up to 3 tags for the movement style the problem likely demands.`;

let client: BedrockRuntimeClient | undefined;

const clamp = (n: unknown) => Math.min(1, Math.max(0, Number(n) || 0));

/** Remove o que o modelo devolveu fora do formato esperado (confiança zero na saída). */
export function sanitizeAi(raw: unknown): AiResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  const pick = <T extends readonly string[]>(list: T, v: unknown, fb: T[number]) => (list.includes(v as string) ? (v as T[number]) : fb);
  const many = <T extends readonly string[]>(list: T, v: unknown, max: number) =>
    [...new Set((Array.isArray(v) ? v : []).filter((x) => list.includes(x)))].slice(0, max) as T[number][];
  const holds = (Array.isArray(r.holds) ? r.holds : []).slice(0, 40).map((h: Record<string, unknown>) => ({
    x: clamp(h?.x), y: clamp(h?.y), w: clamp(h?.w), h: clamp(h?.h),
  })).filter((h) => h.w > 0 && h.h > 0);
  return {
    color: pick(COLORS, r.color, 'other'),
    holds,
    holdTypes: many(HOLD_TYPES, r.holdTypes, HOLD_TYPES.length),
    wallAngle: pick(WALL_ANGLES, r.wallAngle, 'vertical'),
    styleTags: many(STYLE_TAGS, r.styleTags, 3),
  };
}

interface Options { color?: string; tap?: { x: number; y: number }; model?: string }

export async function analyzePhoto(image: Buffer, mediaType: 'image/webp' | 'image/jpeg' | 'image/png', { color, tap, model = AI_MODEL }: Options = {}): Promise<AiResult> {
  client ??= new BedrockRuntimeClient({});
  // A cor vem do detector local (toque no celular), que acerta mais que o modelo lendo coordenadas.
  const where = [
    color && color !== 'other' ? `The problem's holds are ${color.toUpperCase()}.` : 'The color was not detected; infer it from the tapped hold.',
    tap ? `The tapped hold is near x=${tap.x.toFixed(2)}, y=${tap.y.toFixed(2)} (normalized, origin top-left).` : '',
  ].join(' ');
  const out = await client.send(new ConverseCommand({
    modelId: model,
    system: [{ text: SYSTEM }],
    messages: [{
      role: 'user',
      content: [
        { image: { format: mediaType.split('/')[1] as 'webp' | 'jpeg' | 'png', source: { bytes: image } } },
        { text: where },
      ],
    }],
    inferenceConfig: { maxTokens: 2000, temperature: 0 },
    toolConfig: {
      tools: [{ toolSpec: { name: 'report', description: 'Report the analysis of the marked boulder problem.', inputSchema: { json: SCHEMA as never } } }],
      toolChoice: { tool: { name: 'report' } },
    },
  }));
  const use = out.output?.message?.content?.find((b) => b.toolUse)?.toolUse;
  if (!use) throw Object.assign(new Error(`AI_EMPTY ${out.stopReason}`), { status: 502 });
  return sanitizeAi(use.input);
}
