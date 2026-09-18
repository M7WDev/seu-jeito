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
function poseOsso(nome, P, Q, alongar = 1) {
  const b = ossos.find(o => o.name === nome), { A, B } = bind[nome];
  const L0 = A[1] - B[1], L = Math.hypot(Q.x - P.x, Q.y - P.y) * alongar / esc;
  const ang = Math.atan2(Q.y - P.y, Q.x - P.x) - Math.PI / 2; // após o flip em Y, o osso aponta pra +Y da tela; gira até P→Q
  // tela tem y pra baixo; modelo tem y pra cima. -X e -Y = rotação de 180° em Z: inverte Y sem virar as faces do avesso
  m.t.makeTranslation(P.x / esc, P.y / esc, 0); m.r.makeRotationZ(ang); m.s.makeScale(-1, -L / L0, 1); m.y.makeRotationY(yaw);
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
window.abrirProvador = async function (p) {
  produto = p; suave = {};
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
    if (!pose) {
      pose = new Pose({ locateFile: f => `${CDN}/${f}` });
      pose.setOptions({ modelComplexity: 1, smoothLandmarks: true, minDetectionConfidence: .6, minTrackingConfidence: .6 });
      pose.onResults(desenhar);
    }
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
  renderer ||= new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setSize(W, H, false); renderer.setPixelRatio(1);
  scene = new THREE.Scene();
  // y da tela cresce pra baixo → "céu" da hemisférica fica em -Y
  const ceu = new THREE.HemisphereLight(0xffffff, 0x8a7a6a, 1.4); ceu.position.set(0, -1, 0);
  const luz = new THREE.DirectionalLight(0xffffff, 1.6); luz.position.set(-2, -1, 1.5);
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
    // cós segue o quadril; coxas nascem onde o cós levou a junta (continuidade), canelas idem a partir da coxa
    poseOsso('cos', { x: quadril.x, y: quadril.y - largQ * .55 }, { x: quadril.x, y: quadril.y + largQ * .4 });
    // a escala -X espelha o modelo: lado x<cx cai na direita da tela = perna esquerda da pessoa (23/25/27)
    poseOsso('coxaE', junta('cos', bind.coxaE.A), jE, 1.06);
    poseOsso('coxaD', junta('cos', bind.coxaD.A), jD, 1.06);
    poseOsso('canelaE', junta('coxaE', bind.canelaE.A), tE, 1.05);
    poseOsso('canelaD', junta('coxaD', bind.canelaD.A), tD, 1.05);
    status.textContent = '';
  } else status.textContent = 'Afaste-se até o corpo inteiro aparecer.';
  renderer.render(scene, cam);
}

window.fecharProvador = function () {
  rodando = false;
  video?.srcObject?.getTracks().forEach(t => t.stop());
  if (skinned) { scene.remove(skinned); skinned.geometry.dispose(); skinned = null; }
  document.getElementById('provador').close();
};

// exposto pra teste sem câmera
window._provador = { carregarLibs, carregarMalha, montarCena, desenhar, get: () => ({ THREE, scene, cam, skinned, ossos, bind }) };
