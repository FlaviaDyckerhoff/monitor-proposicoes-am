const fs = require('fs');
const nodemailer = require('nodemailer');

const EMAIL_DESTINO = process.env.EMAIL_DESTINO;
const EMAIL_REMETENTE = process.env.EMAIL_REMETENTE;
const EMAIL_SENHA = process.env.EMAIL_SENHA;
const ARQUIVO_ESTADO = 'estado.json';

const API_BASE = 'https://sapl.al.am.leg.br/api';
const SITE_BASE = 'https://sapl.al.am.leg.br';

const HEADERS = {
  'Accept': 'application/json',
  'User-Agent': 'Mozilla/5.0 (compatible; monitor-legislativo/1.0)',
};

function carregarEstado() {
  if (fs.existsSync(ARQUIVO_ESTADO)) {
    return JSON.parse(fs.readFileSync(ARQUIVO_ESTADO, 'utf8'));
  }
  return { proposicoes_vistas: [], ultima_execucao: '' };
}

function salvarEstado(estado) {
  fs.writeFileSync(ARQUIVO_ESTADO, JSON.stringify(estado, null, 2));
}

async function buscarTipos() {
  console.log('🔎 Buscando tipos de matéria...');
  const mapa = {};
  try {
    const url = `${API_BASE}/materia/tipomaterialegislativa/?page_size=100`;
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const json = await res.json();
    const lista = json.results || json;
    lista.forEach(t => {
      mapa[String(t.id)] = t.sigla || t.descricao || String(t.id);
    });
    console.log(`✅ ${Object.keys(mapa).length} tipos carregados: ${Object.values(mapa).join(', ')}`);
  } catch (e) {
    console.error('⚠️ Falha ao buscar tipos:', e.message);
  }
  return mapa;
}

async function buscarAutores() {
  console.log('🔎 Buscando autores...');
  const mapa = {};
  try {
    let url = `${API_BASE}/autoria/autor/?page_size=200`;
    while (url) {
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const json = await res.json();
      const lista = json.results || json;
      lista.forEach(a => {
        // autor pode ter nome direto ou referência a parlamentar/comissão
        const nome = a.nome || a.name || (a.autor_related && a.autor_related.nome) || null;
        if (a.id && nome) mapa[String(a.id)] = nome;
      });
      // paginação padrão DRF ou custom
      url = json.next || json.pagination?.links?.next || null;
    }
    console.log(`✅ ${Object.keys(mapa).length} autores carregados`);
  } catch (e) {
    console.error('⚠️ Falha ao buscar autores:', e.message);
  }
  return mapa;
}

