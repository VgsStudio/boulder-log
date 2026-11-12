# Chalkmark: handoff

Documento para retomar o projeto em outra sessão: o que é, o que existe, por que foi feito assim, como
operar e o que vem depois. Atualizado em 12/11/2026.

> Repositório público: este arquivo não traz IDs de conta, pool, tabela ou bucket. Para achar:
> `aws cloudformation describe-stack-resources --stack-name BoulderLog-App` (região us-east-1).

---

## 1. Produto

App web (PWA, mobile-first) para quem faz boulder indoor registrar a evolução, gamificado no estilo
Duolingo/GymRats. O dono usa com amigos; o cadastro é aberto.

- **Endereço:** https://chalkmark.vsoller.com.br. O `boulder.vsoller.com.br` redireciona no próprio app, mantendo o `#`.
- **Nome e identidade:** "Chalkmark", a marca de giz. A logo é uma agarra lapidada branca, com pó de magnésio, sobre o azul `#2f5bff`. Traços de giz (filtro SVG de turbulência) aparecem nos títulos, na aba ativa, nas barras e no card da sequência.
- **Idiomas e tema:** PT/EN e claro/escuro. Os dois seguem o aparelho e podem ser escolhidos em Ajustes.

### Funcionalidades (todas no ar)

| Área | O que faz |
|---|---|
| **Sessão** | Começa no ginásio (reconhecido por GPS, até 500 m). Registra boulders e encerra com sensação/nota. **Encerra sozinha**: >1 km do ginásio (com o app aberto, a cada 5 min) ou 4 h sem registro. |
| **Registrar boulder** | Foto → detector acha as agarras (Web Worker, não trava a tela) → toque numa agarra = cor + via sugerida. Toque inclui/tira agarra; **segurar** = início (verde) → topo (vermelha) → normal. Pinça amplia só a foto. Cor, grau (V ou Font) e resultado (Flash/Mandou/Projeto). Ao continuar um projeto, o resultado é obrigatório. |
| **Boulder salvo** | Editar cor/grau, **editar agarras** (o detector roda de novo), fixar no perfil (alfinete), compartilhar link, excluir (o projeto inteiro, se for a raiz). Navega com **‹ ›** e arrastando para o lado. Foto abre pela miniatura e troca pela grande. |
| **Projetos** | "Mandei!" / "Tentei de novo" / "A via saiu / desisti". Contador de tentativas não existe (decisão: ninguém atualiza). |
| **Gamificação** | XP por via (grau, flash), nível, sequência semanal (o foguinho explica ao tocar), metas (sessões/semana, grau), trilha de graus (5 mandadas = domina), conquistas, sons e vibração. |
| **Evolução** | Gráficos semanais, pirâmide, KPIs, card "Onde você manda e onde trava" (estilo da IA; avisa quando há menos de 15 boulders analisados). |
| **Histórico** | Calendário, sessões (o mais recente em cima) e galeria filtrável. |
| **Perfil** (aba da direita) | Nome, @, foto, nível, seguidores. **Amigos** ficam dentro (ranking da semana, busca, "talvez você conheça"). Boulder fixado. Galeria com etiqueta **Mandado/Flash/Projeto/Desistido** e filtros. Compartilhar perfil. Volta para a mesma posição da página. |
| **Social** | Seguir sem aprovação. **Amigo = os dois se seguem**. Histórico, fotos e XP só para amigos; o cartão público (nome, @, nível, fixado) é visível para qualquer pessoa com o link, até sem conta. "Quero tentar" copia o boulder de um amigo para os seus projetos. |
| **Compartilhar boulder** | Link `#/s/<token>` (90 dias) com foto, agarras, cor, grau e **nome do ginásio**. Quem recebe adiciona aos próprios projetos. |
| **Login** | Tela própria do app (entrar, criar conta, código por e-mail, esqueci a senha) + **Entrar com Google**. Google com o mesmo e-mail de uma conta existente é **vinculado** a ela (`services/presignup.ts`). Boas-vindas com nome e @ sugeridos na 1ª entrada. |
| **Usar sem conta** | Tudo funciona no navegador (localStorage + IndexedDB). Na 1ª ação que exige conta (salvar boulder, ver perfil, abrir link) aparece um aviso dispensável; na 2ª, ou após 1 dia de uso, trava na tela de criar conta. Os dados ficam 30 dias e **vão junto** ao entrar (`migrateGuest`). |
| **Avaliação** | "Está gostando?" com 5 estrelas e comentário. Aparece de tempos em tempos (7 dias se fechar, 60 se avaliar) e em Ajustes. Os resultados ficam na tabela, em `pk = FEEDBACK`. |
| **Conta** | Excluir conta apaga tudo: dados, laços de seguir dos dois lados, @, links, fotos e o login no Cognito. |
| **Legal** | `/privacidade.html`, `/termos.html` e o termo das fotos (versão `2026-11-12`, novo aceite ao mudar). |
| **E-mail** | O código de cadastro/senha sai de `Chalkmark <no-reply@vsoller.com.br>` pelo SES (fora do sandbox desde 12/11/2026), com arte e respostas para o Gmail do dono. SPF, DKIM e DMARC passam. |

