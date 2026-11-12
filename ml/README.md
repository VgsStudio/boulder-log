# Treinar a IA do Chalkmark com as fotos do app

Este documento explica como as fotos e as correções feitas no app viram um modelo melhor, de ponta a
ponta: o que é guardado, o que a lei e os termos permitem, como montar o conjunto, como treinar, como
medir e como colocar no app. Em cada etapa diz também o que já existe e o que falta.

---

## 1. Qual problema queremos resolver

O app reconhece a via em três passos, e só o terceiro erra de forma relevante:

| Passo | Como funciona hoje | Situação |
|---|---|---|
| 1. Achar as agarras na foto | YOLOv8n (Hugging Face, `jwlarocque/yolov8n-freeclimbs-detect-2`) roda no celular, num Web Worker | Bom: acha quase todas |
| 2. Medir a cor de cada agarra | `web/src/color.js`: mediana em CIELAB, descontando parede e magnésio | Bom, com falhas em cores lavadas |
| 3. **Decidir quais agarras são da via** | `routeHolds` em `web/src/detect.js`: cor parecida (tolerância fixa) + perto de outra agarra da via (encadeamento) | **É aqui que erra** |

Erros reais medidos nas fotos do ginásio:

- **Outra via da mesma cor ao lado:** na via azul, o app pegou as 7 agarras certas e mais 7 azuis de outra via.
- **Cor lavada pelo magnésio:** a via roxa aparece como lilás (igual às azuis claras) e marrom. Foram 19 cliques de correção.
- **Agarra branca na sombra** saiu da via.

Por isso o primeiro modelo **não é um detector novo**. É um classificador pequeno que responde: "esta
agarra é da mesma via que a que a pessoa tocou?". Ele substitui as tolerâncias fixas do `routeHolds`.

---

## 2. O que o app já guarda (os rótulos)

A cada boulder salvo com foto, o app grava junto, sem a pessoa fazer nada a mais:

| Campo | O que é | Para que serve no treino |
|---|---|---|
| `cands` | todas as agarras que o detector achou (até 300 caixas) | universo de exemplos |
| `detector` | id do modelo que achou (`yolov8n-freeclimbs-2`) | separar dados de detectores diferentes |
| `tap` | onde a pessoa tocou primeiro | a "agarra semente" |
| `autoHolds` | a via que o app sugeriu sozinho | medir quanto o app errou (linha de base) |
| `holds` | a via **final**, corrigida pela pessoa | **rótulo**: é da via |
| `holds[].role` | `start` (verde) / `top` (vermelha) | rótulos extras: início e topo |
| `color`, `grade`, `result` | cor, grau, mandou/flash/projeto | contexto e filtros |

Leitura dos rótulos de uma foto:

- **Positivo:** a candidata que bate com uma agarra de `holds` (IoU > 0,4) é da via.
- **Negativo:** a candidata que não bate com nenhuma de `holds` não é da via.
- **Corrigido pela pessoa:** a diferença entre `autoHolds` e `holds` mostra o que a pessoa teve que corrigir. São os exemplos mais valiosos.

