# Chalkmark: handoff

Documento para retomar o projeto em outra sessão: o que é, o que existe, por que foi feito assim, como
operar e o que vem depois. Atualizado em 13/11/2026.

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
| **Abas** | Só ícones: **Sessão + Histórico** (montanha; `#/history` rola até o histórico) · **📷 (centro)** · **Ranking** (troféu, `#/friends`: ranking da semana, busca e sugestões; saiu de dentro do perfil) · **Perfil**. O app abre no perfil (sem conta, na Sessão). A **Home (feed) está escondida** enquanto há poucos usuários: `HOME_ON = false` em `ui/shell.jsx`; a rota `#/feed` continua funcionando. A Evolução fica dentro do Perfil (`#/progress`). **Arrastar para os lados** troca de aba (Sessão ↔ Ranking ↔ Perfil); dentro de uma tela (boulder, perfil de alguém, Evolução), arrastar para a direita volta. O arrasto é ignorado sobre foto, faixas que rolam, linhas arrastáveis e campos (`OWNED` em `ui/shell.jsx`). A barra de cima rola com a página; a **engrenagem dos Ajustes fica no perfil**. |
| **Câmera** (centro da barra) | Foto → novo boulder direto. Sem sessão aberta, abre uma no último ginásio usado. |
| **Registro rápido** | Na sessão: cor + grau + resultado numa janela, sem foto. |
| **Sessão** | Começa no ginásio (reconhecido por GPS, até 500 m). Registra boulders e encerra com sensação/nota. **Encerra sozinha**: >1 km do ginásio (com o app aberto, a cada 5 min) ou 4 h sem registro. |
| **Registrar boulder** | Foto → detector acha as agarras (Web Worker, não trava a tela) → toque numa agarra = cor + via sugerida. Toque inclui/tira agarra; **segurar** = início (verde) → topo (vermelha) → normal; **pincel** 🖌 = arrastar o dedo marca/desmarca várias. Enquanto procura, a foto fica cinza com uma varredura. Pinça amplia só a foto. Cor, grau (V ou Font) e resultado (Flash/Mandou/Projeto). Ao continuar um projeto, o resultado é obrigatório. |
| **Boulder salvo** | Editar cor/grau, **editar agarras** (o detector roda de novo), fixar no perfil (alfinete), compartilhar link, excluir (o projeto inteiro, se for a raiz). Navega com **‹ ›** e arrastando para o lado. A foto aparece em 3 camadas: prévia borrada na hora → miniatura → foto grande (as duas carregam em paralelo). |
| **Projetos** | "Mandei!" / "Tentei de novo" / "A via saiu / desisti". Contador de tentativas não existe (decisão: ninguém atualiza). |
| **Gamificação** | XP por via (grau, flash), nível, sequência semanal (o foguinho explica ao tocar), metas (sessões/semana, grau), trilha de graus (5 mandadas = domina), conquistas. A comemoração de conquista/recorde/nível **fecha sozinha em 3,5 s** (se a pessoa não tocar nela); sem conquista, é só um aviso rápido. **Som só ao registrar boulder** (trombeta sintetizada em `sound.js`): flash = fanfarra, mandou = toque curto, tentativa de projeto = nota suave; o resto do app é silencioso. |
| **Evolução** | Gráficos semanais, pirâmide, KPIs, card "Onde você manda e onde trava" (estilo da IA; avisa quando há menos de 15 boulders analisados). |
| **Histórico** | Calendário, sessões (o mais recente em cima) e galeria filtrável. Sessão encerrada: **arrastar para a esquerda** (como no WhatsApp) ou **segurar** mostra **Excluir**; tocar apaga os boulders dela e depois a sessão (`DELETE /api/sessions/{id}` só aceita sessão sem boulders). |
| **Perfil** (aba da direita) | No meu perfil, os números levam aos lugares: Sessões → histórico, Mandadas → galeria, Grau máx → Evolução, Semanas → foguinho. Nome, @, foto, nível. **Seguidores / seguindo** abrem a lista de pessoas (como no Instagram), com botão de seguir; no próprio perfil e no de amigos (para os outros, só os números). **Amigos** ficam dentro (ranking da semana, busca, "talvez você conheça"). Boulder fixado. Galeria com etiqueta **Mandado/Flash/Projeto/Desistido** e filtros. Compartilhar perfil. Volta para a mesma posição da página. |
| **Social** | Seguir sem aprovação. **Amigo = os dois se seguem**. Histórico, fotos e XP só para amigos; o cartão público (nome, @, nível, fixado) é visível para qualquer pessoa com o link, até sem conta. "Quero tentar" copia o boulder de um amigo para os seus projetos. |
| **Compartilhar boulder** | Ícone no topo do boulder. Link `#/s/<token>` (90 dias) com foto, agarras, cor, grau e **nome do ginásio**. Quem recebe adiciona uma **cópia** aos próprios projetos (editar uma não muda a outra). A página do link tem **Seguir** ao lado de quem mandou e, depois de adicionar, aparece "Seguir Fulano?" (como o TikTok). Dá para **desativar os links** de um boulder; excluir o boulder também desativa. |
| **Fotos rápidas** | Ao salvar, o app gera uma **prévia de 24 px** (`lqip`, data URL de ~1 KB) que vai junto do boulder. Galerias mostram quadrados escuros pulsando → prévia borrada → miniatura com esmaecer, carregando só o que aparece na rolagem (`loading=lazy`). Boulders antigos ganham a prévia sozinhos (até 30 por abertura, 5 s depois de abrir: baixa a miniatura e grava com PATCH). O boulder guarda também o **formato da foto** (`aspect` = largura/altura): o quadro já nasce com a altura certa e nada pula quando a imagem chega; os antigos ganham o dado de fundo (junto com a prévia) e, enquanto isso, o aparelho lembra o formato das fotos já vistas (`cm:ar`). Foto de perfil entra por cima do círculo com as iniciais (sem branco). |
| **Home** (ex-Feed) | Boulders mandados e projetos novos dos **amigos** (mútuos), rolagem infinita, **🔥** (com notificação ao dono), "Quero tentar", **"Talvez você conheça"** a cada 8 posts (depois do 4º, 12º…): cartões grandes lado a lado, como no Instagram, com Seguir, "Ver todos" (Amigos) e X para dispensar (guardado em `cm:hideSug`); a lista gira a cada vez que aparece. O título é "Chalkmark". No fim (ou vazia): "Não encontrou o que procura?" com Encontrar amigos e Registrar um boulder (abre a câmera). |
| **Compartilhar nos stories** | Estilo Strava/Duolingo: em boulder **mandado/flash** (abaixo da foto) e no **resumo da sessão**, o botão "📸 Compartilhar nos stories" gera no celular um cartão 1080×1920 no estilo Strava (`web/src/storycard.js`: foto em tela cheia com a via marcada, faixa de dados embaixo — grau, flash/mandou, cor —, risco de giz, ginásio e data, marca e endereço; a sessão usa a foto do melhor boulder mandado, ou a agarra do logo) e abre o compartilhar nativo (Instagram Stories, WhatsApp…). Sem suporte a compartilhar arquivo, baixa a imagem. Evento `story_shared`. |
| **Bloquear** | No perfil da pessoa: desfaz o seguir dos dois lados, impede seguir de novo e tira a pessoa de sugestões e busca. |
| **Sininho (avisos)** | No topo: novos seguidores e 🔥 nos seus boulders (gravados em `USER#<sub>/INBOX#<tipo>#<quem>#<boulder>`, 60 dias, sem duplicar) e **Novidades** do app (lista `NEWS` em `ui/inbox.jsx`: ao lançar algo, acrescente lá). Bolinha com o número de não vistos; abrir marca como visto (`SETTINGS.inboxSeen`). Rotas `GET /api/inbox` e `POST /api/inbox/seen`. |
| **Notificações** | Web Push (no iPhone, só com o app na tela inicial). **Lembrete diário personalizado** ("Vitor, …") 1 h antes do horário em que a pessoa costuma começar as sessões (aprendido; pode fixar em Ajustes). A mensagem depende da situação: sequência em risco no fim de semana (sempre vence), projeto esperando, meta da semana, semana em branco ou "semana garantida". Ciclo de 4 dias: 2× a principal, 1× a segunda, 1× uma **variada** (dias sem parede, grau máximo +1, marco de vias mandadas, chamar um amigo). Continua 1 aviso por dia. Não envia se a pessoa já escalou no dia. Também avisa novo seguidor e 🔥. Ajustes: liga/desliga e horário (o "enviar teste" foi tirado). |
| **App instalado / offline** | O service worker (`web/sw.js`) guarda o app e uma cópia dos dados: sem sinal, abre com aviso. Convite para instalar na tela inicial (a cada 7 dias; passo a passo no iPhone, botão no Android/Chrome, passo a passo no Android sem o botão) e também em Ajustes → Conta. |
| **Links abrindo o app** | Android: o manifesto tem `handle_links: preferred` + `launch_handler`, e o app instalado pelo Chrome abre os links do Chalkmark. iPhone: a Apple **não deixa** app da tela inicial abrir links (só app nativo, com Universal Links); o link abre no Safari, que tem login separado. Ponte: a página do link no Safari mostra "Copiar link" e, no app, colar o link na busca de pessoas abre o boulder/perfil. |
| **Janelas de baixo** | Todas fecham arrastando para baixo (com a alça no topo), tocando fora ou no botão. Arrastar sobre foto ou campo não conta. |
| **Tutorial** | Na 1ª abertura, tela escura com destaque e balões (câmera, sessão, foguinho, feed, perfil, ajustes), e um passo na 1ª foto (tocar, segurar, pincel). Depois vem o convite de instalar e o das notificações. |
| **Login** | Tela própria do app (entrar, criar conta, código por e-mail, esqueci a senha) + **Entrar com Google**. Google com o mesmo e-mail de uma conta existente é **vinculado** a ela (`services/presignup.ts`). Boas-vindas com nome e @ sugeridos na 1ª entrada. |
| **Usar sem conta** | Tudo funciona no navegador (localStorage + IndexedDB). Na 1ª ação que exige conta (salvar boulder, ver perfil, abrir link) aparece um aviso dispensável; na 2ª, ou após 1 dia de uso, trava na tela de criar conta. Os dados ficam 30 dias e **vão junto** ao entrar (`migrateGuest`). |
| **Avaliação** | "Está gostando?" com 5 estrelas e comentário. Aparece de tempos em tempos (7 dias se fechar, 60 se avaliar) e em Ajustes. Os resultados ficam na tabela, em `pk = FEEDBACK`. A **primeira avaliação vale +50 XP** (uma vez por conta: `SETTINGS.fbXp` marca, `SETTINGS.bonusXp` soma; o XP total no app é `myXp()` = boulders + bônus), com a trombeta de "mandei". |
| **Ajustes** | Página própria (`#/settings`, aberta pela engrenagem do perfil): um **menu de grupos fechados** — Escalada, Aparência, Sons, Notificações, Privacidade, Conta e Zona de perigo — e cada grupo abre sua página (`#/settings/<grupo>`; arrastar para a direita volta). Tudo salva sozinho. |
| **Conta** | Excluir conta apaga tudo: dados, laços de seguir dos dois lados, @, links, fotos e o login no Cognito. |
| **Legal** | `/privacidade.html`, `/termos.html` e o termo das fotos (versão `2026-11-12`, novo aceite ao mudar). |
| **E-mail** | O código de cadastro/senha sai de `Chalkmark <no-reply@vsoller.com.br>` pelo SES (fora do sandbox desde 12/11/2026), com arte e respostas para o Gmail do dono. SPF, DKIM e DMARC passam. |

