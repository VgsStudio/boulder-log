# Chalkmark

Diário de boulder gamificado: sessões, vias com foto (agarras e cor reconhecidas no próprio celular),
projetos, trilha de graus, XP, sequência semanal, conquistas, amigos e ranking da semana.

- **App:** https://chalkmark.vsoller.com.br. O `boulder.vsoller.com.br` redireciona para ele.
- **Handoff completo** (estado, decisões, operação, pendências): [`docs/HANDOFF.md`](docs/HANDOFF.md)
- **Treino da IA com as fotos:** [`ml/README.md`](ml/README.md)

```
CloudFront ─┬─ /*            → S3 (web/: SPA sem framework + páginas legais)
            ├─ /api/public/* → HTTP API (sem login: boulder compartilhado, cartão de perfil)
            └─ /api/*        → HTTP API (JWT Cognito) → Lambda services/api.ts → DynamoDB (tabela única)
                                                       ├─ S3 fotos (upload/download assinados)
                                                       └─ Bedrock Haiku 4.5 (estilo da via)
Cognito: login na tela do app (e-mail/senha pela API) + Google; e-mails pelo SES (no-reply@vsoller.com.br)
Navegador: detector YOLOv8n (ONNX) num Web Worker; modo sem conta no localStorage/IndexedDB
```

| Pasta | O quê |
|---|---|
| `infra/` | CDK: `boulder-stack.ts` (app inteiro), `oidc-stack.ts` (papel do GitHub Actions), `email-code.html` (e-mail do código) |
| `services/` | `api.ts` (Lambda única da API), `ai.ts` (Bedrock), `presignup.ts` (vincula Google à conta existente), `common.ts` |
| `web/src/` | `app.js` (telas), `detect.js` + `detect-worker.js` (agarras), `color.js` (cor), `stats.js` (evolução e gamificação), `guest.js` (uso sem conta), `i18n.js` (PT/EN), `sound.js` |
| `web/` | `index.html`, ícones, `privacidade.html`, `termos.html`, `email/banner.png`, `models/` |
| `ml/` | export do conjunto de treino (com consentimento) e linha de base de acerto da via |
| `tests/` | `npm test`: cor, agrupamento, estatísticas, gamificação, validação da API |

## Rodar

```sh
npm ci
npm test                 # testes (node:test)
npm run typecheck
node scripts/build-web.mjs   # gera dist/
```

Deploy: push na `main` → GitHub Actions (OIDC, sem access key) → `cdk deploy BoulderLog-App`.
As variáveis do deploy estão em [`docs/HANDOFF.md`](docs/HANDOFF.md#operação).

## Licenças

O código é deste repositório. O detector de agarras é o [jwlarocque/yolov8n-freeclimbs-detect-2](https://huggingface.co/jwlarocque/yolov8n-freeclimbs-detect-2)
(AGPL-3.0, ver `web/models/`).
