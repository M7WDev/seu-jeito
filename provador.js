// Provador 3D: câmera + MediaPipe Pose + Three.js. Carrega o GLB da calça (produto.glb), faz auto-rig em
// 5 ossos (cós, coxas, canelas) por posição dos vértices e move os ossos com quadril → joelho → tornozelo.
// GLB esperado: calça de pé, pernas retas, Y pra cima, sem esqueleto. Sem GLB usa uma calça procedural.
// ponytail: ossos rígidos + câmera ortográfica (sem perspectiva/volume do corpo/física de tecido).
// Upgrade: SMPL pro corpo, cloth sim, oclusão por segmentação (MediaPipe selfie segmentation).
const CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/pose';
// frações da altura do modelo (0 = cós, 1 = barra) onde ficam as juntas
const GEO = { quadril: .15, gancho: .30, joelho: .60 };

let THREE, pose, video, produto, rodando = false, suave = {};
let renderer, scene, cam, skinned, ossos, bind; // bind = geometria de repouso por osso
let ctx, ctxLuz, ceu, luz, medidas;             // ctx = compositor 2D; ctxLuz = 16x16 p/ ler a luz da cena
const ARMS = [[13, 15], [14, 16], [15, 19], [16, 20]]; // cotovelo→pulso e pulso→dedos

function script(src) {
  return new Promise((ok, err) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = err; document.head.appendChild(s); });
}
async function carregarLibs() {
  if (!window.Pose) await script(`${CDN}/pose.js`);
  if (!THREE) THREE = await import('three');
}

/* ---------- malha da calça ---------- */
async function carregarMalha(p) {
  if (p.glb) {
    try {
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      const g = await new GLTFLoader().loadAsync(p.glb);
      const malhas = []; g.scene.updateMatrixWorld(true);
      g.scene.traverse(o => o.isMesh && malhas.push(o));
      if (malhas.length) return fundir(malhas);
    } catch (e) { console.warn('GLB falhou, usando calça procedural', e); }
  }
  return procedural(p.cor || '#2b2b2b');
}
// junta várias meshes numa só geometria (world space) + material do primeiro
async function fundir(malhas) {
  const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js');
  // mesmo conjunto de atributos em todas (senão o merge devolve null): position + uv (zerado se faltar)
  const geos = malhas.map(m => {
    const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (!['position', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    return g.toNonIndexed();
  });
  const geo = normalizar(mergeGeometries(geos, true)); // grupos → um material por malha de origem (tecido, costuras…)
  const mats = malhas.map(m => { const mat = m.material.clone(); mat.side = THREE.DoubleSide; return mat; });
  return new THREE.Mesh(geo, mats);
}
// deixa a calça de pé: eixo mais longo vira Y (Z-up → Y-up). Cós = topo do arquivo; `produto.inverter` se vier ao contrário.
// ponytail: tentei adivinhar o topo pela "fenda entre as pernas"; falha em wide leg (barra encosta). Melhor confiar no arquivo.
function normalizar(geo) {
  geo.computeBoundingBox(); const t = geo.boundingBox.max.clone().sub(geo.boundingBox.min);
  if (t.z > t.y && t.z > t.x) geo.rotateX(-Math.PI / 2);
  else if (t.x > t.y && t.x > t.z) geo.rotateZ(Math.PI / 2);
  if (produto?.inverter) geo.rotateZ(Math.PI);
  geo.computeBoundingBox(); geo.translate(-(geo.boundingBox.min.x + geo.boundingBox.max.x) / 2, 0, 0);
  geo.computeVertexNormals();
  return geo;
}
async function procedural(cor) {
  const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js');
  const perna = (x) => new THREE.CylinderGeometry(.14, .17, .72, 24, 1, true).translate(x, -.64, 0);
  const cos = new THREE.CylinderGeometry(.33, .36, .3, 32, 1, true).translate(0, -.15, 0);
  const geo = mergeGeometries([cos, perna(-.17), perna(.17)].map(g => g.toNonIndexed()), false);
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: cor, roughness: .85, side: THREE.DoubleSide }));
}