---

## 2. Arquitetura

```
Navegador (SPA em React 19, JSX compilado pelo esbuild, sem Vite)
 ├─ web/src/app.js          inicialização: config, login, dados, e monta <App/> em #root
 ├─ web/src/ui/shell.jsx    casca: topo, barra de abas, rotas por hash, tela de login
 ├─ web/src/ui/base.jsx     useStore, montar janelas, Seg/Stepper/Swatch/ClimbRow/FadeImg
 ├─ web/src/ui/session.jsx  sessão (começar, aberta, encerrar)
 ├─ web/src/ui/climb.jsx    novo boulder (detector), detalhe, projeto, compartilhar, link recebido
 ├─ web/src/ui/photo.jsx    foto: pinça, arrasto, toque longo, pincel, caixas das agarras, ‹ ›
 ├─ web/src/ui/social.jsx   perfil, amigos, ranking, seguidores, Home (feed)
 ├─ web/src/ui/history.jsx  histórico e evolução
 ├─ web/src/ui/game.jsx     sequência, trilha, conquistas, comemorações
 ├─ web/src/ui/settings.jsx ajustes, tutorial, instalar, notificações, avaliação, excluir conta
 ├─ web/src/core.js         sem tela: tema, Cognito, estado (state) e API, fotos, utilidades
 ├─ web/src/session.js      sem tela: localização, encerramento automático, janela de baixo
 ├─ web/src/game.js         dados da gamificação (ícones, formas, catálogo de conquistas)
 ├─ detect-worker.js      YOLOv8n fp16 (ONNX, onnxruntime-web 1.31, 1 thread) → caixas
 ├─ color.js / detect.js  cor (CIELAB/LCh, desconta parede e magnésio) e agrupamento da via
 ├─ guest.js              modo sem conta (mesmas rotas da API, respondidas localmente)
 └─ web/sw.js             service worker: cache do app (offline) e notificações push

CloudFront (CSP rígida, COOP/COEP, HSTS) ── S3 (assets com hash = cache 1 ano; páginas no-cache)
 └─ /api/* ── API Gateway HTTP (autorizador JWT Cognito; /api/public/* sem autorizador)
              └─ Lambda única services/api.ts (Node 22, ARM, 1024 MB, roteia por routeKey)
                  ├─ DynamoDB tabela única (RETAIN + PITR)
                  ├─ S3 fotos privado (presigned POST/GET; photos/<sub>/<climbId>/full|thumb, photos/<sub>/avatar)
                  ├─ Bedrock Converse: Claude Haiku 4.5 (só estilo da via)
                  └─ Web Push (services/push.ts, lib web-push; chaves VAPID geradas pelo servidor, em CONFIG/VAPID)

EventBridge (minuto 1 de cada hora) ── Lambda NotifyFn (services/notify.ts → push.ts): Query no balde
NOTIFY#<hora UTC> → lembrete diário de quem está nele. ~720 execuções/mês, sem Scan.

Cognito (plano Essentials): pool "boulder-log", senha forte (12+), sem MFA, auth USER_PASSWORD_AUTH pela tela
do app + Google (Secrets Manager chalkmark/google-oauth) + gatilho PreSignUp; e-mail via SES (DKIM, MAIL FROM, DMARC).
```