---

## 2. Arquitetura

```
Navegador (SPA vanilla, sem framework)
 ├─ web/src/app.js        telas, roteamento por hash, estado em memória
 ├─ detect-worker.js      YOLOv8n fp16 (ONNX, onnxruntime-web 1.31, 1 thread) → caixas
 ├─ color.js / detect.js  cor (CIELAB/LCh, desconta parede e magnésio) e agrupamento da via
 └─ guest.js              modo sem conta (mesmas rotas da API, respondidas localmente)

CloudFront (CSP rígida, COOP/COEP, HSTS) ── S3 (assets com hash = cache 1 ano; páginas no-cache)
 └─ /api/* ── API Gateway HTTP (autorizador JWT Cognito; /api/public/* sem autorizador)
              └─ Lambda única services/api.ts (Node 22, ARM, 1024 MB, roteia por routeKey)
                  ├─ DynamoDB tabela única (RETAIN + PITR)
                  ├─ S3 fotos privado (presigned POST/GET; photos/<sub>/<climbId>/full|thumb, photos/<sub>/avatar)
                  └─ Bedrock Converse: Claude Haiku 4.5 (só estilo da via)

Cognito (plano Essentials): pool "boulder-log", senha forte (12+), sem MFA, auth USER_PASSWORD_AUTH pela tela
do app + Google (Secrets Manager chalkmark/google-oauth) + gatilho PreSignUp; e-mail via SES (DKIM, MAIL FROM, DMARC).
```

### Dados (DynamoDB, `pk`/`sk`)

| pk | sk | O quê |
|---|---|---|
| `USER#<sub>` | `GYM#<id>` | ginásio (nome, paleta calibrada, `loc` gravada uma vez) |
| `USER#<sub>` | `SESSION#<id>` | sessão (`startedAt`, `endedAt`, sensação, nota, `autoEnded`) |
| `USER#<sub>` | `CLIMB#<id>` | boulder: cor, grau, resultado, `holds` (com `role`), `cands`, `autoHolds`, `detector`, `tap`, `projectId`, `dropped`, `ai`, `photoType`, `sharedFrom/sharedBy`, `gymName` (em cópias) |
| `USER#<sub>` | `SETTINGS` | escala, metas, aceite do termo das fotos |
| `USER#<sub>` | `PROFILE` | nome, @, `avatarType`, `pinned`, `search` |
| `USER#<sub>` | `FOLLOWS#<sub>` / `FOLLOWER#<sub>` | laços de seguir (gravados em transação) |
| `USER#<sub>` | `AIQUOTA#<dia>` | cota diária de IA (20/conta) |
| `AIQUOTA#GLOBAL` | `AIQUOTA#<dia>` | teto diário do app (200) |
| `HANDLE#<@>` | `HANDLE` | unicidade do @ |
| `SHARE#<token>` | `SHARE` | boulder compartilhado (TTL 90 dias) |
| `FEEDBACK` | `<dia>#<sub>` | avaliação do app |

Os ids (`newId`) são ordenáveis pelo tempo (base36 dos ms), e é isso que permite consultar "boulders desde segunda" por intervalo.

### Principais rotas

`/api/gyms`, `/api/sessions`, `/api/climbs` (+`/media`, `/analyze`, `/share`), `/api/settings`,
`/api/profile`, `/api/users` (busca), `/api/users/{handle}` (+`/follow`, `/climbs/{id}/copy`), `/api/social`
(ranking + sugestões), `/api/shares/{id}` (+`/accept`), `/api/feedback`, `DELETE /api/account`,
`/api/public/shares/{id}`, `/api/public/users/{handle}`.