/* ---------- auto-rig: 5 ossos por posição do vértice ---------- */
function autoRig(mesh) {
  const geo = mesh.geometry; geo.computeBoundingBox();
  const bb = geo.boundingBox, h = bb.max.y - bb.min.y, cx = (bb.min.x + bb.max.x) / 2;
  const yTop = bb.max.y, yQ = yTop - h * GEO.quadril, yG = yTop - h * GEO.gancho, yJ = yTop - h * GEO.joelho, yB = bb.min.y;
  const xE = cx - (bb.max.x - bb.min.x) * .25, xD = cx + (bb.max.x - bb.min.x) * .25;
  // osso = { A: início (topo), B: fim (base) } no espaço do modelo, apontando pra -Y
  bind = {
    cos:    { A: [cx, yTop], B: [cx, yG] },
    coxaE:  { A: [xE, yQ],  B: [xE, yJ] }, canelaE: { A: [xE, yJ], B: [xE, yB] },
    coxaD:  { A: [xD, yQ],  B: [xD, yJ] }, canelaD: { A: [xD, yJ], B: [xD, yB] },
    largura: bb.max.x - bb.min.x, cx,
  };
  const nomes = ['cos', 'coxaE', 'canelaE', 'coxaD', 'canelaD'];
  ossos = nomes.map(n => { const b = new THREE.Bone(); b.name = n; b.position.set(bind[n].A[0], bind[n].A[1], 0); b.updateMatrixWorld(true); return b; });
  const pos = geo.attributes.position, n = pos.count, idx = new Uint16Array(n * 4), w = new Float32Array(n * 4);
  const faixa = h * .06; // zona de mistura nas juntas
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), esq = x < cx;
    const coxa = esq ? 1 : 3, canela = esq ? 2 : 4;
    let pares; // [[osso, peso], ...]
    if (y > yG + faixa) pares = [[0, 1]];
    else if (y > yG - faixa) { const t = (y - (yG - faixa)) / (2 * faixa); pares = [[0, t], [coxa, 1 - t]]; }
    else if (y > yJ + faixa) pares = [[coxa, 1]];
    else if (y > yJ - faixa) { const t = (y - (yJ - faixa)) / (2 * faixa); pares = [[coxa, t], [canela, 1 - t]]; }
    else pares = [[canela, 1]];
    pares.forEach(([o, p], k) => { idx[i * 4 + k] = o; w[i * 4 + k] = p; });
  }
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(w, 4));
  const sk = new THREE.SkinnedMesh(geo, mesh.material);
  // ossos fora da cena: ninguém recalcula o matrixWorld que setamos na mão
  sk.bind(new THREE.Skeleton(ossos)); sk.frustumCulled = false;
  sk.bindMode = 'detached'; // senão o modo 'attached' cancela o skinned.scale (bindMatrixInverse = inverso do matrixWorld)
  return sk;
}

/* ---------- posiciona um osso: leva o segmento de repouso (A→B, -Y) até o alvo (P→Q) na tela ---------- */
const m = {};
let yaw = 0;  // giro do corpo em torno do eixo vertical (rad), a partir da profundidade dos quadris
let esc = 1;  // modelo → pixels; vai em skinned.scale (uniforme), não nos ossos — escala anisotrópica entorta as normais e a luz fica chapada
function poseOsso(nome, P, Q, alongar = 1, k = 1) {
  const b = ossos.find(o => o.name === nome), { A, B } = bind[nome];
  const L0 = A[1] - B[1], L = Math.hypot(Q.x - P.x, Q.y - P.y) * alongar / esc;
  const ang = Math.atan2(Q.y - P.y, Q.x - P.x) - Math.PI / 2; // após o flip em Y, o osso aponta pra +Y da tela; gira até P→Q
  // tela tem y pra baixo; modelo tem y pra cima. -X e -Y = rotação de 180° em Z: inverte Y sem virar as faces do avesso
  m.t.makeTranslation(P.x / esc, P.y / esc, 0); m.r.makeRotationZ(ang); m.s.makeScale(-k, -L / L0, k); m.y.makeRotationY(yaw);
  b.matrixWorld.copy(m.t).multiply(m.r).multiply(m.s).multiply(m.y); // boneInverse (= T(-A)) já leva o vértice pro espaço do osso
}

// onde o osso `nome` (já posicionado) leva o ponto [x,y] do modelo
const v3 = { v: null };
function junta(nome, [x, y]) {
  const b = ossos.find(o => o.name === nome), inv = ossos.indexOf(b);
  v3.v.set(x, y, 0).applyMatrix4(skinned.skeleton.boneInverses[inv]).applyMatrix4(b.matrixWorld);
  return { x: v3.v.x * esc, y: v3.v.y * esc };
}