### Front em React

- **Estado:** um objeto `state` em `core.js` (ginásios, sessões, boulders, ajustes, perfil). As telas leem com `useStore()`; quem altera chama `emit()` (ou `render()`, que também remonta a tela atual do zero, como antes da migração).
- **Rotas:** `ui/shell.jsx` lê `location.hash` a cada `hashchange`. Sem hash, abre na Home (ou na Sessão, se houver sessão aberta ou sem conta).
- **Janelas de baixo:** `openSheet(<Componente/>)` monta o componente dentro do `<dialog id="sheet">`; arrastar para baixo fecha (`sheetSwipe`).
- **Foto:** `ui/photo.jsx` guarda o motor de gestos (pinça, arrasto, toque longo, pincel) num `useEffect`, lendo sempre as funções mais novas; o zoom fica num objeto `z` de quem usa, para sobreviver ao redesenho.
- **Fotos com link vencido** (os links assinados valem 1 h): se uma imagem falha, `refreshPhotos()` busca os dados de novo e redesenha (no máximo 1x por minuto).
- **Teste de fumaça** (fora do repo): um servidor falso + Chrome sem tela passando por todas as telas, sem conta e pelo fluxo da foto (detector, toque, toque longo, pinça, pincel, salvar, editar agarras, compartilhar). Foi o que validou a migração.

