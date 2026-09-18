# Seu Jeito — landing + loja

Landing page de calças para mulheres até 1,60m. HTML/CSS/JS puro, sem build.

## Arquivos
- `index.html` — página inteira (CSS inline). Seções: hero, perks, "feitas para você", modelos, faixa, depoimentos, CTA, footer.
- `loja.js` — catálogo (`PRODUTOS`), sacola em localStorage, medidas na 1ª compra, checkout → WhatsApp (`WHATSAPP` no topo).
- `provador.js` — provador 3D: câmera + MediaPipe Pose + Three.js (importmap, jsdelivr). Carrega `img/calca-<id>.gltf` (JSON com buffer base64 — o Artifact não serve .glb), auto-rig em 5 ossos (cós, coxas, canelas) por posição dos vértices, ossos posicionados direto via matrixWorld (fora da cena) com câmera ortográfica 1 unidade = 1 px. Sem GLB usa calça procedural (`cor` do produto). `window._provador` expõe funções pra testar sem câmera.
- `img/` — fotos (JPG ≤1600px, q82) + `logo.svg` (limpa do Inkscape, marrom, sem a linha "FEITA PARA VOCÊ"). `_assets/` = PNGs originais, descartável.

## Decisões
- Sem backend: pedido vira mensagem no WhatsApp com itens, dados e medidas. Pix/cartão exige gateway + servidor.
- Medidas (altura, cintura, quadril, comprimento da perna) salvas em localStorage; tabela cintura→tamanho única (`TABELA_CINTURA`).
- Provador 3D: ossos rígidos, sem física de tecido nem oclusão do corpo. GLB precisa estar de pé, pernas retas, Y pra cima, sem rig. Juntas do rig por fração da altura em `GEO`. Coxas/canelas nascem onde o osso pai levou a junta (continuidade). Modelo de frente: lado x<cx = perna direita = landmarks pares.
- Bug já resolvido: bones como filhos do SkinnedMesh têm matrixWorld recalculado a cada render (force cascata) — por isso ficam fora da cena.
- Publicado como Artifact: https://claude.ai/artifact/DsJdtgjSgV16W2vSsatLWZ (republicar passando `files` com `img/*`, `loja.js`, `provador.js`).
- Servidor local: `preview_start` "seu-jeito" (launch.json em Downloads/.claude) → http://localhost:8000.

## Pendente
- GLBs atuais são extrusões simples (43KB, só POSITION, Z-up → `normalizar()` corrige). Malha com volume real melhora muito o visual.
- Número real do WhatsApp em `loja.js`.
- Fotos em alta do cliente (vindo).
- Preços reais (placeholders em `PRODUTOS`).