/* ---------- ciclo ---------- */
let modo = 'provar'; // um Pose só (o WASM do MediaPipe não gosta de duas instâncias): o modo decide quem recebe o frame
function garantirPose() {
  if (pose) return;
  pose = new Pose({ locateFile: f => `${CDN}/${f}` });
  pose.setOptions({ modelComplexity: 1, smoothLandmarks: true, enableSegmentation: true, smoothSegmentation: true,
    minDetectionConfidence: .6, minTrackingConfidence: .6 });
  pose.onResults(r => (modo === 'medir' ? medir(r) : desenhar(r)));
}
window.abrirProvador = async function (p) {
  produto = p; suave = {};
  try { medidas = JSON.parse(localStorage.getItem('medidas')); } catch { medidas = null; }
  const dlg = document.getElementById('provador'), status = dlg.querySelector('.status');
  dlg.querySelector('h3').textContent = `Provador — ${p.nome}`;
  status.textContent = 'Carregando…'; dlg.showModal();
  video = dlg.querySelector('video'); const canvas = dlg.querySelector('canvas');
  try {
    await carregarLibs();
    const [malha, stream] = await Promise.all([
      carregarMalha(p),
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 1280 } } }),
    ]);
    video.srcObject = stream; video.hidden = false; await video.play();
    montarCena(malha, canvas, video.videoWidth, video.videoHeight);
    garantirPose(); modo = 'provar';
    status.textContent = 'Afaste-se até o corpo inteiro aparecer.';
    rodando = true; loop();
  } catch (e) {
    console.error(e);
    status.textContent = e.name === 'NotAllowedError' ? 'Precisamos da câmera para o provador. Libere o acesso e tente de novo.'
      : 'Não foi possível abrir o provador aqui. Tente no celular ou em outro navegador.';
  }
};

function montarCena(malha, canvas, W, H) {
  document.querySelector('#provador .cam').style.aspectRatio = `${W}/${H}`;
  ['t', 'r', 's', 'y'].forEach(k => m[k] = new THREE.Matrix4()); v3.v = new THREE.Vector3();
  // o canvas visível é 2D (compositor: recorta a roupa na silhueta e apaga os braços); o 3D vai num canvas à parte
  canvas.width = W; canvas.height = H; ctx = canvas.getContext('2d');
  ctxLuz = document.createElement('canvas'); ctxLuz.width = ctxLuz.height = 16; ctxLuz = ctxLuz.getContext('2d', { willReadFrequently: true });
  renderer ||= new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), alpha: true, antialias: true });
  renderer.setSize(W, H, false); renderer.setPixelRatio(1);
  scene = new THREE.Scene();
  // y da tela cresce pra baixo → "céu" da hemisférica fica em -Y
  ceu = new THREE.HemisphereLight(0xffffff, 0x8a7a6a, 1.4); ceu.position.set(0, -1, 0);
  luz = new THREE.DirectionalLight(0xffffff, 1.6); luz.position.set(-2, -1, 1.5);
  scene.add(ceu, luz);
  // 1 unidade = 1 pixel, y pra baixo. O flip fica na cena (scale.y = -1), não na câmera: projeção com top<bottom inverte
  // a orientação das faces e o renderer passa a desenhar o avesso (normais constantes, luz chapada).
  cam = new THREE.OrthographicCamera(0, W, 0, -H, -5000, 5000); cam.position.z = 1000;
  scene.scale.y = -1;
  skinned = autoRig(malha); scene.add(skinned);
}

async function loop() { if (!rodando) return; await pose.send({ image: video }); requestAnimationFrame(loop); }

function ponto(lm, i, W, H) {
  const alvo = { x: lm[i].x * W, y: lm[i].y * H }, s = suave[i] || alvo;
  return (suave[i] = { x: s.x + (alvo.x - s.x) * .45, y: s.y + (alvo.y - s.y) * .45 });
}

