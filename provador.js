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
// deixa a calça de pé: eixo mais longo vira Y, cós pra cima (o lado com as duas pernas separadas é a barra)
function normalizar(geo) {
  geo.computeBoundingBox(); const t = geo.boundingBox.max.clone().sub(geo.boundingBox.min);
  if (t.z > t.y && t.z > t.x) geo.rotateX(-Math.PI / 2);
  else if (t.x > t.y && t.x > t.z) geo.rotateZ(Math.PI / 2);
  geo.computeBoundingBox();
  const bb = geo.boundingBox, h = bb.max.y - bb.min.y, cx = (bb.min.x + bb.max.x) / 2, pos = geo.attributes.position;
  // fatia a 12% de cada ponta: quantos vértices perto do centro em x? cós tem, barra (duas pernas) não
  const perto = (y0, y1) => { let n = 0; for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); if (y > y0 && y < y1 && Math.abs(pos.getX(i) - cx) < (bb.max.x - bb.min.x) * .08) n++; } return n; };
  const topo = perto(bb.max.y - h * .15, bb.max.y - h * .05), base = perto(bb.min.y + h * .05, bb.min.y + h * .15);
  if (base > topo) geo.rotateZ(Math.PI);
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
  return sk;
}

/* ---------- posiciona um osso: leva o segmento de repouso (A→B, -Y) até o alvo (P→Q) na tela ---------- */
const m = {};
function poseOsso(nome, P, Q, escalaX, alongar = 1) {
  const b = ossos.find(o => o.name === nome), { A, B } = bind[nome];
  const L0 = A[1] - B[1], L = Math.hypot(Q.x - P.x, Q.y - P.y) * alongar;
  const ang = Math.atan2(Q.y - P.y, Q.x - P.x) - Math.PI / 2; // após o flip em Y, o osso aponta pra +Y da tela; gira até P→Q
  // tela tem y pra baixo; modelo tem y pra cima → escala Y negativa inverte
  m.t.makeTranslation(P.x, P.y, 0); m.r.makeRotationZ(ang); m.s.makeScale(escalaX, -L / L0, escalaX);
  b.matrixWorld.copy(m.t).multiply(m.r).multiply(m.s); // boneInverse (= T(-A)) já leva o vértice pro espaço do osso
}

// onde o osso `nome` (já posicionado) leva o ponto [x,y] do modelo
const v3 = { v: null };
function junta(nome, [x, y]) {
  const b = ossos.find(o => o.name === nome), inv = ossos.indexOf(b);
  v3.v.set(x, y, 0).applyMatrix4(skinned.skeleton.boneInverses[inv]).applyMatrix4(b.matrixWorld);
  return { x: v3.v.x, y: v3.v.y };
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
  ['t', 'r', 's'].forEach(k => m[k] = new THREE.Matrix4()); v3.v = new THREE.Vector3();
  renderer ||= new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setSize(W, H, false); renderer.setPixelRatio(1);
  scene = new THREE.Scene();
  const luz = new THREE.DirectionalLight(0xffffff, 1.4); luz.position.set(-1, -1, 2);
  scene.add(new THREE.AmbientLight(0xffffff, 1.6), luz);
  cam = new THREE.OrthographicCamera(0, W, 0, H, -5000, 5000); cam.position.z = 1000; // 1 unidade = 1 pixel, y pra baixo
  skinned = autoRig(malha); scene.add(skinned);
}

async function loop() { if (!rodando) return; await pose.send({ image: video }); requestAnimationFrame(loop); }

function ponto(lm, i, W, H) {
  const alvo = { x: lm[i].x * W, y: lm[i].y * H }, s = suave[i] || alvo;
  return (suave[i] = { x: s.x + (alvo.x - s.x) * .45, y: s.y + (alvo.y - s.y) * .45 });
}

function desenhar(r, W = video.videoWidth, H = video.videoHeight) {
  const status = document.querySelector('#provador .status'), lm = r.poseLandmarks;
  const ok = lm && [23, 24, 25, 26, 27, 28].every(i => lm[i].visibility > .5);
  skinned.visible = !!ok;
  if (ok) {
    const P = i => ponto(lm, i, W, H);
    const qE = P(23), qD = P(24), jE = P(25), jD = P(26), tE = P(27), tD = P(28);
    const quadril = { x: (qE.x + qD.x) / 2, y: (qE.y + qD.y) / 2 };
    const largQ = Math.hypot(qE.x - qD.x, qE.y - qD.y);
    const esc = (largQ * 1.75) / bind.largura; // modelo → pixels (quadril real ≈ 1.75× distância entre as juntas)
    // cós segue o quadril; coxas nascem onde o cós levou a junta (continuidade), canelas idem a partir da coxa
    poseOsso('cos', { x: quadril.x, y: quadril.y - largQ * .55 }, { x: quadril.x, y: quadril.y + largQ * .4 }, esc);
    // modelo de frente pra câmera: lado x<cx = perna direita da pessoa = landmarks pares (24/26/28)
    poseOsso('coxaE', junta('cos', bind.coxaE.A), jD, esc, 1.06);
    poseOsso('coxaD', junta('cos', bind.coxaD.A), jE, esc, 1.06);
    poseOsso('canelaE', junta('coxaE', bind.canelaE.A), tD, esc, 1.05);
    poseOsso('canelaD', junta('coxaD', bind.canelaD.A), tE, esc, 1.05);
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