### Estatísticas (PostHog, região EU)

- `web/src/analytics.js`: carrega o PostHog **depois** que o app abre (pedaço separado do bundle, com gravação e erros inclusos, sem scripts de fora). Não roda em `localhost`.
- Identifica pelo `sub` do Cognito (nunca e-mail). Sem conta = anônimo. Propriedades: `guest`, `installed`, `app_lang`.
- Gravação de sessões com campos mascarados, sem fotos (`img, canvas, .avatar` bloqueados) e com nomes de outras pessoas escondidos. Mapa de calor e erros automáticos; `fail()` também manda o erro.
- Visitas: `$pageview` com `screen` (`home`, `session`, `new_climb`, `climb`, `history`, `progress`, `my_profile`, `user_profile`, `friends`, `shared_climb`).
- Eventos: `climb_logged` (resultado, grau, foto, agarras sugeridas × corrigidas: `holds_added`/`holds_removed` medem o acerto do detector), `holds_detected` (quantas e em quantos ms), `holds_detect_failed`, `holds_edited`, `project_try`, `session_started`/`session_ended`/`session_auto_ended`, `follow`/`unfollow`, `fire`, `share_created`/`share_accepted`, `friend_climb_copied`, `profile_created`, `push_enabled`/`push_blocked`, `install_prompt_shown`, `feedback_sent`, `guest_prompt`/`guest_blocked`, `auth_login`/`auth_signup`/`auth_google_click`.
- **MCP do PostHog** configurado nesta máquina (escopo local do Claude Code, fora do repo): `claude mcp add --transport http --scope local posthog https://mcp-eu.posthog.com/mcp --header "Authorization: Bearer <chave pessoal phx_>"`. Projeto 346656. A chave pessoal nunca vai para o repositório.
- **Agente `analista`** (`.claude/agents/analista.md`): peça "relatório de uso" e ele faz a análise completa no PostHog (usuários, funis, erros, gravações com Replay Vision) e cruza com o código. Usa o MCP local acima.
- Ajustes → "Estatísticas de uso" desliga (fica em `cm:noStats`). Política de privacidade atualizada. CSP: `connect-src` inclui `eu.i.posthog.com` e `eu-assets.i.posthog.com`.

