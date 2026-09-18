// Loja: catálogo, sacola (localStorage), medidas na 1ª compra, checkout via WhatsApp.
// ponytail: sem backend. Pedido vira mensagem no WhatsApp; trocar por API quando tiver gateway de pagamento.
const WHATSAPP = '5511999999999'; // <- número da loja com DDI+DDD

// glb = modelo 3D da calça (provador): de pé, pernas retas, Y pra cima, sem rig. cor = fallback procedural.
const PRODUTOS = [
  { id: 'alfaiataria', cor: '#1f1d1c', glb: 'img/calca-alfaiataria.gltf', nome: 'Calça Alfaiataria', sub: 'Elegância sem esforço', preco: 219.9, img: 'img/alfaiataria.jpg' },
  { id: 'wideleg', cor: '#cbb9a2', glb: 'img/calca-wideleg.gltf',     nome: 'Calça Wide Leg',    sub: 'Moderna e confortável', preco: 199.9, img: 'img/wideleg.jpg' },
  { id: 'reta', cor: '#4a2f22', glb: 'img/calca-reta.gltf',        nome: 'Calça Reta',        sub: 'Versátil sempre',       preco: 189.9, img: 'img/reta.jpg' },
  { id: 'jeans', cor: '#8fa9c4', glb: 'img/calca-jeans.gltf',       nome: 'Calça Jeans',       sub: 'O essencial do dia a dia', preco: 179.9, img: 'img/jeans.jpg' },
];
const TAMANHOS = [34, 36, 38, 40, 42, 44, 46];
// cintura em cm -> tamanho. ponytail: tabela única p/ todos os modelos; por modelo quando a modelagem divergir
const TABELA_CINTURA = { 34: 62, 36: 66, 38: 70, 40: 74, 42: 78, 44: 82, 46: 86 };

const brl = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const ls = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
let sacola = ls.get('sacola', []);

function sugerirTamanho(cintura) {
  let t = 34;
  for (const [tam, min] of Object.entries(TABELA_CINTURA)) if (cintura >= min) t = +tam;
  return t;
}

/* ---------- catálogo ---------- */
function renderCatalogo() {
  document.querySelectorAll('.card[data-id]').forEach(card => {
    const p = PRODUTOS.find(x => x.id === card.dataset.id);
    card.querySelector('.preco').textContent = brl(p.preco);
    card.querySelector('select').innerHTML = TAMANHOS.map(t => `<option>${t}</option>`).join('');
    const med = ls.get('medidas');
    if (med) card.querySelector('select').value = sugerirTamanho(med.cintura);
    card.querySelector('.add').onclick = () => adicionar(p.id, +card.querySelector('select').value);
    card.querySelector('.provar').onclick = () => window.abrirProvador?.(p);
  });
}

/* ---------- sacola ---------- */
function adicionar(id, tam) {
  const item = sacola.find(i => i.id === id && i.tam === tam);
  item ? item.qtd++ : sacola.push({ id, tam, qtd: 1 });
  salvar(); abrirSacola();
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
function abrirSacola() { document.body.classList.add('sacola-aberta'); }
function fecharSacola() { document.body.classList.remove('sacola-aberta'); }

/* ---------- checkout ---------- */
function abrirCheckout() {
  fecharSacola();
  const dlg = document.getElementById('checkout');
  const med = ls.get('medidas');
  dlg.querySelector('.passo-medidas').hidden = !!med;
  dlg.querySelector('.medidas-salvas').hidden = !med;
  if (med) dlg.querySelector('.medidas-salvas span').textContent =
    `${med.altura} cm · cintura ${med.cintura} · quadril ${med.quadril} · comp. ${med.comprimento}`;
  const cli = ls.get('cliente');
  if (cli) for (const k in cli) dlg.querySelector(`[name=${k}]`) && (dlg.querySelector(`[name=${k}]`).value = cli[k]);
  dlg.showModal();
}
function calcSugestao(form) {
  const c = +form.cintura.value;
  form.querySelector('.sugestao').textContent = c ? `Sugerimos o tamanho ${sugerirTamanho(c)}` : '';
}
function finalizar(e) {
  e.preventDefault();
  const f = e.target, d = Object.fromEntries(new FormData(f));
  if (!f.querySelector('.passo-medidas').hidden) {
    ls.set('medidas', { altura: +d.altura, cintura: +d.cintura, quadril: +d.quadril, comprimento: +d.comprimento });
  }
  const med = ls.get('medidas');
  ls.set('cliente', { nome: d.nome, whats: d.whats, email: d.email, cep: d.cep, endereco: d.endereco });
  const linhas = sacola.map(i => { const p = PRODUTOS.find(p => p.id === i.id); return `• ${i.qtd}x ${p.nome} tam. ${i.tam} — ${brl(p.preco * i.qtd)}`; });
  const total = sacola.reduce((s, i) => s + i.qtd * PRODUTOS.find(p => p.id === i.id).preco, 0);
  const msg = [`Olá! Quero fazer um pedido na Seu Jeito 👖`, '', ...linhas, `Total: ${brl(total)}`, '',
    `Nome: ${d.nome}`, `WhatsApp: ${d.whats}`, `E-mail: ${d.email}`, `Endereço: ${d.endereco} — CEP ${d.cep}`, '',
    `Medidas: altura ${med.altura} cm, cintura ${med.cintura} cm, quadril ${med.quadril} cm, comprimento ${med.comprimento} cm`].join('\n');
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
  document.querySelector('.sacola-fundo').onclick = fecharSacola;
  document.querySelector('.finalizar').onclick = abrirCheckout;
  const f = document.querySelector('#checkout form');
  f.onsubmit = finalizar;
  f.cintura.oninput = () => calcSugestao(f);
  document.querySelector('.editar-medidas').onclick = () => { localStorage.removeItem('medidas'); abrirCheckout(); };
});
