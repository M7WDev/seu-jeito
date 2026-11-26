// Mundo 3D: um palco fixo atrás da abertura, do manifesto e da coleção. A rolagem leva a câmera de parada em parada e os
// blocos se rearranjam em volta de cada modelo. Só Three.js: um InstancedMesh, fotos recortadas em planos e poeira.
// Sem WebGL, aparelho fraco, economia de dados ou movimento reduzido: fica a página estática (sem a classe cena-3d).
const raiz = document.documentElement;
const mundo = document.querySelector('.mundo'), secao = document.getElementById('abertura');
const manifesto = document.getElementById('manifesto'), colecao = document.getElementById('modelos');
new IntersectionObserver(([e]) => raiz.classList.toggle('na-abertura', e.isIntersecting), { rootMargin: '0px 0px -90% 0px' }).observe(secao);

const semCena = () => raiz.classList.remove('cena-3d', 'cena-pronta');

const LINHAS = [['NÃO É', 'VOCÊ'], ['QUE', 'PRECISA'], ['SE', 'AJUSTAR.']];
const FONTE = '"Bodoni Moda", "Didot", serif';
const FOTOS = ['hero', null, 'reta', 'pantalona', 'cenoura', 'cigarrete']; // por parada; a 1 é o manifesto
const PASSO = 11; // distância entre paradas
const entre = (a, b, v) => Math.min(1, Math.max(0, (v - a) / (b - a)));
const macio = x => x * x * (3 - 2 * x);
const mistura = (a, b, k) => a + (b - a) * k;