### Dados (DynamoDB, `pk`/`sk`)

| pk | sk | O quê |
|---|---|---|
| `USER#<sub>` | `GYM#<id>` | ginásio (nome, paleta calibrada, `loc` gravada uma vez) |
| `USER#<sub>` | `SESSION#<id>` | sessão (`startedAt`, `endedAt`, sensação, nota, `autoEnded`) |
| `USER#<sub>` | `CLIMB#<id>` | boulder: cor, grau, resultado, `holds` (com `role`), `cands`, `lqip` (prévia ≤3 KB, só `data:image/webp|jpeg`), `autoHolds`, `detector`, `tap`, `projectId`, `dropped`, `ai`, `photoType`, `sharedFrom/sharedBy`, `gymName` (em cópias) |
| `USER#<sub>` | `SETTINGS` | escala, metas, aceite do termo das fotos |
| `USER#<sub>` | `PROFILE` | nome, @, `avatarType`, `pinned`, `search` |
| `USER#<sub>` | `FOLLOWS#<sub>` / `FOLLOWER#<sub>` | laços de seguir (gravados em transação) |
| `USER#<sub>` | `AIQUOTA#<dia>` | cota diária de IA (20/conta) |
| `AIQUOTA#GLOBAL` | `AIQUOTA#<dia>` | teto diário do app (200) |
| `HANDLE#<@>` | `HANDLE` | unicidade do @ |
| `SHARE#<token>` | `SHARE` | boulder compartilhado (TTL 90 dias) |
| `FEEDBACK` | `<dia>#<sub>` | avaliação do app |
| `USER#<sub>` | `PUSH#<hash>` | inscrição de notificação de um aparelho (endpoint + chaves) |
| `NOTIFY#<HH>` | `<sub>` | quem recebe o lembrete às HH (UTC) |
| `USER#<sub>` | `SETTINGS` (campos `push*`) | `pushOn`, `pushTz`, `pushHour` (null = aprendido), `pushLang`, `pushBucket`, `lastPushDay` |
| `CONFIG` | `VAPID` | chaves VAPID (geradas na 1ª vez) |
| `USER#<dono>` | `REACT#<climbId>#<sub>` | 🔥 de alguém num boulder (o contador fica em `fire` no boulder) |
| `USER#<sub>` | `SHAREREF#<climbId>#<token>` | referência dos links de um boulder (para desativar) |
| `USER#<sub>` | `BLOCK#<sub>` | pessoa bloqueada |