// luz da cena: média do frame vira cor/intensidade da ambiente, pra roupa não "brilhar" num quarto escuro
let frames = 0;
function casarLuz() {
  if (!video || frames++ % 15) return;
  ctxLuz.drawImage(video, 0, 0, 16, 16);
  const d = ctxLuz.getImageData(0, 0, 16, 16).data;
  let R = 0, G = 0, B = 0;
  for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; B += d[i + 2]; }
  const n = d.length / 4, brilho = (R + G + B) / (3 * n * 255);
  ceu.color.setRGB(R / (n * 255), G / (n * 255), B / (n * 255));
  ceu.intensity = .6 + brilho * 1.6;   // quarto escuro → roupa escura
  luz.intensity = .5 + brilho * 1.8;
}

// braços/mãos na frente das pernas: cápsulas no traçado do antebraço, só quando estão mais perto que o quadril
function apagarBracos(lm, W, H) {
  const zq = (lm[23].z + lm[24].z) / 2;
  const ombro = Math.hypot((lm[11].x - lm[12].x) * W, (lm[11].y - lm[12].y) * H) || W * .3;
  ctx.globalCompositeOperation = 'destination-out';
  ctx.lineCap = 'round'; ctx.strokeStyle = '#000'; ctx.lineWidth = ombro * .30;
  for (const [a, b] of ARMS) {
    if (lm[a].visibility < .4 || lm[b].visibility < .4) continue;
    if ((lm[a].z + lm[b].z) / 2 > zq) continue;        // atrás do quadril: não apaga
    ctx.beginPath();
    ctx.moveTo(lm[a].x * W, lm[a].y * H); ctx.lineTo(lm[b].x * W, lm[b].y * H); ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}

// compõe: roupa → recorta na silhueta da pessoa → apaga os braços que estão na frente
function compor(r, W, H, ok) {
  ctx.clearRect(0, 0, W, H);
  if (!ok) return;
  ctx.drawImage(renderer.domElement, 0, 0, W, H);
  if (r.segmentationMask) {
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(r.segmentationMask, 0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
  }
  apagarBracos(r.poseLandmarks, W, H);
}

function desenhar(r, W = video.videoWidth, H = video.videoHeight) {
  const status = document.querySelector('#provador .status'), lm = r.poseLandmarks;
  // de lado uma perna some atrás da outra: exige só quadris + pelo menos um joelho/tornozelo de cada lado razoáveis
  const ok = lm && lm[23].visibility > .5 && lm[24].visibility > .5 && [25, 26, 27, 28].every(i => lm[i].visibility > .25);
  skinned.visible = !!ok;
  if (ok) {
    const P = i => ponto(lm, i, W, H);
    const qE = P(23), qD = P(24), jE = P(25), jD = P(26), tE = P(27), tD = P(28);
    const quadril = { x: (qE.x + qD.x) / 2, y: (qE.y + qD.y) / 2 };
    // largura do quadril em 3D (z do MediaPipe está na escala da largura da imagem) — não afina quando vira de lado
    const dz = (lm[23].z - lm[24].z) * W;
    const largQ = Math.hypot(qE.x - qD.x, qE.y - qD.y, dz);
    yaw = Math.atan2(dz, lm[23].x * W - lm[24].x * W); // perna esquerda (23) mais perto → gira o lado xD pra câmera
    esc = (largQ * 1.75) / bind.largura; // quadril real ≈ 1.75× distância entre as juntas
    skinned.scale.setScalar(esc); skinned.updateMatrixWorld();
    // espessura por segmento: a calça segue o corpo em vez de ser um tubo de largura fixa.
    // cós = razão cintura/quadril da cliente (0,78 é a proporção média do modelo); pernas afinam junto.
    const razao = medidas ? Math.min(1.15, Math.max(.8, (medidas.cintura / medidas.quadril) / .78)) : 1;
    // coxa/canela: perna longa em relação ao quadril = perna mais fina (e vice-versa)
    const perna = Math.hypot(tE.x - qE.x, tE.y - qE.y) / largQ;
    const fino = Math.min(1.12, Math.max(.88, 3.1 / perna));
    // cós segue o quadril; coxas nascem onde o cós levou a junta (continuidade), canelas idem a partir da coxa
    poseOsso('cos', { x: quadril.x, y: quadril.y - largQ * .55 }, { x: quadril.x, y: quadril.y + largQ * .4 }, 1, razao);
    // a escala -X espelha o modelo: lado x<cx cai na direita da tela = perna esquerda da pessoa (23/25/27)
    poseOsso('coxaE', junta('cos', bind.coxaE.A), jE, 1.06, fino);
    poseOsso('coxaD', junta('cos', bind.coxaD.A), jD, 1.06, fino);
    poseOsso('canelaE', junta('coxaE', bind.canelaE.A), tE, 1.05, fino);
    poseOsso('canelaD', junta('coxaD', bind.canelaD.A), tD, 1.05, fino);
    casarLuz();
    status.textContent = '';
  } else status.textContent = 'Afaste-se até o corpo inteiro aparecer.';
  renderer.render(scene, cam);
  compor(r, W, H, ok);
}

window.fecharProvador = function () {
  rodando = false;
  video?.srcObject?.getTracks().forEach(t => t.stop());
  if (skinned) { scene.remove(skinned); skinned.geometry.dispose(); skinned = null; }
  document.getElementById('provador').close();
};

/* ---------- medição pela câmera: altura informada → cintura, quadril e comprimento ----------
   Altura em cm ÷ altura da silhueta em px = cm por px. Duas posições: de frente dá a largura da cintura e do quadril,
   de lado dá a profundidade nas mesmas alturas; a volta é a elipse com esses dois eixos.
   ponytail: elipse + máscara do MediaPipe (erro típico de 2 a 4 cm). AJUSTE calibra contra fita métrica; upgrade = modelo
   de corpo (SMPL) ou mais vistas. */
const MED = { amostras: 12, AJUSTE: { cintura: 1, quadril: 1, comprimento: 1 } };
let med, vMed, ctxMed, ctxMask, fonte, corte; // fonte = canvas em pé que vai pro Pose (o vídeo recortado)

// máscara de segmentação → grade 0/1 pequena (240 px de largura basta pra medir e é rápida)
function lerMascara(mask, W, H) {
  const w = 240, h = Math.round(H * w / W);
  if (!ctxMask) ctxMask = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  ctxMask.canvas.width = w; ctxMask.canvas.height = h;
  ctxMask.drawImage(mask, 0, 0, w, h);
  const d = ctxMask.getImageData(0, 0, w, h).data, p = new Uint8Array(w * h);
  let canal = 0; // vermelho, a menos que o alfa varie (aí a silhueta está no alfa)
  for (let i = 3; i < d.length; i += 4) if (d[i] < 255) { canal = 3; break; }
  for (let i = 0; i < p.length; i++) p[i] = d[i * 4 + canal] > 127;
  return { p, w, h };
}
const cheio = (m, x, y) => x >= 0 && y >= 0 && x < m.w && y < m.h && m.p[y * m.w + x];
// largura do trecho contínuo da silhueta que passa por cx na linha y (braço afastado fica de fora; vão entre as pernas = 0)
function largura(m, y, cx) {
  y = Math.round(y); cx = Math.round(cx);
  if (!cheio(m, cx, y)) return 0;
  let a = cx, b = cx;
  while (cheio(m, a - 1, y)) a--;
  while (cheio(m, b + 1, y)) b++;
  return b - a + 1;
}
// topo da cabeça: primeira linha com silhueta numa faixa em volta do centro do corpo
function topo(m, cx, meia) {
  for (let y = 0; y < m.h; y++) for (let x = Math.max(0, Math.round(cx - meia)); x <= Math.min(m.w - 1, Math.round(cx + meia)); x++) if (m.p[y * m.w + x]) return y;
  return -1;
}
// chão: desce do calcanhar enquanto houver silhueta (a sola fica abaixo do ponto do calcanhar)
function chao(m, L) {
  let base = 0;
  for (const i of [29, 30, 31, 32]) {
    let y = Math.round(L(i).y); const x = Math.round(L(i).x);
    while (cheio(m, x, y + 1)) y++;
    base = Math.max(base, y);
  }
  return base;
}
const mediana = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
// perímetro da elipse (Ramanujan) com largura e profundidade em cm
const elipse = (l, p) => { const a = l / 2, b = p / 2; return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b))); };

