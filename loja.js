// Loja: catálogo, sacola (localStorage), medidas na 1ª compra, checkout via WhatsApp.
// ponytail: sem backend. Pedido vira mensagem no WhatsApp; trocar por API quando tiver gateway de pagamento.
const WHATSAPP = '5511999999999'; // <- número da loja com DDI+DDD

// glb = modelo 3D da calça (provador): de pé, pernas retas, Y pra cima, sem rig (_assets/gerar-calcas). cor = fallback procedural.
const PRODUTOS = [
  { id: 'reta',      cor: '#1e1c1b', glb: 'img/calca-reta.glb',      nome: 'Alfaiataria Reta',      preco: 350, img: 'img/reta-640.jpg' },
  { id: 'pantalona', cor: '#d6c2a5', glb: 'img/calca-pantalona.glb', nome: 'Alfaiataria Pantalona', preco: 350, img: 'img/pantalona-640.jpg' },
  { id: 'cenoura',   cor: '#4a2c20', glb: 'img/calca-cenoura.glb',   nome: 'Alfaiataria Cenoura',   preco: 350, img: 'img/cenoura-640.jpg' },
  { id: 'cigarrete', cor: '#b07a45', glb: 'img/calca-cigarrete.glb', nome: 'Alfaiataria Cigarrete', preco: 350, img: 'img/cigarrete-640.jpg' },
];
// tamanhos da marca, do menor ao maior (equivalem a PP, P, M e G)
const TAMANHOS = ['Safira', 'Esmeralda', 'Rubi', 'Turmalina'];
// cintura em cm -> tamanho. ponytail: tabela única p/ todos os modelos; por modelo quando a modelagem divergir
const TABELA_CINTURA = { Safira: 0, Esmeralda: 70, Rubi: 78, Turmalina: 86 }; // cintura mínima (cm) de cada tamanho

const brl = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const ls = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const NOME_ANTIGO = { PP: 'Safira', P: 'Esmeralda', M: 'Rubi', G: 'Turmalina' }; // sacolas salvas antes da troca de nomes
// sacolas salvas antes da troca de modelos (alfaiataria, wideleg, jeans) perdem os itens que saíram do catálogo, senão a sacola quebra
let sacola = ls.get('sacola', []).map(i => ({ ...i, tam: NOME_ANTIGO[i.tam] || i.tam })).filter(i => PRODUTOS.some(p => p.id === i.id));

function sugerirTamanho(cintura) {
  let t = TAMANHOS[0];
  for (const [tam, min] of Object.entries(TABELA_CINTURA)) if (cintura >= min) t = tam;
  return t;
}

/* ---------- catálogo ---------- */
function renderCatalogo() {
  document.querySelectorAll('.peca[data-id]').forEach(card => {
    const p = PRODUTOS.find(x => x.id === card.dataset.id);
    card.querySelector('.preco').textContent = brl(p.preco);
    card.querySelector('select').innerHTML = TAMANHOS.map(t => `<option>${t}</option>`).join('');
    const med = ls.get('medidas');
    if (med) card.querySelector('select').value = sugerirTamanho(med.cintura);
    card.querySelector('.add').onclick = () => adicionar(p.id, card.querySelector('select').value);
    card.querySelector('.provar').onclick = () => window.abrirProvador?.(p);
  });
}

/* ---------- sacola ---------- */
function adicionar(id, tam) {
  const item = sacola.find(i => i.id === id && i.tam === tam);
  item ? item.qtd++ : sacola.push({ id, tam, qtd: 1 });
  salvar(); abrirSacola();
  const b = document.querySelector('.badge'); b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump');
}
function salvar() { ls.set('sacola', sacola); renderSacola(); }
function renderSacola() {
  const total = sacola.reduce((s, i) => s + i.qtd * PRODUTOS.find(p => p.id === i.id).preco, 0);
  const n = sacola.reduce((s, i) => s + i.qtd, 0);
  document.querySelector('.badge').textContent = n || '';
  document.querySelector('.sacola-itens').innerHTML = sacola.length ? sacola.map((i, idx) => {
    const p = PRODUTOS.find(p => p.id === i.id);
    return `<div class="sacola-item">
      <img src="${p.img}" alt="">
      <div><strong>${p.nome}</strong><span>Tam. ${i.tam} · ${brl(p.preco)}</span>
        <div class="qtd"><button data-i="${idx}" data-d="-1">−</button>${i.qtd}<button data-i="${idx}" data-d="1">+</button></div></div>
      <button class="rm" data-i="${idx}" aria-label="Remover">×</button></div>`;
  }).join('') : '<p class="vazia">Sua sacola está vazia.</p>';
  document.querySelector('.sacola-total').textContent = brl(total);
  document.querySelector('.finalizar').disabled = !sacola.length;
  document.querySelectorAll('.qtd button').forEach(b => b.onclick = () => {
    const it = sacola[b.dataset.i]; it.qtd += +b.dataset.d;
    if (it.qtd <= 0) sacola.splice(b.dataset.i, 1);
    salvar();
  });
  document.querySelectorAll('.rm').forEach(b => b.onclick = () => { sacola.splice(b.dataset.i, 1); salvar(); });
}
const dlgSacola = () => document.getElementById('sacola');
function abrirSacola() { if (!dlgSacola().open) dlgSacola().showModal(); }
function fecharSacola() { dlgSacola().close(); }