Para os rótulos valerem, a via final tem que ter sido revisada pela pessoa. Por isso o app pede para
tocar nas agarras que faltam e tirar as que sobram. A edição de agarras (tela do boulder → "Editar
agarras da via") também regrava `cands` nos boulders antigos.

---

## 3. Permissão: termos, LGPD e licenças

**Base legal: consentimento.** Antes da primeira foto, a pessoa aceita o termo das fotos
(`web/src/i18n.js`, chaves `terms.*`). Ele diz que as fotos podem ser usadas, **sem identificar a pessoa**,
para melhorar o reconhecimento, **inclusive treinando modelos de IA**. O aceite fica salvo com versão e
data (`SETTINGS.photoTermsVersion` / `photoTermsAt`). A política (`/privacidade.html`) e os termos
(`/termos.html`) repetem isso.

**Regras que o pipeline cumpre** (estão no código de `ml/export.mjs`):

1. Só entram contas que aceitaram o termo.
2. Só entram fotos que **existem no momento do export**. O termo promete que foto apagada não entra em treino novo, então o `ml/data/` é apagado e refeito a cada export. Quem excluiu a conta já não tem dados.
3. Cópias de boulders de amigos ("Quero tentar", link compartilhado) ficam fora: a foto é de outra pessoa.
4. A conta vira um código (hash), sem id real, nome, e-mail, ginásio, anotação ou data.
5. **Revisão humana:** antes de treinar, abrir `ml/data/review.html` e descartar fotos com pessoas identificáveis ou via errada (o id vai em `ml/data/exclude.txt`).
6. `ml/data/` nunca vai para o git (está no `.gitignore`) nem para outro serviço.

**Licenças:**

- O detector base é AGPL-3.0. Retreinar o YOLO gera um modelo derivado, que segue a mesma licença: código e pesos abertos se distribuídos. Para um app pessoal e com repositório público, isso não atrapalha.
- O classificador de via do passo 1 usa só as caixas e as cores, não os pesos do YOLO, então não é derivado.

Isto não é parecer jurídico. Se o app crescer, um advogado deve revisar o termo.

---

## 4. Passo a passo

### 4.1 Exportar o conjunto (feito)

```sh
TABLE=<tabela> BUCKET=<bucket de fotos> AWS_REGION=us-east-1 node ml/export.mjs
```

Só lê na AWS. Gera `ml/data/images/`, `ml/data/labels.jsonl` (uma linha por foto) e `ml/data/review.html`.

### 4.2 Revisar (feito)

Abrir `ml/data/review.html`:

- as caixas tracejadas são as candidatas;
- as azuis são as agarras da via; as verdes, o início; as vermelhas, o topo.

Para tirar uma foto do conjunto, coloque o id em `exclude.txt` e rode o export de novo.

### 4.3 Linha de base (feito)

```sh
node ml/eval.mjs
```

Recalcula a via com a regra atual (`routeHolds`) e compara com a via corrigida. Mostra:

- precisão (das agarras sugeridas, quantas eram da via);
- cobertura (das agarras da via, quantas foram sugeridas);
- **toques para corrigir por foto**, a métrica que a pessoa sente.

A cor é medida com o mesmo `color.js` do app e na mesma resolução (1568 px), para o número valer no
celular.

### 4.4 Extrair características (falta: `ml/features.mjs`)

Para cada foto, cada par (semente, candidata) vira uma linha com:

| Característica | Por quê |
|---|---|
| Diferenças de L, C e h (LCh) entre semente e candidata | a cor é o sinal principal |
| Menor diferença de cor para qualquer agarra já confirmada da via | lida com vias de cor lavada |
| Distância até a agarra mais próxima da via (fração da foto) | uma via é contínua |
| Posição relativa (acima/abaixo, lado) | as vias sobem |
| Tamanho da candidata e razão de tamanho | adesivos e parafusos são minúsculos |
| Contraste com a parede (`plain`) | pedaço de parede lisa |
| Quantas candidatas de cor parecida existem na foto | indica outra via da mesma cor |
| **Rótulo:** 1 se está em `holds`, 0 se não | o que o modelo aprende |

As características saem do mesmo `color.js`/`detect.js` do app (Node + `sharp` para ler a foto). Assim, o
que o modelo vê no treino é exatamente o que ele vai ver no celular.

### 4.5 Treinar (falta: `ml/train.mjs` ou notebook)

- **Modelo:** regressão logística ou uma árvore de decisão rasa (gradient boosting com poucas árvores). É pequeno, roda em microssegundos no celular, dá para explicar e não precisa de GPU.
- **Separação dos dados:** por **conta e por foto** (nunca a mesma foto em treino e teste), por exemplo 80/20. Com poucos dados, usar validação cruzada por conta.
- **Onde rodar:** no próprio PC, em Node ou em Python com scikit-learn. Leva segundos. O Google Colab gratuito só faria sentido no futuro, para retreinar o detector.
- **Saída:** `web/models/route-v1.json` com os pesos e o limiar, alguns KB.

### 4.6 Medir e decidir (falta)

O `ml/eval.mjs` ganha a opção de usar o modelo novo no lugar do `routeHolds`. **O modelo só entra no app se
reduzir os toques para corrigir** no conjunto de teste, sem piorar a cobertura. Se empatar, fica a regra
atual, que é mais simples.

### 4.7 Colocar no app (falta)

- O `detect.js` carrega o `route-vN.json`, alguns KB.
- O `routeHolds` passa a usar a probabilidade do modelo no lugar da tolerância fixa, com o mesmo encadeamento: começa na semente, inclui as candidatas com probabilidade > limiar e repete a partir delas.
- Os toques da pessoa continuam valendo por cima: incluir, tirar, início e topo.
- O `detector`/id do modelo vai junto no boulder salvo, para medir a versão nova com dados novos.

### 4.8 Acompanhar e retreinar

- Cada boulder salvo com `autoHolds` (sugestão) e `holds` (final) mede o modelo **em produção**: quanto menos diferença, melhor. Dá para acompanhar por mês.
- **Quando retreinar:** a cada +100 vias corrigidas, ou quando a pessoa passar a corrigir mais (sinal de ginásio novo ou vias trocadas).
- Ginásios trocam as vias o tempo todo, mas as cores e o estilo das agarras se repetem. É por isso que o modelo aprende "cor e posição", não "esta via específica".

---

## 5. Quando vale a pena

| Volume de vias corrigidas | O que fazer |
|---|---|
| < 50 | Só coletar e rodar `eval.mjs` de vez em quando (estamos aqui: ~10) |
| 150-300 | Treinar o classificador de via (4.4 a 4.7) |
| 1.000+ e com todas as agarras anotadas | Considerar retreinar o detector (YOLO). Exige anotar **todas** as agarras da foto, não só as da via; dá para pré-anotar com o detector atual e corrigir |

Custo: zero. O treino é local e o modelo roda no celular, sem servidor e sem custo por uso.

---

## 6. Ideias para coletar rótulos melhores

- **Início e topo:** já existem (segurar a agarra). Ajudam a ensinar onde a via começa e termina.
- **"A via está certa?":** um toque de confirmação ao salvar marcaria a via como revisada. Os rótulos sem revisão poderiam ser ignorados no treino.
- **Adesivos do ginásio:** as bolinhas verdes duplas e a plaquinha de grau na saída. Um detector de adesivos ajudaria a separar duas vias da mesma cor.
- **Paleta por ginásio:** o app já calibra as cores por ginásio. Esses dados podem virar uma característica do modelo.

---

## Arquivos

| Arquivo | Estado |
|---|---|
| `ml/export.mjs` | pronto: monta o conjunto com consentimento, hash e revisão |
| `ml/eval.mjs` | pronto: linha de base da regra atual |
| `ml/features.mjs`, `ml/train.mjs` | a fazer quando houver ~150 vias corrigidas |
| `ml/data/` | gerado localmente, fora do git |
