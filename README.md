# Boulder Log

Diário de boulder gamificado: sessões, vias com foto e cor detectada pelo toque,
projetos, trilha de graus, XP, sequência semanal, conquistas e evolução.
Tudo serverless na AWS, em `boulder.vsoller.com.br`.

```
CloudFront ─┬─ /*      → S3 (web/, sem framework, ~15 KB gz)
            └─ /api/*  → HTTP API (JWT Cognito) → Lambda services/api.ts → DynamoDB
                                                 ├─ S3 fotos (upload/download assinados)
                                                 └─ Bedrock (análise opcional da foto)
```

| Pasta | O quê |
|---|---|
| `infra/` | CDK: `boulder-stack.ts` (app) e `oidc-stack.ts` (papel do GitHub Actions) |
| `services/` | Lambda única da API e a chamada ao Bedrock (`ai.ts`) |
| `web/src/` | `app.js` (telas), `color.js` (cor da agarra), `stats.js` (evolução e gamificação), `i18n.js` (PT/EN) |
| `tests/` | `npm test`: cor, estatísticas e gamificação |

## Rodar

```sh
npm ci
npm test
npm run cdk:synth          # gera dist/ e o template
```

Deploy: push na `main` → GitHub Actions (OIDC) → `cdk deploy BoulderLog-App`.
Primeira vez (local, uma vez): `npx cdk deploy BoulderLog-Oidc` com `GITHUB_REPO_CLAIM` no `.env`,
depois o secret `AWS_DEPLOY_ROLE_ARN` e a variable `HOSTED_ZONE_ID` no repositório.

## Detecção de agarras (no navegador)

Ao escolher a foto, o app roda o YOLOv8n de [jwlarocque/yolov8n-freeclimbs-detect-2](https://huggingface.co/jwlarocque/yolov8n-freeclimbs-detect-2)
(ONNX, AGPL-3.0, ver `web/models/`) com onnxruntime-web. A cor de cada agarra vem do `color.js` (descontando a
parede em volta e o magnésio) e a via é o grupo de agarras da cor tocada encadeadas a partir dela (`detect.js`).
O runtime (3,7 MB gzip) e o modelo (7 MB) só baixam na primeira foto. ~2–3 s num PC, ~8–10 s num celular médio.

## Termo de uso das fotos

Antes da primeira foto o usuário aceita o termo (`terms.*` em `i18n.js`); a API grava versão e data e recusa
foto sem aceite (`PHOTO_TERMS_VERSION` em `services/api.ts`). Mudou o texto → nova versão → novo aceite.

## IA

Opcional (botão "Analisar com IA"): só tipo de agarra, ângulo e estilo. Usa a API Converse do Bedrock com `AI_MODEL` (padrão Claude Haiku 4.5, `us.anthropic.claude-haiku-4-5-20251001-v1:0`;
trocar por `us.amazon.nova-lite-v1:0` também funciona). Sem acesso, o app segue funcionando e o botão de IA
avisa que está indisponível. Cota: `AI_DAILY_LIMIT` análises por usuário por dia.