function amostraFrente(m, L, lm) {
  const precisa = [0, 11, 12, 23, 24, 27, 28, 29, 30];
  if (precisa.some(i => lm[i].visibility < .6)) return 'Afaste-se até o corpo inteiro aparecer, da cabeça aos pés.';
  if ([29, 30, 31, 32].some(i => lm[i].y > .985) || lm[0].y < .05) return 'Afaste-se um pouco: a cabeça e os pés precisam caber com folga.';
  const cx = (L(23).x + L(24).x) / 2, ombroY = (L(11).y + L(12).y) / 2, quadY = (L(23).y + L(24).y) / 2, tronco = quadY - ombroY;
  const top = topo(m, cx, m.w * .08), base = chao(m, L), hp = base - top;
  if (top < 0 || hp < m.h * .45) return 'Chegue um pouco mais perto: o corpo está pequeno no quadro.';
  if (Math.abs(L(11).x - L(12).x) / hp < .12) return 'Fique de frente para a câmera.';
  let cint = { w: 1e9, y: 0 }, quad = { w: 0, y: 0 };
  for (let y = ombroY + tronco * .45; y <= quadY - tronco * .05; y++) { const w = largura(m, y, cx); if (w && w < cint.w) cint = { w, y }; }
  for (let y = quadY - tronco * .05; y <= quadY + tronco * .35; y++) { const w = largura(m, y, cx); if (w > quad.w) quad = { w, y }; }
  if (!quad.w || cint.w === 1e9) return 'Use roupa justa e fique com o fundo livre atrás de você.';
  // braço colado no quadril engorda a largura: o pulso não pode cair dentro do trecho medido
  const meio = quad.w / 2;
  if ([15, 16].some(i => Math.abs(L(i).x - cx) < meio + 2 && Math.abs(L(i).y - quad.y) < tronco * .4)) return 'Afaste os braços do corpo.';
  const cm = med.altura / hp;
  return { cm, cint: cint.w * cm, quad: quad.w * cm, cintRel: (cint.y - top) / hp, quadRel: (quad.y - top) / hp, perna: (base - cint.y) * cm,
    linhas: [cint.y / m.h, quad.y / m.h] };
}