function prioridadeTipoEmail(tipo) {
  const t = String(tipo || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();

  if (/^(PL|PLO)(\b|$)/.test(t) || /^PROJETO DE LEI( ORDINARIA)?$/.test(t)) return 0;
  if (/^PLC(\b|$)/.test(t) || /^PROJETO DE LEI COMPLEMENTAR/.test(t)) return 1;
  if (/^PEC(\b|$)/.test(t) || /^(PROPOSTA|PROJETO) DE EMENDA (A )?CONSTITUCIONAL/.test(t)) return 2;
  return 10;
}

function compararTiposEmail(a, b) {
  const prioridadeA = prioridadeTipoEmail(a);
  const prioridadeB = prioridadeTipoEmail(b);
  if (prioridadeA !== prioridadeB) return prioridadeA - prioridadeB;
  return String(a || '').localeCompare(String(b || ''), 'pt-BR');
}


const CLIENTES_NOMES_PROPRIOS = [
  'FIRJAN', 'Red Bull', 'Sindicerv', 'Boticario', 'Boticário', 'Abrasel', 'ANBRASEL',
  'Energisa', 'EnergisaLuz', 'SABESP', 'COMGAS', 'COMGÁS', 'Eletromidia', 'Eletromídia',
  'BRT', 'Regenera', 'Nova Infra', 'Seta', 'SETA', 'AkzoNobel', 'Expedia', 'RTSC',
  'Huawei', 'Carrefour', 'JBS', 'Ajinomoto', 'Vibra', 'Mindlab', 'ABVTEX', 'Neoenergia', 'ENEL'
];

function clientesCitadosNaProposicao(p) {
  const texto = [p.cliente, p.clientes, p.autor, p.autores, p.tipo, p.rotulo, p.titulo, p.identificacao, p.ementa]
    .filter(Boolean)
    .join(' ');
  const achados = [];
  for (const nome of CLIENTES_NOMES_PROPRIOS) {
    const escaped = nome.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(^|[^A-Za-zÀ-ÿ0-9])' + escaped + '([^A-Za-zÀ-ÿ0-9]|$)', 'i');
    if (re.test(texto) && !achados.some(a => a.toLowerCase() === nome.toLowerCase())) achados.push(nome);
  }
  return achados;
}

function anotarClientesCitados(proposicoes) {
  for (const p of proposicoes || []) {
    const clientes = clientesCitadosNaProposicao(p);
    p.clientesCitados = clientes;
    if (clientes.length && p.ementa && !String(p.ementa).includes('Cliente citado:')) {
      p.ementa = String(p.ementa).trim() + ' | Cliente citado: ' + clientes.join(', ');
    }
  }
}

function mlEscapeHtmlClienteDestaque(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function mlEscapeRegExpClienteDestaque(valor) {
  return String(valor).replace(/[.*+?^\${}()|[\]\\]/g, '\\$&');
}

function mlDestacarTermosClienteEmail(texto, clientes) {
  const nomes = Array.from(new Set([...(clientes || []), ...CLIENTES_NOMES_PROPRIOS]))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (!nomes.length) return mlEscapeHtmlClienteDestaque(texto);

  const regex = new RegExp('(^|[^A-Za-zÀ-ÿ0-9])(' + nomes.map(mlEscapeRegExpClienteDestaque).join('|') + ')(?=[^A-Za-zÀ-ÿ0-9]|$)', 'gi');
  return mlEscapeHtmlClienteDestaque(texto).replace(regex, (match, prefixo, termo) => {
    return prefixo + '<span style="background:#dbeafe;color:#1e3a8a;font-weight:700;border-radius:3px;padding:1px 3px">' + termo + '</span>';
  });
}

function renderizarEmentaCliente(p, renderBase) {
  const texto = String((p && p.ementa) || '-');
  const partes = texto.split(/\s+\|\s+Cliente citado:\s+/i);
  const ementa = renderBase
    ? renderBase(partes[0])
    : mlDestacarTermosClienteEmail(partes[0], p && p.clientesCitados);
  const clientes = partes.length > 1
    ? partes.slice(1).join(' | Cliente citado: ')
    : ((p && p.clientesCitados) || []).join(', ');

  if (!clientes) return ementa;
  return ementa + '<div style="margin-top:6px">' +
    '<span style="display:inline-block;background:#eef6ff;border:1px solid #bfdbfe;color:#1e3a8a;border-radius:999px;padding:3px 8px;font-size:11px;font-weight:700">' +
    'Cliente citado: ' + mlDestacarTermosClienteEmail(clientes, p && p.clientesCitados) +
    '</span></div>';
}

async function enviarEmail(novas) {
  anotarClientesCitados(novas);
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: EMAIL_REMETENTE, pass: EMAIL_SENHA },
  });

  const porTipo = {};
  novas.forEach(p => {
    const tipo = p.tipo || 'OUTROS';
    if (!porTipo[tipo]) porTipo[tipo] = [];
    porTipo[tipo].push(p);
  });

  const linhas = Object.keys(porTipo).sort(compararTiposEmail).map(tipo => {
    const header = `<tr><td colspan="5" style="padding:10px 8px 4px;background:#f0f4f8;font-weight:bold;color:#1a3a5c;font-size:13px;border-top:2px solid #1a3a5c">${tipo} — ${porTipo[tipo].length} proposição(ões)</td></tr>`;
    const rows = porTipo[tipo].map(p =>
      `<tr>
        <td style="padding:8px;border-bottom:1px solid #eee;color:#555;font-size:12px">${p.tipo || '-'}</td>
        <td style="padding:8px;border-bottom:1px solid #eee"><strong><a href="${p.link}" style="color:#1a3a5c">${p.numero || '-'}/${p.ano || '-'}</a></strong></td>
        <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px">${p.autor || '-'}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px;white-space:nowrap">${p.data || '-'}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px">${renderizarEmentaCliente(p)}</td>
      </tr>`
    ).join('');
    return header + rows;
  }).join('');

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:900px;margin:0 auto">
      <h2 style="color:#1a3a5c;border-bottom:2px solid #1a3a5c;padding-bottom:8px">
        🏛️ ALE-AM — ${novas.length} nova(s) proposição(ões)
      </h2>
      <p style="color:#666">Monitoramento automático — ${new Date().toLocaleString('pt-BR')}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead>
          <tr style="background:#1a3a5c;color:white">
            <th style="padding:10px;text-align:left">Tipo</th>
            <th style="padding:10px;text-align:left">Número/Ano</th>
            <th style="padding:10px;text-align:left">Autor</th>
            <th style="padding:10px;text-align:left">Data</th>
            <th style="padding:10px;text-align:left">Ementa</th>
          </tr>
        </thead>
        <tbody>${linhas}</tbody>
      </table>
      <p style="margin-top:20px;font-size:12px;color:#999">
        Acesse: <a href="https://sapl.al.am.leg.br/materia/pesquisar-materia">sapl.al.am.leg.br</a>
      </p>
    </div>
  `;

  await transporter.sendMail({
    from: `"Monitor ALE-AM" <${EMAIL_REMETENTE}>`,
    to: EMAIL_DESTINO,
    subject: `🏛️ Amazonas: ${novas.length} nova(s) proposição(ões) — ${new Date().toLocaleDateString('pt-BR')}`,
    html,
  });

  console.log(`✅ Email enviado com ${novas.length} proposições novas.`);
}

async function buscarProposicoes() {
  const ano = new Date().getFullYear();
  const todasProposicoes = [];
  let pagina = 1;
  let totalPaginas = 1;

  console.log(`🔍 Buscando proposições de ${ano} na ALE-AM...`);

  do {
    const url = `${API_BASE}/materia/materialegislativa/?ano=${ano}&page=${pagina}&page_size=100&o=-data_apresentacao`;
    console.log(`  → Página ${pagina}/${totalPaginas}: ${url}`);

    const response = await fetch(url, { headers: HEADERS });

    if (!response.ok) {
      console.error(`❌ Erro na API: ${response.status} ${response.statusText}`);
      const texto = await response.text();
      console.error('Resposta:', texto.substring(0, 300));
      throw new Error(`Erro na API: ${response.status} ${response.statusText}`);
    }

    const json = await response.json();
    const results = json.results || [];
    todasProposicoes.push(...results);

    if (pagina === 1) {
      // Paginação customizada da ALE-AM: pagination.total_pages
      const total = json.pagination?.total_pages || json.pagination?.total_entries
        ? Math.ceil(json.pagination.total_entries / 100)
        : (json.count ? Math.ceil(json.count / 100) : 1);
      totalPaginas = total;
      console.log(`📊 Total de proposições em ${ano}: ${json.pagination?.total_entries || json.count || '?'} (${totalPaginas} páginas)`);
    }

    console.log(`📦 Página ${pagina}: ${results.length} proposições`);
    pagina++;
  } while (pagina <= totalPaginas);

  console.log(`📊 Total coletado: ${todasProposicoes.length} proposições`);
  return todasProposicoes;
}

function gerarId(p) {
  return String(p.id || p.pk || `${p.tipo}-${p.numero}-${p.ano}`);
}

function normalizarProposicao(p, mapasTipos, mapasAutores) {
  // Campo é "tipo" (inteiro), não "tipo_materia"
  const tipoId = String(p.tipo || p.tipo_materia || '-');
  const tipo = mapasTipos[tipoId] || tipoId;

  const numero = p.numero || '-';
  const ano = p.ano || '-';
  const ementa = (p.ementa || '-');
  const data = p.data_apresentacao || p.data_origem_externa || '-';

  // Link direto via link_detail_backend
  const link = p.link_detail_backend
    ? `${SITE_BASE}${p.link_detail_backend}`
    : `${SITE_BASE}/materia/${p.id}`;

  // Autores: array de inteiros
  let autor = '-';
  if (p.autores && Array.isArray(p.autores) && p.autores.length > 0) {
    const id = String(p.autores[0]);
    autor = mapasAutores[id] || `Autor ${id}`;
  }

  return { id: gerarId(p), tipo, numero, ano, autor, data, ementa, link };
}

(async () => {
  console.log('🚀 Iniciando monitor ALE-AM...');
  console.log(`⏰ ${new Date().toLocaleString('pt-BR')}`);

  const estado = carregarEstado();
  const idsVistos = new Set(estado.proposicoes_vistas);

  const [mapasTipos, mapasAutores] = await Promise.all([buscarTipos(), buscarAutores()]);

  const proposicoesRaw = await buscarProposicoes();

  if (proposicoesRaw.length === 0) {
    throw new Error('Nenhuma proposição encontrada. Falha provável de coleta/API; workflow deve ficar vermelho.');
  }

  console.log('🔄 Normalizando proposições...');
  const proposicoes = proposicoesRaw.map(p => normalizarProposicao(p, mapasTipos, mapasAutores));
  const proposicoesValidas = proposicoes.filter(p => p.id);
  console.log(`📊 Total normalizado: ${proposicoesValidas.length}`);

  const novas = proposicoesValidas.filter(p => !idsVistos.has(p.id));
  console.log(`🆕 Proposições novas: ${novas.length}`);

  if (novas.length > 0) {
    novas.sort((a, b) => {
      if (a.tipo < b.tipo) return -1;
      if (a.tipo > b.tipo) return 1;
      return (parseInt(b.numero) || 0) - (parseInt(a.numero) || 0);
    });
    await enviarEmail(novas);
    novas.forEach(p => idsVistos.add(p.id));
    estado.proposicoes_vistas = Array.from(idsVistos);
    estado.ultima_execucao = new Date().toISOString();
    salvarEstado(estado);
  } else {
    console.log('✅ Sem novidades. Nada a enviar.');
    estado.ultima_execucao = new Date().toISOString();
    salvarEstado(estado);
  }
})();