Os ids (`newId`) são ordenáveis pelo tempo (base36 dos ms), e é isso que permite consultar "boulders desde segunda" por intervalo.

### Principais rotas

`/api/gyms`, `/api/sessions`, `/api/climbs` (+`/media`, `/analyze`, `/share`), `/api/settings`,
`/api/profile`, `/api/users` (busca), `/api/users/{handle}` (+`/follow`, `/people?type=followers|following`, `/climbs/{id}/copy`), `/api/social`
(ranking + sugestões), `/api/shares/{id}` (+`/accept`), `/api/feedback`, `DELETE /api/account`,
`/api/feed` (+`/{handle}/{id}/fire`), `/api/users/{handle}/block`, `DELETE /api/climbs/{id}/share`,
`/api/push/key|subscribe|unsubscribe|prefs`,
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

- **Tags (custos por projeto):** tudo que o CDK cria leva `project=chalkmark`, `creator=vsoller`, `owner=vsoller` (`infra/app.ts`; dá para trocar por `TAG_PROJECT`, `TAG_CREATOR`, `TAG_OWNER`). Os recursos criados à mão também foram marcados: segredo `chalkmark/google-oauth`, orçamento `boulder-log-monthly`, papel `github-actions-boulder-log-deploy` e a identidade do SES. As tags `project` e `owner` foram ativadas no faturamento (o Cost Explorer filtra por projeto); `creator` ativa quando a AWS terminar de ver a tag (até 24 h): `aws ce update-cost-allocation-tags-status --cost-allocation-tags-status TagKey=creator,Status=Active`.

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
- seguir, ranking e perfil com amigos reais;
- lista de seguidores/seguindo e a prévia borrada das fotos (iPhone salva a prévia em JPEG, o Safari não gera WebP).

### Estado em 12/11/2026 (fim desta rodada)

- Front migrado para **React 19** (telas em `web/src/ui/*.jsx`), validado por teste de fumaça em todas as telas, sem conta e no fluxo da foto. Publicado.
- PostHog no ar (EU). Ver eventos no painel `eu.posthog.com`. Agente `analista` criado (13/11). Relatório semanal automático ainda não (o MCP é local; na nuvem precisaria da chave pessoal lá).

### Estado em 13/11/2026