function amostraLado(m, L, lm) {
  const ok = i => lm[i].visibility > .5;
  if (!(ok(23) || ok(24)) || !([27, 28, 29, 30].some(ok))) return 'Afaste-se até o corpo inteiro aparecer, da cabeça aos pés.';
  const quadris = [23, 24].filter(ok), cx = quadris.reduce((s, i) => s + L(i).x, 0) / quadris.length;
  const top = topo(m, cx, m.w * .1), base = chao(m, L), hp = base - top;
  if (top < 0 || hp < m.h * .45) return 'Chegue um pouco mais perto: o corpo está pequeno no quadro.';
  if (Math.abs(L(11).x - L(12).x) / hp > .07) return 'Vire de lado para a câmera, com os braços cruzados no peito.';
  const f = med.frente, cm = med.altura / hp, faixa = (rel, ext) => {
    const ws = []; for (let k = -2; k <= 2; k++) ws.push(largura(m, top + (rel + k * .006) * hp, cx));
    return ext === 'max' ? Math.max(...ws) : mediana(ws.filter(Boolean)) || 0;
  };
  const pc = faixa(f.cintRel, 'med'), pq = faixa(f.quadRel, 'max');
  if (!pc || !pq) return 'Use roupa justa e fique com o fundo livre atrás de você.';
  return { cint: pc * cm, quad: pq * cm };
}