---

## 3. Decisões e por quê

| Decisão | Por quê |
|---|---|
| Agarras pelo YOLO no navegador, não por LLM | Haiku 4.5, Nova, Llama 4 e Pixtral foram testados numa foto real e erram a posição das agarras. O YOLO acerta e custa zero. |
| Detector em Web Worker com 1 thread | No main thread congelava a tela por até 9,5 s (CPU 4x lenta). Com várias threads dentro do worker, o runtime trava. No iPhone já era 1 thread. |
| Haiku 4.5 só para estilo (agarra, ângulo) | É barato (~US$ 0,004 por foto). Haiku 5.5 e Sonnet 5.5 são negados pela AWS na conta. |
| Via = cor parecida + encadeamento por proximidade | Simples e explicável. Alternativas testadas (espalhar ao incluir, espalhar ao tirar) não reduziram os cliques. Ver `ml/README.md`. |
| Seguir sem aprovação, amigo = mútuo | Escolha do dono (estilo Instagram). A privacidade vem de "histórico só para amigos". |
| Ranking e "seguido por" só com amigos mútuos | A revisão de segurança mostrou que seguir alguém vazava o XP e o grafo social dessa pessoa. |
| "Mesmo ginásio" sem o nome do ginásio da outra pessoa, local gravado uma vez, 20 ginásios/conta | Impede usar ginásios falsos para descobrir onde alguém treina. |
| Login na tela do app (USER_PASSWORD_AUTH) | Visual próprio. A senha vai por HTTPS direto ao Cognito. O Google continua pelo OAuth do Cognito. |
| Vincular Google por e-mail verificado (PreSignUp) | Uma pessoa = uma conta. Na 1ª vez o Cognito recusa uma vez, e o app tenta de novo sozinho. |
| Modo sem conta local | A pessoa experimenta antes de se cadastrar. Nada vai ao servidor sem conta. |
| Tabela única DynamoDB, Lambda única | Custo e operação mínimos. O app inteiro custa centavos por mês. |
| Scans (busca de pessoas, ginásios próximos) | O volume é pequeno. Estão limitados a 10 páginas e marcados com `ponytail:` para virar índice (GSI/geohash) se crescer. |

---

## 4. Operação

- **Deploy:** push na `main` → `.github/workflows/deploy.yml` (OIDC → papel `github-actions-boulder-log-deploy`) → `cdk deploy BoulderLog-App`. Leva ~1,5 min.
- **Variáveis do repositório (GitHub → Settings → Variables):**

  | Variável | Valor |
  |---|---|
  | `HOSTED_ZONE_ID` | zona `vsoller.com.br` |
  | `EMAIL_VIA_SES` | `true` |
  | `REPLY_TO_EMAIL` | Gmail do dono |
  | `GOOGLE_OAUTH` | `true` |
  | `ALERT_EMAIL` | Gmail do dono com `+chalkmark` |

- **Segredos:** `AWS_DEPLOY_ROLE_ARN` (GitHub secret); `chalkmark/google-oauth` no Secrets Manager (`{clientId, clientSecret}` do Google Cloud, projeto "Chalkmark").
- **OIDC:** a confiança aceita os repositórios `VgsStudio/boulder-log` e `VgsStudio/chalkmark`, para a troca de nome.
  - Depois de um tempo, tirar o nome antigo e redeployar `BoulderLog-Oidc` localmente: `GITHUB_REPO_CLAIM=VgsStudio/chalkmark npx cdk deploy BoulderLog-Oidc`.
  - Isso exige aprovação explícita do dono, porque mexe em IAM.
- **Google OAuth:** app "Chalkmark" publicado (External, In production). A verificação de branding está pendente; sem ela, a tela do Google mostra o domínio do Cognito. A logo não foi enviada (exigiria verificação).
- **SES:** domínio `vsoller.com.br` verificado (DKIM, MAIL FROM `mail.vsoller.com.br`, DMARC `p=none`), em produção (50 mil/dia).
- **Custos:** novembro de 2026 ≈ US$ 0,35 do app, mais ~US$ 0,09 de IA de testes. Budget de US$ 5 por mês avisa por e-mail. A IA tem teto de 20 por conta e 200 no app por dia.
- **Logs:** CloudWatch da Lambda `ApiFn` (JSON: `share.created`, `ai.analyzed`, `account.deleted`, `feedback`…) e da `PreSignUpFn` (`linked`).
- **Ler avaliações:** `aws dynamodb query --table-name <tabela> --key-condition-expression "pk = :p" --expression-attribute-values '{":p":{"S":"FEEDBACK"}}'`.

