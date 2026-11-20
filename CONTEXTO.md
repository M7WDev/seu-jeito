# Seu Jeito — landing + loja

Landing page de calças para mulheres até 1,55m. HTML/CSS/JS puro, sem build.

## Arquivos
- `index.html` — página inteira, refeita em 2026-11-19 com a skill `design-taste-frontend` (tasteskill). Seções: hero (produto, foto sentada), #modelos (4 cards com tamanho/sacola/provador), #detalhes (momento photo-chapters: cintura, bolso, sarja, botão), #comprimento (faixa escura + botão do provador), #tamanhos (tabela PP–G por cintura), #duvidas (FAQ), footer escuro com o CTA. Depoimentos removidos (eram inventados; voltar só com reviews reais).
- `assets/` — cópia parcial do kit da skill (system.css/js, motion, layout, moments/photo-chapters). Não editar: é do kit. CSS próprio fica no `<style>` da página.
- Look: cores do logo (creme #f7f3ee, marrom #5b3a26, tinta #2c241d), fonte Albert Sans, botões "block". Sacola e diálogos usam `<dialog>` com transição de entrada (fade + blur + escala, @starting-style) inspirada no transitions.dev; badge da sacola pula ao adicionar; campo inválido treme.
- Fotos: `img/<nome>.jpg` + `img/<nome>-640.jpg` (srcset). Novas vindas do `_assets`: cintura, bolso, sarja, botao, caixa, offwhite, sentada (cta.jpg sem a borda branca).
- `loja.js` — catálogo (`PRODUTOS`), sacola (dialog `#sacola`) em localStorage, medidas na 1ª compra, checkout → WhatsApp (`WHATSAPP` no topo). Cards = `.tile[data-id]`; botão `[data-provar="<id>"]` abre o provador. Bug corrigido: tamanho ia como `NaN` na sacola (`+select.value`).
- Checagem: `node <skill>/scripts/gate.mjs index.html` (Node 22+, Chrome). Saídas em `.taste-skill/` e `shots/` (ignorados no git). Waivers em `.taste-skill/waivers.json`: hero-lines (teste sintético de 40 caracteres) e card-layout (#modelos é line-up de propósito).
- `provador.js` — provador 3D: câmera + MediaPipe Pose + Three.js (importmap, jsdelivr). Carrega `img/calca-<id>.gltf` (JSON com buffer base64 — o Artifact não serve .glb), auto-rig em 5 ossos (cós, coxas, canelas) por posição dos vértices, ossos posicionados direto via matrixWorld (fora da cena) com câmera ortográfica 1 unidade = 1 px. Sem GLB usa calça procedural (`cor` do produto). `window._provador` expõe funções pra testar sem câmera.
- `img/` — fotos (JPG ≤1600px, q82) + `logo.svg` (limpa do Inkscape, marrom, sem a linha "FEITA PARA VOCÊ"). `_assets/` = PNGs originais, descartável.

- Tamanhos da marca (2026-11-19): Safira = PP, Esmeralda = P, Rubi = M, Turmalina = G (`TAMANHOS`/`TABELA_CINTURA` em loja.js; sacolas antigas com PP/P/M/G são convertidas ao carregar).
- Medição pela câmera (2026-11-19): no checkout a cliente digita só a altura e toca "Medir com a câmera" (`window.medirCorpo(altura)` em provador.js, dialog `#medicao`). Duas posições: de frente (braços afastados) dá largura de cintura/quadril; de lado (braços cruzados no peito) dá a profundidade. cm/px = altura ÷ altura da silhueta (máscara de segmentação do Pose, topo da cabeça até a sola). Cintura = trecho mais estreito entre ombro e quadril; quadril = mais largo logo abaixo da junta; volta = elipse de Ramanujan; perna = cintura até o chão. 12 amostras por posição, mediana. Fora da faixa da tabela → pede para medir de novo. Calibrar com fita métrica em `MED.AJUSTE`. Câmera negada/indisponível → aparecem os campos para digitar. Um Pose só para provador e medição (`modo`). Teste sem câmera: `window._medicao` (silhueta sintética bateu 76/96 contra 76/95 esperado).

- Tutorial antes da câmera (2026-11-20): `#medicao` tem 2 etapas. 1ª `.etapa-tutorial` toca `img/tutorial-medicao.mp4` (sem som, legendas na tela) + botão "Abrir a câmera e medir"; só esse toque abre a câmera (e libera a voz no iPhone). Vídeo feito em Remotion no projeto `Downloads/seu-jeito-tutorial` (fora do repo do site): cenas em `src/cenas.tsx`, montagem em `src/Tutorial.tsx`. Re-render: `npx remotion render TutorialMedicao ..\seu-jeito\img\tutorial-medicao.mp4 --codec=h264 --crf=28 --scale=0.75` (escala que não dá número inteiro quebra o H.264).
- Ajuste depois de medir (2026-11-20): os valores da câmera aparecem nos campos `.manual` editáveis; a cliente corrige se a fita der diferente. O que a câmera mediu fica em `medidas.camera` (localStorage) e, se ela corrigiu, vai uma linha no WhatsApp "(A câmera mediu …; a cliente corrigiu.)". Esses pares câmera × fita são o dado para calibrar `MED.AJUSTE` ou treinar uma correção.
- Calibração (2026-11-20): `calibrar.html` (sem link no site, noindex) — mede a pessoa com fita e com a câmera, guarda os pares em `localStorage.calibracao` do aparelho, mostra erro médio antes/depois e o fator por medida (mínimos quadrados pela origem: Σfita·câmera / Σcâmera²), pronto para colar em `MED.AJUSTE`. Usa `r.bruto` (valor da câmera sem AJUSTE). Exporta CSV e compartilha. CSS da medição/diálogos foi para `medicao.css`, usado pelas duas páginas.
- Voz na medição: `speechSynthesis` pt-BR (`falar`/`aviso` em provador.js). Só fala aviso que ficou 1 s na tela (eles piscam entre frames), repete a cada 8 s se ela não acertar; troca de fase e fim falam na hora. Botão "Voz ligada/desligada" no cabeçalho, salvo em `localStorage.vozMedicao`.

## Decisões
- Sem backend: pedido vira mensagem no WhatsApp com itens, dados e medidas. Pix/cartão exige gateway + servidor.
- Medidas (altura, cintura, quadril, comprimento da perna) salvas em localStorage; tabela cintura→tamanho única (`TABELA_CINTURA`).
- Provador 3D: ossos rígidos, sem física de tecido (dobras). Tem oclusão, volume por medidas e luz da cena. GLB precisa estar de pé, pernas retas, Y pra cima, sem rig. Juntas do rig por fração da altura em `GEO`. Coxas/canelas nascem onde o osso pai levou a junta (continuidade). Modelo de frente: lado x<cx = perna direita = landmarks pares.
- Oclusão: `enableSegmentation` do próprio Pose (não precisa carregar SelfieSegmentation). O canvas visível é 2D e compõe: roupa → `destination-in` na máscara da pessoa → `destination-out` nas cápsulas dos antebraços (só quando z do braço < z do quadril). O WebGL renderiza num canvas à parte.
- Volume: `poseOsso(..., k)` escala X/Z do osso. Cós = (cintura/quadril)/0,78 das medidas salvas; pernas = 3,1/(comprimento da perna ÷ largura do quadril), ambos com clamp. Sem medidas, k=1.
- Luz da cena: média do frame (16x16) a cada 15 frames vira cor/intensidade da hemisférica e da direcional.
- Escala modelo→px vai em `skinned.scale` (uniforme) + `bindMode = 'detached'`; escala anisotrópica nos ossos entorta normais. Flip Y fica em `scene.scale.y = -1`, não na câmera (top<bottom inverte winding e o renderer desenha o avesso = luz chapada). Ossos usam scale(-1,-k,1) = rotação, por isso perna xE ↔ landmarks ímpares (23/25/27).
- Bug já resolvido: bones como filhos do SkinnedMesh têm matrixWorld recalculado a cada render (force cascata) — por isso ficam fora da cena.
- Publicado: GitHub Pages https://m7wdev.github.io/seu-jeito/ (repo M7WDev/seu-jeito, branch main, deploy = git push). Artifact https://claude.ai/artifact/DsJdtgjSgV16W2vSsatLWZ só pra layout — sandbox bloqueia câmera. Netlify (seu-jeito-provador) travado por Forbidden no prod.
- Servidor local: `preview_start` "seu-jeito" (launch.json em Downloads/.claude) → http://localhost:8000.

## Pendente
- wideleg.gltf = asset tubular com PBR (trimesh, 12MB → 482KB via gltf-transform resize 1K + webp). Outros 3 ainda são placas extrudadas.
- Pipeline GLB → gltf: `npx @gltf-transform/cli resize --width 1024 --height 1024` → `webp --quality 80` → JSON com buffer base64 (script inline no histórico; refazer se precisar).
- Número real do WhatsApp em `loja.js`.
- Fotos em alta do cliente (vindo).
- Preços reais (placeholders em `PRODUTOS`).