function medir(r) {
  if (!vMed) return;
  const W = fonte.width, H = fonte.height, lm = r.poseLandmarks, c = ctxMed;
  c.canvas.width = W; c.canvas.height = H; c.drawImage(r.image, 0, 0, W, H);
  if (!lm || !r.segmentationMask) return aviso('Afaste-se até o corpo inteiro aparecer, da cabeça aos pés.');
  const m = lerMascara(r.segmentationMask, W, H), L = i => ({ x: lm[i].x * m.w, y: lm[i].y * m.h });
  const a = med.passo === 'frente' ? amostraFrente(m, L, lm) : amostraLado(m, L, lm);
  if (typeof a === 'string') return aviso(a);
  med.lista.push(a);
  aviso(med.passo === 'frente' ? 'Fique parada, medindo de frente…' : 'Fique parada, medindo de lado…');
  // linhas da cintura e do quadril, pra cliente ver onde está sendo medido
  if (a.linhas) {
    c.strokeStyle = '#f7f3ee'; c.lineWidth = Math.max(2, W / 240); c.setLineDash([10, 8]);
    for (const f of a.linhas) { c.beginPath(); c.moveTo(0, f * H); c.lineTo(W, f * H); c.stroke(); }
  }
  med.barra.style.width = `${Math.round(100 * med.lista.length / MED.amostras)}%`;
  if (med.lista.length < MED.amostras) return;
  if (med.passo === 'frente') {
    const l = med.lista, pega = k => mediana(l.map(s => s[k]));
    med.frente = { cint: pega('cint'), quad: pega('quad'), cintRel: pega('cintRel'), quadRel: pega('quadRel'), perna: pega('perna') };
    med.passo = 'lado'; med.lista = []; med.barra.style.width = '0%';
    med.passos[0].classList.add('feito'); med.passos[1].classList.add('agora');
    return aviso('Pronto, a frente está medida. Agora vire de lado, com os braços cruzados no peito.', true);
  }
  const f = med.frente, pc = mediana(med.lista.map(s => s.cint)), pq = mediana(med.lista.map(s => s.quad));
  // bruto = antes do AJUSTE: é o que a calibração (calibrar.html) compara com a fita
  const bruto = { cintura: elipse(f.cint, pc), quadril: elipse(f.quad, pq), comprimento: f.perna };
  const res = {
    altura: med.altura,
    cintura: Math.round(bruto.cintura * MED.AJUSTE.cintura),
    quadril: Math.round(bruto.quadril * MED.AJUSTE.quadril),
    comprimento: Math.round(bruto.comprimento * MED.AJUSTE.comprimento),
    bruto: { cintura: +bruto.cintura.toFixed(1), quadril: +bruto.quadril.toFixed(1), comprimento: +bruto.comprimento.toFixed(1) },
  };
  // fora do que a tabela atende = leitura ruim (roupa larga, fundo confuso): mede de novo em vez de salvar lixo
  if (res.cintura < 55 || res.cintura > 120 || res.quadril < 70 || res.quadril > 140 || res.quadril < res.cintura || res.comprimento < 60 || res.comprimento > 110) {
    med.passo = 'frente'; med.lista = []; med.frente = null; med.barra.style.width = '0%';
    med.passos.forEach(p => p.classList.remove('feito', 'agora')); med.passos[0].classList.add('agora');
    return aviso('A leitura não ficou boa. Com roupa justa e fundo liso, fique de frente de novo.', true);
  }
  falar('Pronto, medidas feitas. Pode voltar ao celular.', true);
  pararMedicao(false); med.ok(res);
}
/* ---------- voz: a cliente está a 2,5 m e não lê a tela ----------
   Os avisos mudam a cada frame (um frame sem pé, outro com): só fala o que ficou 1 s na tela, e repete a cada 8 s se
   ela continuar sem acertar. gora = troca de fase, fala na hora por cima do que estiver falando. */