### Testar localmente

Os testes unitários rodam com `npm test`. Para ver as telas sem AWS, as sessões anteriores usaram um servidor fake
(serve `dist/` e simula `/api` em memória) e o Chrome headless via CDP. Esses scripts ficaram fora do repositório. Para
recriar: um `http.createServer` que serve `dist/pages` e `dist/static` com COOP/COEP, injeta um token falso no
`localStorage` e responde às rotas de `/api` com dados em memória.

---

## 5. Revisão de segurança (12/11/2026)

Nada crítico ou alto. Corrigido:

- ranking e "seguido por" só com amigos;
- "mesmo ginásio" sem nome e com local fixo;
- tetos de ginásios, seguidos e Scans;
- aceite de link idempotente;
- IAM do Bedrock só no modelo configurado;
- exclusão de conta;
- teto global de IA.

Ficou para decidir (baixo):

- disputa e quarentena do @;
- MFA, que o dono não quer;
- refresh token de 30 dias no localStorage;
- fixar as GitHub Actions por SHA e exigir aprovação no deploy;
- revogar link compartilhado.

---

## 6. Pendências e próximos passos

### Testar no celular (prioridade)

Nada abaixo foi testado de ponta a ponta num celular real:

- uso sem conta → criar conta → migração;
- Google com o mesmo e-mail (vínculo + retry);
- e-mail de código pelo SES no cadastro real;
- zoom, toque longo e edição de agarras;
- encerramento automático da sessão;
- seguir, ranking e perfil com amigos reais.

### Combinado e ainda não feito

- **Arrastar o dedo para marcar várias agarras de uma vez.** Proposto como alternativa aos vários cliques.
- **Usar os adesivos do ginásio** (duas bolinhas na saída, plaquinha do grau) para separar duas vias da mesma cor. A regra do ginásio não foi confirmada.
- **Verificação de branding no Google** (domínio no Search Console via TXT no Route 53), para mostrar "Chalkmark" na tela do Google.
- **Tirar o nome antigo do repositório da confiança OIDC.**
- **Notificações:** "fulano te seguiu", "amigo mandou o seu fixado", lembrete da sequência.
- **Treino da IA:** `ml/features.mjs` e `ml/train.mjs` quando houver ~150 vias corrigidas (plano em `ml/README.md`).
- **Revogar link compartilhado** e **bloquear pessoa**.

### Pequenos ajustes conhecidos

- Um boulder antigo (verde V1, 22:58 de 11/11) não tem a foto grande. A miniatura cobre.
- Os boulders anteriores a 12/11 não têm `cands`. Basta abrir "Editar agarras" e salvar para gravar.

---

## 7. Ideias para deixar mais viciante e fácil

**Hábito e retorno**

- Lembrete da sequência por **web push**. Funciona no iPhone com o app instalado na tela inicial: "faltam 2 dias para salvar sua sequência".
- **Protetor de sequência** comprado com XP, como o "streak freeze" do Duolingo.
- **Ligas semanais** entre amigos ou no ginásio (bronze → prata → ouro), com sobe e desce.
- **Desafios da semana:** "mande 3 V3", "flash em 2 cores diferentes", "complete o circuito amarelo".
- **Resumo da semana** como imagem pronta para o story do Instagram, que também traz gente nova.

**Social**

- **Feed de amigos** com reação de um toque (🔥 / 👏) e "mandou o projeto depois de 4 sessões".
- **Desafiar um amigo** com um boulder (o link compartilhado com prazo) e ver quem manda primeiro.
- **Ranking do ginásio** (opcional), pelos ginásios próximos.

**Facilidade**

- **Instalar como app:** um aviso "Adicionar à tela inicial" depois da 2ª sessão, e modo offline (service worker) para o ginásio sem sinal.
- **Botão de câmera direto** no centro da barra de abas: um toque e já está registrando.
- **Registro rápido sem foto:** cor + grau + Mandei em dois toques, para quem não quer fotografar tudo.
- **Primeira experiência guiada:** 3 telas (registre, marque a via, acompanhe a sequência) e escolher a meta semanal logo de cara.
- **Arrastar para marcar várias agarras** (acima) e **sugestão de grau** pelo histórico daquela cor no ginásio.
