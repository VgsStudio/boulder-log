// Clientes AWS e helpers HTTP compartilhados (padrão do serverless-selfie-sbg).
import { randomBytes } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';

export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
export const s3 = new S3Client({});

const env = (name: string, fallback: string) => process.env[name] ?? fallback;
export const TABLE = env('TABLE_NAME', 'test-table');
export const PHOTO_BUCKET = env('PHOTO_BUCKET', 'test-photos');
/** Endereços do site (o app responde em mais de um domínio). */
export const ALLOWED_ORIGINS = env('ALLOWED_ORIGIN', 'https://localhost').split(',');
export const AI_MODEL = env('AI_MODEL', 'us.anthropic.claude-haiku-4-5-20251001-v1:0');
export const AI_DAILY_LIMIT = Number(env('AI_DAILY_LIMIT', '20'));

/** ID ordenável pelo tempo (base36 do ms + aleatório): a ordem do sk já é cronológica. */
export const newId = () => Date.now().toString(36).padStart(9, '0') + randomBytes(5).toString('hex');
export const ID_RE = /^[a-z0-9]{19}$/;
export const nowIso = () => new Date().toISOString();

export interface HttpEvent {
  routeKey: string;
  headers: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
  pathParameters?: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined>;
  requestContext: {
    requestId: string;
    http: { method: string };
    authorizer?: { jwt?: { claims?: Record<string, string> } };
  };
}

export interface HttpResult { statusCode: number; headers: Record<string, string>; body: string }

export const json = (statusCode: number, body: unknown): HttpResult => ({
  statusCode,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  body: JSON.stringify(body),
});

export class HttpError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

export function parseBody(event: HttpEvent): Record<string, unknown> {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    throw new HttpError(400, 'BAD_JSON');
  }
}

/** Log estruturado. Nunca passar token, URL assinada ou imagem aqui. */
export const log = (msg: string, fields: Record<string, unknown> = {}) => console.log(JSON.stringify({ msg, ...fields }));