async function cena() {
  const fraco = matchMedia('(max-width: 820px), (pointer: coarse)').matches;
  const [THREE, { RoundedBoxGeometry }] = await Promise.all([import('three'), import('three/addons/geometries/RoundedBoxGeometry.js'),
    document.fonts.load(`600 200px ${FONTE}`, 'NÃO')]);
  const canvas = mundo.querySelector('canvas'), claro = mundo.querySelector('.abertura__claro'), pe = secao.querySelector('.abertura__pe');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  let dpr = Math.min(devicePixelRatio, fraco ? 1.5 : 2);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = !fraco;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene(), NEVOA = '#efe3d2';
  scene.background = new THREE.Color(NEVOA);
  scene.fog = new THREE.Fog(NEVOA, 7, 21);
  const camera = new THREE.PerspectiveCamera(32, 1, .1, 40);
  scene.add(new THREE.HemisphereLight('#fffaf2', '#efe0cc', 1.9));
  const sol = new THREE.DirectionalLight('#ffe9cd', 1.9);
  sol.castShadow = !fraco; sol.shadow.mapSize.setScalar(1024);
  Object.assign(sol.shadow.camera, { left: -5, right: 5, top: 6, bottom: -3, near: 1, far: 22 });
  sol.shadow.bias = -.0008; sol.shadow.normalBias = .03;
  scene.add(sol, sol.target);

  // chão liso que some na névoa
  const chao = new THREE.Mesh(new THREE.PlaneGeometry(60, 110).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#ecdcc6', roughness: 1 }));
  chao.position.z = -35; chao.receiveShadow = true; scene.add(chao);

  /* ---------- paradas: modelo + pódio ---------- */
  const ALT = 3, PISO = .22;
  const carregar = new THREE.TextureLoader();
  const cs = document.createElement('canvas'); cs.width = cs.height = 64;
  { const x = cs.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(70,40,15,.5)'); g.addColorStop(1, 'rgba(70,40,15,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); }
  const sombraTex = new THREE.CanvasTexture(cs);
  const discoGeo = new THREE.CylinderGeometry(1.25, 1.25, PISO, 72), pedra = new THREE.MeshStandardMaterial({ color: '#f2e4cf', roughness: .9 });
  const paradas = FOTOS.map((nome, i) => ({ nome, z: -i * PASSO, x: 0, grupo: null, mat: null, pedida: false }));
  function montar(p) { // só busca a foto quando a câmera chega perto
    p.pedida = true;
    return carregar.loadAsync(`img/modelo-${p.nome}.webp`).then(tex => {
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
      const larg = ALT * tex.image.width / tex.image.height;
      p.grupo = new THREE.Group(); p.grupo.position.set(p.x, 0, p.z);
      const disco = new THREE.Mesh(discoGeo, pedra); disco.position.y = PISO / 2; disco.receiveShadow = disco.castShadow = true;
      p.mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: .03, toneMapped: false, fog: false });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(larg, ALT), p.mat);
      m.position.set(0, PISO + ALT / 2 - .03, .25); m.castShadow = true; m.renderOrder = 3;
      m.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: .5, side: THREE.DoubleSide });
      p.sombra = new THREE.MeshBasicMaterial({ map: sombraTex, transparent: true, depthWrite: false, toneMapped: false });
      const s = new THREE.Mesh(new THREE.PlaneGeometry(larg * 1.25, .42).rotateX(-Math.PI / 2), p.sombra);
      s.position.set(0, PISO + .006, .28); s.renderOrder = 2;
      p.grupo.add(disco, m, s); scene.add(p.grupo);
      renderer.initTexture(tex);
    }).catch(() => {});
  }

  /* ---------- blocos: 78 peças, uma forma por parada ---------- */
  const N = 78, blocos = new THREE.InstancedMesh(new RoundedBoxGeometry(1, 1, 1, 2, .05), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .82 }), N);
  blocos.castShadow = blocos.receiveShadow = true; blocos.frustumCulled = false;
  scene.add(blocos);
  let semente = 7; const acaso = () => (semente = (semente * 16807) % 2147483647) / 2147483647;
  const sorte = Array.from({ length: N }, () => ({ a: acaso(), b: acaso(), c: acaso(), d: acaso() }));
  const tons = ['#f4e6d0', '#eddabf', '#e6cfae', '#f7eddd'].map(c => new THREE.Color(c));
  sorte.forEach((s, i) => blocos.setColorAt(i, tons[Math.floor(s.d * 4)]));
  // cada forma devolve posição, giro (z) e tamanho do bloco i, com a parada na origem
  const anel = (i, n, r, y, de, ate, larg, prof, z = -.75) => { const a = mistura(de, ate, n > 1 ? i / (n - 1) : 0); return { x: Math.cos(a) * r, y: y + Math.sin(a) * r, z, g: a, s: [larg, Math.abs(ate - de) * r / Math.max(1, n - 1) * .94, prof] }; };
  const arco = i => { // três arcos encaixados, um atrás do outro
    const k = i % 3, j = Math.floor(i / 3), r = 1.75 + k * .56, z = -.9 - k * .5; // 26 por arco
    if (j < 6) return { x: -r, y: .3 + j * .42, z, g: 0, s: [.5, .4, .7] };
    if (j < 12) return { x: r, y: .3 + (j - 6) * .42, z, g: 0, s: [.5, .4, .7] };
    return anel(j - 12, 14, r, 2.62, .08, Math.PI - .08, .5, .7, z);
  };
  const roda = i => { const k = i < 32 ? 0 : 1, n = k ? 46 : 32; const p = anel(k ? i - 32 : i, n, 1.72 + k * .48, 1.9, 0, Math.PI * 2 * (1 - 1 / n), .42, .5, -1 - k * .3); return p; };
  const portal = i => { // moldura reta em duas camadas
    const k = i % 2, j = Math.floor(i / 2), L = 1.3 + k * .4, T = 3.75 + k * .5, z = -1 - k * .45;
    if (j < 14) return { x: -L, y: .16 + j * (T / 14), z, g: 0, s: [.45, T / 14 * .94, .5] };
    if (j < 28) return { x: L, y: .16 + (j - 14) * (T / 14), z, g: 0, s: [.45, T / 14 * .94, .5] };
    return { x: mistura(-L, L, (j - 28) / 10), y: T + .1, z, g: 0, s: [L / 5 * .94, .42, .5] };
  };
  const escada = i => { const a = i / N * Math.PI * 3.4 - .4, r = 1.75; return { x: Math.cos(a) * r, y: .1 + i / N * 4.3, z: -.6 + Math.sin(a) * r * .6 - .9, g: 0, s: [.62, .2, .62], gy: -a }; };
  const solto = i => { const s = sorte[i]; return { x: (s.a < .5 ? -1 : 1) * (.8 + s.b * 6), y: .3 + s.c * 5.5, z: -2.5 - s.d * 9, g: s.a * 6, gx: s.b * 5, s: [.2 + s.c * .42, .2 + s.a * .42, .2 + s.b * .42] }; };
  const fundo = i => { const p = arco(i); return { ...p, x: p.x * 1.25, y: p.y * 1.1, z: p.z - 2.4, s: p.s.map(v => v * 1.2) }; }; // na abertura o arco fica atrás da frase
  const justo = i => { const p = arco(i); return { ...p, x: p.x * .68, s: [p.s[0] * .68, p.s[1], p.s[2]] }; };
  const formas = [fundo, solto, portal, roda, justo, escada, solto];
  const prontos = formas.map((f, k) => Array.from({ length: N }, (_, i) => f(i)));
  const salto = new Float32Array(N), V = new THREE.Vector3(), ponteiro = { x: 9, y: 9 };
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), P = new THREE.Vector3(), S = new THREE.Vector3();
  const lugar = (k, i) => prontos[k][i];
  function arranjar(s, t) {
    const k = Math.min(5, Math.floor(s)), f = s - k;
    const A = paradas[k], zB = k < 5 ? paradas[k + 1].z : -6 * PASSO, xB = k < 5 ? paradas[k + 1].x : 0;
    for (let i = 0; i < N; i++) {
      const r = sorte[i], q = macio(entre(.08 + r.c * .28, .62 + r.c * .3, f)); // cada bloco sai na sua hora
      const a = lugar(k, i), b = lugar(k + 1, i), alto = Math.sin(q * Math.PI);
      const vivo = (k === 1 && q < 1) || (k === 0 && q > 0) || k + 1 === 1 ? 1 : .12; // solto balança mais
      P.set(mistura(a.x + A.x, b.x + xB, q) + (r.a - .5) * 5 * alto + (r.a < .5 ? -1.6 : 1.6) * alto,
        mistura(a.y, b.y, q) + (r.b - .3) * 1.8 * alto + Math.sin(t * .6 + r.d * 9) * .05 * vivo,
        mistura(a.z + A.z, b.z + zB, q));
      E.set(mistura(a.gx || 0, b.gx || 0, q) + alto * (r.b - .5) * 3, mistura(a.gy || 0, b.gy || 0, q) + alto * (r.c - .5) * 3, mistura(a.g, b.g, q));
      S.set(mistura(a.s[0], b.s[0], q), mistura(a.s[1], b.s[1], q), mistura(a.s[2], b.s[2], q));
      if (ponteiro.x < 2) {
        V.copy(P).project(camera);
        const dist = Math.hypot((V.x - ponteiro.x) * camera.aspect, V.y - ponteiro.y);
        salto[i] += ((1 - entre(.05, .42, dist)) - salto[i]) * .09;
        P.z += salto[i] * .5; E.z += salto[i] * (r.a - .5) * .5; E.y += salto[i] * (r.b - .5) * .6;
      }
      if (P.y < S.y * .5) P.y = S.y * .5;
      blocos.setMatrixAt(i, M.compose(P, Q.setFromEuler(E), S));
    }
    blocos.instanceMatrix.needsUpdate = true;
  }

  /* ---------- pedras: os tamanhos da marca, poucas e desfocadas (imagem já desfocada, sem custo de efeito) ---------- */
  const TIPOS = ['Safira', 'Esmeralda', 'Rubi', 'Turmalina'];
  const pedraTex = await Promise.all(TIPOS.map(n => carregar.loadAsync(`img/pedra-${n.toLowerCase()}.webp?v=2`)));
  pedraTex.forEach(t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; });
  // por parada: [lado, altura (-1 a 1 da tela), distância da câmera, tamanho, tipo]
  const PEDRAS = [
    [[-1, -.5, 3, .48, 0], [1.02, .5, 3.2, .42, 2], [.94, -.62, 5.2, .5, 1], [-.9, .62, 5.6, .44, 3], [-.62, -.5, 9.5, .34, 2]],
    [[.96, .7, 3, .5, 1], [.8, -.72, 3.4, .56, 0], [-.95, -.8, 4.2, .4, 2], [.55, -.6, 8, .4, 3]],
    ...[0, 1, 2, 3].map(k => { const l = k % 2 ? 1 : -1; return [[l * .97, -.6, 3, .52], [l * .9, .74, 3.4, .44], [l * .1, -.72, 4, .3], [-l * .92, -.84, 3.4, .42], [-l * .86, .74, 9, .5]].map(p => [...p, k]); }),
  ];
  const pedras = PEDRAS.flatMap((lista, k) => lista.map(([lado, alt, dist, tam, tipo], j) => {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: pedraTex[tipo], transparent: true, depthWrite: false, depthTest: dist > 6, toneMapped: false, fog: false }));
    m.userData = { k, lado, alt, dist, tam, tipo, fase: k * 2.1 + j * 1.7 }; m.renderOrder = dist > 6 ? 1 : 6; scene.add(m); return m;
  }));
  const escolhida = [null, null, null, null];
  colecao.querySelectorAll('.peca select').forEach((f, n) => f.addEventListener('change', () => { // escolheu o tamanho: as pedras da parada viram a dele
    escolhida[n] = TIPOS.indexOf(f.value);
    pedras.forEach(p => { if (p.userData.k === n + 2) p.material.map = pedraTex[escolhida[n]]; });
  }));
  function flutuar(s, t) {
    const tan = Math.tan(camera.fov * Math.PI / 360);
    pedras.forEach(p => {
      const u = p.userData, d = u.k ? quadro.dp : quadro.d, y = u.k === 1 && emPe ? 1.8 : u.k ? quadro.yp : quadro.y, meia = u.dist * tan;
      p.visible = Math.abs(s - u.k) < .9 && !(emPe && (u.k > 1 ? u.alt < 0 : !u.k && u.alt > 0)); if (!p.visible) return; // em pé: nem sobre a ficha (embaixo) nem sobre a frase (em cima)
      p.position.set(u.lado * meia * camera.aspect, y + u.alt * meia + Math.sin(t * .5 + u.fase) * .05, -u.k * PASSO + d - u.dist);
      p.material.rotation = Math.sin(t * .22 + u.fase) * .35;
      p.material.opacity = .92 * entre(.7, 2, camera.position.z - p.position.z) * (1 - entre(.55, .9, Math.abs(s - u.k)));
      p.scale.setScalar(u.tam * 1.2 * (emPe ? .62 : 1));
    });
  }

  /* ---------- poeira ---------- */
  const pn = fraco ? 120 : 260, pp = new Float32Array(pn * 3);
  for (let i = 0; i < pn; i++) pp.set([(acaso() - .5) * 14, acaso() * 6, acaso() * 16], i * 3);
  const poeiraGeo = new THREE.BufferGeometry(); poeiraGeo.setAttribute('position', new THREE.BufferAttribute(pp, 3));
  const poeiraMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { t: { value: 0 }, cz: { value: 0 }, px: { value: 1 } },
    vertexShader: `uniform float t, cz, px; varying float a;
      void main(){ vec3 p = position; p.x += sin(t*.15+p.z*3.)*.4; p.y = mod(p.y + t*.05, 6.);
        p.z = cz - mod(p.z - cz, 16.); vec4 v = viewMatrix*vec4(p,1.); float d = -v.z;
        a = smoothstep(.6,3.,d)*smoothstep(15.,7.,d); gl_PointSize = px*(14.+10.*fract(p.x*7.))/max(d,1.); gl_Position = projectionMatrix*v; }`,
    fragmentShader: 'varying float a; void main(){ float r = length(gl_PointCoord-.5); gl_FragColor = vec4(1.,.98,.94, smoothstep(.5,.05,r)*a*.75); }' });
  const poeira = new THREE.Points(poeiraGeo, poeiraMat); poeira.frustumCulled = false; poeira.renderOrder = 5; scene.add(poeira);

  /* ---------- frase ---------- */
  const letras = new THREE.Group(); scene.add(letras);
  let palavras = [];
  const PX = fraco ? 260 : 400, regua = document.createElement('canvas').getContext('2d');
  const larguraEm = t => { regua.font = `600 ${PX}px ${FONTE}`; return regua.measureText(t).width / PX + .1; };
  function palavra(txt, em, x, y, lado) {
    const c = document.createElement('canvas'), k = c.getContext('2d');
    c.width = Math.ceil(larguraEm(txt) * PX); c.height = PX * 1.3;
    k.font = `600 ${PX}px ${FONTE}`; k.fillStyle = '#3a2416'; k.fillText(txt, PX * .05, PX * 1.05);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(larguraEm(txt) * em, 1.3 * em), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, depthTest: false, toneMapped: false, fog: false }));
    m.position.set(x, y, -.3); m.userData = { x, lado }; m.renderOrder = 1; letras.add(m); palavras.push(m);
  }
  const quadro = { d: 7, y: 1.8, dp: 7, yp: 1.8 };
  let emPe = false, centros = [];
  function medir() {
    const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
    renderer.setPixelRatio(dpr); renderer.setSize(w, h, false); poeiraMat.uniforms.px.value = dpr * h / 900;
    camera.aspect = w / h; camera.updateProjectionMatrix();
    palavras.forEach(p => { p.material.map.dispose(); p.material.dispose(); p.geometry.dispose(); }); letras.clear(); palavras = [];
    emPe = camera.aspect < 1;
    const tan = Math.tan(camera.fov * Math.PI / 360), av = emPe ? Math.max(5.1, 2 / camera.aspect) : 4;
    quadro.d = av / 2 / tan; quadro.y = emPe ? PISO + ALT * .69 : PISO + ALT * .5;
    const avp = emPe ? Math.max(6.2, 2.6 / camera.aspect) : 4.5;
    quadro.dp = avp / 2 / tan; quadro.yp = emPe ? .62 : PISO + ALT * .5; // em pé a ficha fica embaixo e a modelo em cima
    const meia = av / 2 * (quadro.d + .3) / quadro.d * camera.aspect;
    if (emPe) {
      const linhas = LINHAS.map(l => l.join(' ')), em = Math.min(meia * 1.84 / Math.max(...linhas.map(larguraEm)), .5);
      linhas.forEach((l, i) => palavra(l, em, 0, PISO + ALT + .2 + em * (2.35 - i * 1.02), i % 2 ? 1 : -1));
    } else {
      const em = Math.min((meia * .92 - .4) / larguraEm('AJUSTAR.'), .62);
      LINHAS.forEach(([a, b], i) => { const y = PISO + 2.2 - i * em * 1.12; palavra(a, em, -(.62 + larguraEm(a) * em / 2), y, -1); palavra(b, em, .38 + larguraEm(b) * em / 2, y, 1); });
    }
    const lateral = emPe ? 0 : Math.min(1.75, avp / 2 * camera.aspect * .46);
    paradas.forEach((p, i) => { p.x = i < 2 ? 0 : (i % 2 ? 1 : -1) * lateral; p.grupo?.position.setX(p.x); });
    // parada de cada bloco da página: o meio do trecho em que a ficha está presa na tela
    const alto = e => e.getBoundingClientRect().top + scrollY, meio = e => alto(e) + Math.max(0, e.offsetHeight - innerHeight) / 2;
    centros = [0, meio(manifesto), ...[...colecao.querySelectorAll('.peca')].map(meio), alto(mundo) + mundo.offsetHeight - innerHeight];
  }
  const emS = y => { for (let i = 0; i < 6; i++) if (y < centros[i + 1]) return i + Math.max(0, y - centros[i]) / (centros[i + 1] - centros[i]); return 6; };
  medir();
  await montar(paradas[0]);
  if (!paradas[0].grupo) throw new Error('foto da abertura');

  /* ---------- quadro a quadro ---------- */
  const frase = manifesto.querySelector('.manifesto__frase');
  frase.innerHTML = frase.textContent.trim().split(/\s+/).map(p => `<span>${p}</span>`).join(' ');
  const mouse = { x: 0, y: 0 }, olhar = { x: 0, y: 0 };
  if (!fraco) addEventListener('pointermove', e => { mouse.x = e.clientX / innerWidth - .5; mouse.y = e.clientY / innerHeight - .5; ponteiro.x = mouse.x * 2; ponteiro.y = -mouse.y * 2; }, { passive: true });
  let s = emS(scrollY), chegou = 0, inicio = 0;
  function posicionar(ms, dt) {
    const t = ms / 1000, alvo = emS(scrollY), amortece = 1 - Math.exp(-dt * 6);
    s += (alvo - s) * amortece;
    inicio ||= t; chegou = entre(0, 3.2, t - inicio);
    olhar.x += (mouse.x - olhar.x) * amortece * .6; olhar.y += (mouse.y - olhar.y) * amortece * .6;
    const k = Math.min(5, Math.floor(s)), f = s - k, q = macio(entre(.15, .85, f)); // demora em cada parada
    const d = k === 0 ? mistura(quadro.d, quadro.dp, q) : quadro.dp, y = k === 0 ? mistura(quadro.y, emPe ? 1.8 : quadro.yp, q) : k === 1 ? mistura(emPe ? 1.8 : quadro.yp, quadro.yp, q) : quadro.yp;
    const fim = k === 5 ? q : 0;
    const z = -(k + q) * PASSO + d + 1.4 * Math.pow(1 - chegou, 3) - fim * 3;
    const passeio = Math.sin(q * Math.PI) * (k % 2 ? -1 : 1) * (emPe ? .3 : .9); // desvia da modelo ao passar
    camera.position.set(passeio + olhar.x * .6 + Math.sin(t * .25) * .05, y - olhar.y * .25 + Math.sin(t * .2) * .03, z);
    camera.lookAt(passeio * .4 + olhar.x * .15, y, z - d);
    sol.position.set(-4.5, 7, z - d + 6); sol.target.position.set(0, 1, z - d);
    arranjar(s, t); flutuar(s, t);
    paradas.forEach((p, i) => {
      if (p.nome && !p.pedida && Math.abs(s - i) < 1.6) montar(p);
      if (!p.grupo) return;
      const perto = i === 0 ? 1 - entre(.3, .5, s) : entre(i - .5, i - .2, s) * (1 - entre(i + .3, i + .5, s)); // some antes de a câmera atravessar
      p.mat.opacity = p.sombra.opacity = perto;
      p.grupo.visible = Math.abs(s - i) < 1; p.grupo.children[1].visible = p.grupo.children[1].castShadow = perto > .01;
    });
    const sai = entre(.05, .42, s);
    palavras.forEach((p, i) => {
      p.material.map.offset.y = 1 - macio(entre(.5 + i * .14, 1.5 + i * .14, t - inicio));
      p.position.x = p.userData.x + p.userData.lado * sai * 2.4; p.material.opacity = 1 - sai; p.visible = sai < 1;
    });
    poeiraMat.uniforms.t.value = t; poeiraMat.uniforms.cz.value = z;
    pe.style.opacity = 1 - entre(.02, .12, s); pe.style.visibility = s > .12 ? 'hidden' : '';
    claro.style.opacity = entre(5.55, 5.95, s);
    const n = frase.children.length, lido = entre(.55, .95, s) * (n + 4);
    for (let i = 0; i < n; i++) frase.children[i].style.opacity = .14 + .86 * entre(i, i + 4, lido);
  }
  await renderer.compileAsync(scene, camera);
  if (!raiz.classList.contains('cena-3d')) { renderer.dispose(); return; } // passou dos 8 s: já virou estática
  raiz.classList.add('cena-pronta');
  new ResizeObserver(medir).observe(canvas); new ResizeObserver(medir).observe(colecao);

  let visivel = true, ant = 0, quadros = 0, soma = 0;
  new IntersectionObserver(([e]) => { visivel = e.isIntersecting; ant = 0; }).observe(mundo);
  function desistir() {
    renderer.setAnimationLoop(null); semCena();
    [claro, pe, ...frase.children].forEach(e => e.removeAttribute('style'));
  }
  canvas.addEventListener('webglcontextlost', desistir);
  renderer.setAnimationLoop(ms => {
    if (!visivel) return;
    const dt = ant ? Math.min(.1, (ms - ant) / 1000) : .016;
    if (ant && ms - ant < 250) { soma += ms - ant; quadros++; }
    ant = ms;
    if (quadros === 60) { // não acompanha: baixa a resolução, depois a sombra, por fim vira estática
      const media = soma / quadros; quadros = soma = 0;
      if (media > 26 && dpr > 1) { dpr = Math.max(1, dpr - .35); medir(); }
      else if (media > 34 && sol.castShadow) sol.castShadow = false;
      else if (media > 70 && scrollY < innerHeight * .5) return desistir(); // no meio do percurso a altura da página mudaria sob o dedo
    }
    posicionar(ms, dt);
    renderer.render(scene, camera);
  });
  window._abertura = { renderer, scene, camera, paradas, letras, poeira, pedras }; // pra testar
}

if (raiz.classList.contains('cena-3d')) cena().catch(e => { console.warn('mundo: página estática', e); semCena(); });