- **Perfis públicos por padrão**: histórico, números, fotos e seguidores visíveis para qualquer um (inclusive sem conta). "Perfil privado" em Editar perfil volta à regra antiga (só amigos mútuos). Bloqueio esconde o histórico. Regra única em `canSee()` (`services/api.ts`).
- **"Quero tentar" sem precisar ser amigo**: basta poder ver o perfil.
- **Ambiente de dev**: branch `dev` → stack `BoulderLog-Dev` → https://chalkmark-dev.vsoller.com.br. Dados, login (Cognito `vgs-chalkmark-dev`) e fotos próprios; sem SES (código de e-mail sai pelo Cognito, limite baixo), sem PostHog, sem alerta de custo. Google desligado até cadastrar no Google Cloud o redirect `https://vgs-chalkmark-dev.auth.us-east-1.amazoncognito.com/oauth2/idpresponse` e ligar a variável `DEV_GOOGLE_OAUTH=true` no GitHub. Fluxo: trabalhar na `dev`, testar no dev, depois merge na `main`.
- **Papel do GitHub Actions (BoulderLog-Oidc)**: o `GITHUB_REPO_CLAIM` do `.env` precisa ter `VgsStudio/chalkmark,VgsStudio/boulder-log`. Com só o nome antigo, republicar o stack tira a permissão do repositório atual e todos os deploys falham (aconteceu em 13/11).
- Som só ao registrar boulder (trombeta).
- Ideias anotadas: **perfil verificado pago** (Stripe, valor simbólico, para testar interesse); **modo Rocha** (marcar agarras à mão, sem detector); app nativo (Expo) se houver tração; marca "Chalkmark" pode conflitar com o produto da Optimal Workshop (pesquisar no INPI antes de investir); `chalkmark.com.br` está livre (~R$ 40/ano).
- Testar no celular: fotos depois de muito tempo com o app aberto (agora renovam sozinhas), arrastar janelas para fechar, zoom e pincel na versão React.

### Combinado e ainda não feito

- ~~Testar notificações num iPhone real~~: **funcionou** (12/11: chegou "👋 Jeniffer começou a te seguir"). Falta ver o lembrete diário chegar.
- **Usar os adesivos do ginásio** (duas bolinhas na saída, plaquinha do grau) para separar duas vias da mesma cor. A regra do ginásio não foi confirmada.
- **Verificação de branding no Google** (domínio no Search Console via TXT no Route 53), para mostrar "Chalkmark" na tela do Google.
- **Tirar o nome antigo do repositório da confiança OIDC.**
- **Treino da IA:** `ml/features.mjs` e `ml/train.mjs` quando houver ~150 vias corrigidas (plano em `ml/README.md`).

### Pequenos ajustes conhecidos

- Um boulder antigo (verde V1, 22:58 de 11/11) não tem a foto grande. A miniatura cobre.
- Os boulders anteriores a 12/11 não têm `cands`. Basta abrir "Editar agarras" e salvar para gravar.

---

## 7. Ideias para deixar mais viciante e fácil

**Hábito e retorno**

- **Protetor de sequência** comprado com XP, como o "streak freeze" do Duolingo.
- **Ligas semanais** entre amigos ou no ginásio (bronze → prata → ouro), com sobe e desce.
- **Desafios da semana:** "mande 3 V3", "flash em 2 cores diferentes", "complete o circuito amarelo".
- **Resumo da semana** como imagem pronta para o story do Instagram, que também traz gente nova.

**Social**

- **Desafiar um amigo** com um boulder (o link compartilhado com prazo) e ver quem manda primeiro.
- **Ranking do ginásio** (opcional), pelos ginásios próximos.

**Facilidade**

- **Sugestão de grau** pelo histórico daquela cor no ginásio.
- **Registrar offline** (fila de envio para quando o sinal voltar); hoje o app só abre e mostra sem sinal.
- **Feed materializado** se o número de amigos crescer (hoje é uma Query por amigo por página).