/* ---------- checkout ---------- */
function abrirCheckout() {
  fecharSacola();
  const dlg = document.getElementById('checkout');
  const med = ls.get('medidas');
  mostrarMedidas(med);
  const cli = ls.get('cliente');
  if (cli) for (const k in cli) dlg.querySelector(`[name=${k}]`) && (dlg.querySelector(`[name=${k}]`).value = cli[k]);
  if (!med) resetMedicao(dlg.querySelector('form'));
  dlg.showModal();
}

// com medidas salvas, a etapa some e precisa ficar desabilitada: campo obrigatório escondido trava o envio do pedido
function mostrarMedidas(med) {
  const dlg = document.getElementById('checkout'), passo = dlg.querySelector('.passo-medidas');
  passo.hidden = passo.disabled = !!med;
  dlg.querySelector('.medidas-salvas').hidden = !med;
  if (med) dlg.querySelector('.medidas-salvas span').textContent =
    `${med.altura} cm · cintura ${med.cintura} · quadril ${med.quadril} · comp. ${med.comprimento}`;
}

/* ---------- medidas pela câmera: a cliente só digita a altura ---------- */
const K_MED = ['cintura', 'quadril', 'comprimento'];
// o que a câmera mediu, antes de a cliente corrigir: vai no pedido quando ela muda algo (dado pra calibrar a medição)
let medCamera = null;
// confirmação ou correção da cliente → par câmera × real que o provador.js usa pra ajustar as próximas medições neste aparelho.
// Mexer de novo na mesma medição troca o par em vez de somar outro.
function registrarCorrecao(camera, real) {
  if (!camera?.bruto) return;
  const par = { data: camera.data, altura: real.altura, bruto: camera.bruto, real: {}, diferenca: {} };
  K_MED.forEach(k => { par.real[k] = real[k]; par.diferenca[k] = real[k] - camera[k]; });
  ls.set('correcoesCamera', [...ls.get('correcoesCamera', []).filter(c => c.data !== par.data), par].slice(-20));
}
// tela de conferência: mostra os valores; resolve com as medidas confirmadas/corrigidas, 'denovo' ou null (fechou)
function confirmarMedidas(m, corrigindo = false) {
  const dlg = document.getElementById('confirmar'), f = dlg.querySelector('form');
  const sugestao = () => { dlg.querySelector('.sugestao').textContent = +f.cintura.value ? `Sugerimos o tamanho ${sugerirTamanho(+f.cintura.value)}` : ''; };
  const modo = c => {
    dlg.querySelector('.achadas').hidden = c;
    const campos = dlg.querySelector('.campos'); campos.hidden = campos.disabled = !c;
    dlg.querySelector('.confirmar-texto').textContent = c ? 'Confira com uma fita métrica e corrija o que estiver diferente.' : 'Estas são as medidas que a câmera encontrou. Acertamos?';
    dlg.querySelector('.ok').textContent = c ? 'Salvar medidas' : 'Sim, confirmar';
    dlg.querySelector('.corrigir').hidden = c;
    if (c && dlg.open) f.cintura.focus();
  };
  K_MED.forEach(k => { f[k].value = m[k]; dlg.querySelector(`[data-m=${k}]`).textContent = `${m[k]} cm`; });
  dlg.querySelector('[data-m=altura]').textContent = `${m.altura} cm`;
  modo(corrigindo); sugestao();
  f.cintura.oninput = sugestao;
  dlg.querySelector('.corrigir').onclick = () => modo(true);
  return new Promise(resolve => {
    let r = null;
    f.onsubmit = e => { e.preventDefault(); r = { altura: m.altura }; K_MED.forEach(k => { r[k] = Math.round(+f[k].value); }); dlg.close(); };
    dlg.querySelector('.denovo').onclick = () => { r = 'denovo'; dlg.close(); };
    dlg.querySelector('.confirmar-fechar').onclick = () => dlg.close();
    dlg.onclose = () => resolve(r);
    dlg.showModal();
  });
}
function salvarMedidas(m, camera) {
  const med = { ...m, camera };
  ls.set('medidas', med); registrarCorrecao(camera, med); mostrarMedidas(med);
}
async function editarMedidas(f) {
  const med = ls.get('medidas'), r = await confirmarMedidas(med, true);
  if (r === 'denovo') { mostrarMedidas(null); resetMedicao(f); f.altura.value = med.altura; f.altura.focus(); }
  else if (r) salvarMedidas(r, med.camera);
}
function resetMedicao(f) {
  medCamera = null;
  ['cintura', 'quadril', 'comprimento'].forEach(k => { f[k].value = ''; f[k].required = false; });
  f.querySelector('.manual').hidden = true;
  const msg = f.querySelector('.medidas-camera'); msg.textContent = ''; msg.classList.remove('erro');
  f.querySelector('.medir-btn').textContent = 'Medir com a câmera';
  f.querySelector('.sugestao').textContent = '';
}
async function medirPelaCamera(f) {
  const msg = f.querySelector('.medidas-camera');
  if (!f.altura.reportValidity()) return;
  msg.classList.remove('erro'); msg.textContent = '';
  try {
    if (!window.medirCorpo) throw new Error('erro');
    const r = await window.medirCorpo(+f.altura.value);
    const camera = { cintura: r.cintura, quadril: r.quadril, comprimento: r.comprimento, bruto: r.bruto, data: new Date().toISOString() };
    const final = await confirmarMedidas(r);
    if (final === 'denovo') return medirPelaCamera(f);
    if (!final) { resetMedicao(f); msg.textContent = 'Falta confirmar as medidas. Meça de novo para continuar.'; return; }
    medCamera = camera;
    salvarMedidas(final, camera);
  } catch (e) {
    if (e.message === 'cancelada') return;
    medCamera = null;
    // sem câmera: libera os campos pra digitar, senão a cliente fica presa no checkout
    f.querySelector('.manual').hidden = false;
    ['cintura', 'quadril', 'comprimento'].forEach(k => (f[k].required = true));
    msg.classList.add('erro');
    msg.textContent = e.message === 'camera'
      ? 'Não conseguimos abrir a câmera. Libere o acesso e tente de novo, ou digite as medidas abaixo.'
      : 'A medição não funciona neste navegador. Digite as medidas abaixo.';
  }
}
const ajustou = m => m?.camera && K_MED.some(k => m.camera[k] !== m[k]);
function calcSugestao(form) {
  const c = +form.cintura.value;
  form.querySelector('.sugestao').textContent = c ? `Sugerimos o tamanho ${sugerirTamanho(c)}` : '';
}
function finalizar(e) {
  e.preventDefault();
  const f = e.target, d = Object.fromEntries(new FormData(f));
  if (!f.querySelector('.passo-medidas').hidden) {
    if (!d.cintura) { // ainda não mediu
      const msg = f.querySelector('.medidas-camera');
      msg.classList.add('erro'); msg.textContent = 'Meça com a câmera antes de enviar o pedido.';
      f.querySelector('.medir-btn').focus();
      return;
    }
    ls.set('medidas', { altura: +d.altura, cintura: +d.cintura, quadril: +d.quadril, comprimento: +d.comprimento, camera: medCamera });
  }
  const med = ls.get('medidas');
  ls.set('cliente', { nome: d.nome, whats: d.whats, email: d.email, cep: d.cep, endereco: d.endereco });
  const linhas = sacola.map(i => { const p = PRODUTOS.find(p => p.id === i.id); return `• ${i.qtd}x ${p.nome} tam. ${i.tam} — ${brl(p.preco * i.qtd)}`; });
  const total = sacola.reduce((s, i) => s + i.qtd * PRODUTOS.find(p => p.id === i.id).preco, 0);
  const msg = [`Olá! Quero fazer um pedido na Seu Jeito 👖`, '', ...linhas, `Total: ${brl(total)}`, '',
    `Nome: ${d.nome}`, `WhatsApp: ${d.whats}`, `E-mail: ${d.email}`, `Endereço: ${d.endereco} — CEP ${d.cep}`, '',
    `Medidas: altura ${med.altura} cm, cintura ${med.cintura} cm, quadril ${med.quadril} cm, comprimento ${med.comprimento} cm`,
    ...(medCamera && ajustou(med) ? [`(A câmera mediu cintura ${med.camera.cintura}, quadril ${med.camera.quadril}, comprimento ${med.camera.comprimento}; a cliente corrigiu.)`] : [])].join('\n');
  const pedidos = ls.get('pedidos', []); pedidos.push({ data: new Date().toISOString(), itens: sacola, total }); ls.set('pedidos', pedidos);
  window.open(`https://wa.me/${WHATSAPP}?text=${encodeURIComponent(msg)}`, '_blank');
  sacola = []; salvar();
  document.getElementById('checkout').close();
  renderCatalogo();
}

document.addEventListener('DOMContentLoaded', () => {
  renderCatalogo(); renderSacola();
  document.querySelectorAll('[data-abrir-sacola]').forEach(a => a.onclick = e => { e.preventDefault(); abrirSacola(); });
  document.querySelector('.sacola-fechar').onclick = fecharSacola;
  dlgSacola().onclick = e => { if (e.target === dlgSacola()) fecharSacola(); }; // clique no fundo fecha
  document.querySelectorAll('[data-provar]').forEach(b => b.onclick = () => window.abrirProvador?.(PRODUTOS.find(p => p.id === b.dataset.provar)));
  document.querySelector('.finalizar').onclick = abrirCheckout;
  const f = document.querySelector('#checkout form');
  f.onsubmit = finalizar;
  f.cintura.oninput = () => calcSugestao(f);
  f.querySelector('.medir-btn').onclick = () => medirPelaCamera(f);
  document.querySelector('.editar-medidas').onclick = () => editarMedidas(f);
});