const voz = { alvo: '', desde: 0, falado: '', quando: 0, ligada: localStorage.getItem('vozMedicao') !== 'off' };
function falar(t, agora = false) {
  if (!voz.ligada || !('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(t), vs = speechSynthesis.getVoices();
  u.lang = 'pt-BR'; u.voice = vs.find(v => /pt[-_]BR/i.test(v.lang)) || vs.find(v => /^pt/i.test(v.lang)) || null;
  if (agora) speechSynthesis.cancel();
  speechSynthesis.speak(u); voz.falado = t; voz.quando = performance.now();
}
function aviso(t, agora = false) {
  if (med.status.textContent !== t) med.status.textContent = t;
  const ms = performance.now();
  if (agora) { voz.alvo = t; return falar(t, true); }
  if (t !== voz.alvo) { voz.alvo = t; voz.desde = ms; return; }
  if (ms - voz.desde < 1000 || speechSynthesis.speaking) return;
  if (t !== voz.falado || ms - voz.quando > 8000) falar(t);
}

async function loopMedir() {
  if (modo !== 'medir' || !rodando) return;
  fonte.getContext('2d').drawImage(vMed, corte.x, 0, corte.w, corte.h, 0, 0, corte.w, corte.h);
  await pose.send({ image: fonte }); requestAnimationFrame(loopMedir);
}
// vídeo deitado com o celular em pé (vários Android ignoram o pedido de 9:16): usa só a faixa do meio, em 9:16.
// A pessoa fica no centro e a medição vê exatamente o que aparece na tela.
// ponytail: perde resolução (a faixa tem ~56% da largura); se medir mal em câmera fraca, pedir 1920x1080.
function cortar(vw, vh) {
  const emPe = innerHeight > innerWidth;
  const w = emPe && vw > vh ? Math.round(vh * 9 / 16) : vw;
  corte = { x: Math.round((vw - w) / 2), w, h: vh };
  fonte ||= document.createElement('canvas');
  fonte.width = w; fonte.height = vh;
}

function pararMedicao(calar = true) {
  rodando = false; modo = 'provar';
  if (calar && 'speechSynthesis' in window) speechSynthesis.cancel();
  document.querySelector('#medicao .tutorial-video')?.pause();
  vMed?.srcObject?.getTracks().forEach(t => t.stop());
  document.getElementById('medicao').close();
}

// abre a medição; resolve com { altura, cintura, quadril, comprimento } ou rejeita ('cancelada', 'camera', 'erro')
window.medirCorpo = function (altura) {
  return new Promise(async (ok, falha) => {
    const dlg = document.getElementById('medicao');
    vMed = dlg.querySelector('.cam video'); ctxMed = dlg.querySelector('canvas').getContext('2d');
    med = { altura, passo: 'frente', lista: [], frente: null, ok, status: dlg.querySelector('.status'), barra: dlg.querySelector('.progresso i'),
      passos: [...dlg.querySelectorAll('.passos li')] };
    med.passos.forEach(p => p.classList.remove('feito', 'agora')); med.passos[0].classList.add('agora'); med.barra.style.width = '0%';
    dlg.querySelector('.medicao-fechar').onclick = () => { pararMedicao(); falha(new Error('cancelada')); };
    dlg.oncancel = () => { pararMedicao(); falha(new Error('cancelada')); };
    // 1º o tutorial em vídeo; a câmera só abre no botão (esse toque também libera a voz no iPhone)
    const tut = dlg.querySelector('.etapa-tutorial'), cam = dlg.querySelector('.etapa-camera'), filme = dlg.querySelector('.tutorial-video');
    tut.hidden = false; cam.hidden = true; filme.currentTime = 0; dlg.showModal(); filme.play().catch(() => {});
    const vozBtn = dlg.querySelector('.voz-btn'), pintarVoz = () => { vozBtn.setAttribute('aria-pressed', voz.ligada); vozBtn.textContent = voz.ligada ? 'Voz ligada' : 'Voz desligada'; };
    pintarVoz();
    vozBtn.onclick = () => { voz.ligada = !voz.ligada; localStorage.setItem('vozMedicao', voz.ligada ? 'on' : 'off'); if (!voz.ligada) speechSynthesis.cancel(); pintarVoz(); };
    await new Promise(seguir => (dlg.querySelector('.comecar').onclick = seguir));
    filme.pause(); tut.hidden = true; cam.hidden = false;
    voz.alvo = voz.falado = '';
    aviso('Abrindo a câmera. Apoie o celular em pé e afaste-se até o corpo inteiro aparecer.', true);
    try {
      await carregarLibs();
      // em pé: pede o vídeo na vertical (9:16), senão o celular manda paisagem e a pessoa fica pequena
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 1280 }, aspectRatio: { ideal: 9 / 16 } } });
      vMed.srcObject = stream; await vMed.play();
      cortar(vMed.videoWidth, vMed.videoHeight);
      dlg.querySelector('.cam').style.aspectRatio = `${corte.w}/${corte.h}`;
      dlg.classList.toggle('paisagem', corte.w > corte.h);
      garantirPose(); modo = 'medir'; rodando = true;
      loopMedir();
    } catch (e) {
      console.error(e); pararMedicao();
      falha(new Error(e.name === 'NotAllowedError' || e.name === 'NotFoundError' ? 'camera' : 'erro'));
    }
  });
};

// exposto pra teste sem câmera
window._medicao = { lerMascara, largura, topo, elipse, amostraFrente, amostraLado, set: v => { med = v; } };
window._provador = { carregarLibs, carregarMalha, montarCena, desenhar, casarLuz,
  setVideo: v => { video = v; }, get: () => ({ THREE, scene, cam, skinned, ossos, bind, ceu, luz, ctx }) };
