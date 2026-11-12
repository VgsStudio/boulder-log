# Treino com as fotos do app

O objetivo é errar menos ao montar a via, não detectar agarras. O detector (YOLOv8n do Hugging Face)
já acha as agarras bem. Os erros reais estão em decidir quais agarras são da mesma via:

- outra via da mesma cor ao lado;
- cores lavadas pelo magnésio, como uma roxa que parece azul-clara e marrom.

## O que o app guarda (por boulder com foto)

| Campo | O que é |
|---|---|
| `cands` | todas as agarras que o detector achou (até 300) |
| `detector` | qual modelo achou (`yolov8n-freeclimbs-2`) |
| `autoHolds` | a via que o app sugeriu sozinho, antes das correções |
| `holds` | a via final, corrigida pela pessoa; `role: start/top` = início (verde) e topo (vermelho) |
| `tap`, `color` | onde a pessoa tocou e a cor da via |

`holds ⊂ cands` (mais as agarras que a pessoa incluiu por crescimento de região) são os rótulos:
"esta candidata é da via / não é". Isso serve para treinar quem monta a via.

## Consentimento

O termo das fotos (`web/src/i18n.js`, chaves `terms.*`) e a política de privacidade (`web/privacidade.html`)
autorizam o uso das fotos, sem identificar a pessoa, para treinar modelos. O `export.mjs` aplica isso:

- usa só fotos que existem no momento do export;
- usa só contas que aceitaram o termo;
- deixa de fora as cópias de boulders de amigos;
- troca a conta por um hash;
- apaga e refaz `ml/data/` a cada export.

Antes de treinar, abra `ml/data/review.html` e descarte fotos com pessoas identificáveis (`exclude.txt`).

## Passo a passo

```sh
TABLE=<tabela> BUCKET=<bucket> node ml/export.mjs   # baixa o conjunto (só leitura na AWS)
node ml/eval.mjs                                     # linha de base: regra atual de agrupamento
```

## Próximo passo (quando houver ~150-300 vias corrigidas)

Para cada par (agarra tocada, candidata) da mesma foto, extrair:

- a diferença de cor em Lab (com o `color.js`, igual ao app);
- a distância;
- os tamanhos;
- se está acima ou abaixo.

Com isso, treinar um classificador pequeno (regressão logística ou árvore rasa) dizendo "é da mesma via".
O modelo vira um JSON de pesos lido pelo `detect.js` no lugar das tolerâncias fixas do `routeHolds`.
Ele só entra no app se o `eval.mjs` mostrar menos toques para corrigir.

O treino é local ou no Colab gratuito e custa zero.

Licença: o detector base é AGPL-3.0. Um modelo derivado dele (retreinar o YOLO) segue a mesma licença. O
classificador de via usa só as saídas do detector e as cores, então não é derivado do YOLO.
