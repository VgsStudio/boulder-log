// Análise da foto com Claude no Amazon Bedrock (bedrock-mantle). Uma chamada,
// saída estruturada em JSON: cor da via, caixas das agarras, tipos, ângulo e estilo.
import { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk';
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

const unit = { type: 'number' };
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['color', 'holds', 'holdTypes', 'wallAngle', 'styleTags'],
  properties: {
    color: { type: 'string', enum: COLORS },
    holds: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['x', 'y', 'w', 'h'], properties: { x: unit, y: unit, w: unit, h: unit } },
    },
    holdTypes: { type: 'array', items: { type: 'string', enum: HOLD_TYPES } },
    wallAngle: { type: 'string', enum: WALL_ANGLES },
    styleTags: { type: 'array', items: { type: 'string', enum: STYLE_TAGS } },
  },
};

const SYSTEM = `You analyze photos of indoor bouldering walls for a climber's training log.
In a gym, every boulder problem is set with holds of a single color; walls contain many problems of different colors.
The user marks one hold of the problem they climbed. Return:
- color: the color of that marked hold (use "wood" for natural/unpainted wood, "other" if none fits).
- holds: bounding boxes of the holds of that same color that plausibly belong to the same problem, normalized 0-1 with origin at the top-left (x, y = top-left corner; w, h = size). Include the marked hold. Omit holds you are unsure about. At most 40.
- holdTypes: the distinct hold types present in that problem.
- wallAngle: the wall angle where the problem is.
- styleTags: up to 3 tags for the movement style the problem likely demands.`;

let client: AnthropicBedrockMantle | undefined;

const clamp = (n: number) => Math.min(1, Math.max(0, Number(n) || 0));

/** Remove o que o modelo devolveu fora do formato esperado (confiança zero na saída). */
export function sanitizeAi(raw: unknown): AiResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  const pick = <T extends readonly string[]>(list: T, v: unknown, fb: T[number]) => (list.includes(v as string) ? (v as T[number]) : fb);
  const many = <T extends readonly string[]>(list: T, v: unknown, max: number) =>
    [...new Set((Array.isArray(v) ? v : []).filter((x) => list.includes(x)))].slice(0, max) as T[number][];
  const holds = (Array.isArray(r.holds) ? r.holds : []).slice(0, 40).map((h: Record<string, number>) => ({
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

export async function analyzePhoto(image: Buffer, mediaType: 'image/webp' | 'image/jpeg', tap?: { x: number; y: number }): Promise<AiResult> {
  client ??= new AnthropicBedrockMantle({ awsRegion: process.env.AWS_REGION ?? 'us-east-1' });
  const where = tap
    ? `The marked hold is at x=${tap.x.toFixed(3)}, y=${tap.y.toFixed(3)} (normalized, origin top-left).`
    : 'No hold was marked; pick the most prominent problem in the center of the photo.';
  const msg = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 4000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: image.toString('base64') } },
        { type: 'text', text: where },
      ],
    }],
  });
  if (msg.stop_reason === 'refusal') throw new Error('AI_REFUSED');
  const text = msg.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') throw new Error('AI_EMPTY');
  return sanitizeAi(JSON.parse(text.text));
}
