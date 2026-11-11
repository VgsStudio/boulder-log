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

## IA

Usa `AI_MODEL` (padrão `anthropic.claude-haiku-5-5`) pelo endpoint bedrock-mantle. A conta precisa
de acesso ao modelo no console do Bedrock. Sem acesso, o app segue funcionando e o botão de IA
avisa que está indisponível. Cota: `AI_DAILY_LIMIT` análises por usuário por dia.
