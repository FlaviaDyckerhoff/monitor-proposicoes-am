const fs = require('fs');
const nodemailer = require('nodemailer');

const EMAIL_DESTINO = process.env.EMAIL_DESTINO;
const EMAIL_REMETENTE = process.env.EMAIL_REMETENTE;
const EMAIL_SENHA = process.env.EMAIL_SENHA;
const ARQUIVO_ESTADO = 'estado.json';

const API_BASE = 'https://sapl.al.am.leg.br/api';

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

async function enviarEmail(novas) {
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

  const linhas = Object.keys(porTipo).sort().map(tipo => {
    const header = `<tr><td colspan="5" style="padding:10px 8px 4px;background:#f0f4f8;font-weight:bold;color:#1a3a5c;font-size:13px;border-top:2px solid #1a3a5c">${tipo} — ${porTipo[tipo].length} proposição(ões)</td></tr>`;
    const rows = porTipo[tipo].map(p =>
      `<tr>
        <td style="padding:8px;border-bottom:1px solid #eee;color:#555;font-size:12px">${p.tipo || '-'}</td>
        <td style="padding:8px;border-bottom:1px solid #eee"><strong>${p.numero || '-'}/${p.ano || '-'}</strong></td>
        <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px">${p.autor || '-'}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px;white-space:nowrap">${p.data || '-'}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px">${p.ementa || '-'}</td>
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
    subject: `🏛️ ALE-AM: ${novas.length} nova(s) proposição(ões) — ${new Date().toLocaleDateString('pt-BR')}`,
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
      break;
    }

    const json = await response.json();
    console.log(`📦 Resposta: count=${json.count}, results=${json.results?.length}`);

    const results = json.results || [];
    todasProposicoes.push(...results);

    if (pagina === 1 && json.count) {
      totalPaginas = Math.ceil(json.count / 100);
      console.log(`📊 Total de proposições em ${ano}: ${json.count} (${totalPaginas} páginas)`);
    }

    pagina++;
  } while (pagina <= totalPaginas && pagina <= 5);

  console.log(`📊 Total coletado: ${todasProposicoes.length} proposições`);
  return todasProposicoes;
}

function gerarId(p) {
  return String(p.id || p.pk || `${p.tipo_materia}-${p.numero}-${p.ano}`);
}

async function resolverAutor(autorUrl) {
  if (!autorUrl) return '-';
  if (typeof autorUrl === 'string' && autorUrl.startsWith('http')) {
    try {
      const res = await fetch(autorUrl, { headers: HEADERS });
      const data = await res.json();
      return data.nome || data.name || '-';
    } catch {
      return '-';
    }
  }
  if (typeof autorUrl === 'object') return autorUrl.nome || autorUrl.name || '-';
  return String(autorUrl);
}

async function normalizarProposicao(p, mapasTipos) {
  let tipo = '-';
  if (p.tipo_materia && typeof p.tipo_materia === 'object') {
    tipo = p.tipo_materia.sigla || p.tipo_materia.descricao || String(p.tipo_materia.id || '-');
  } else if (p.tipo_materia) {
    tipo = mapasTipos[String(p.tipo_materia)] || String(p.tipo_materia);
  } else if (p.tipo_materia_str) {
    tipo = p.tipo_materia_str;
  }

  const numero = p.numero || '-';
  const ano = p.ano || '-';
  const ementa = (p.ementa || '-').substring(0, 200);
  const data = p.data_apresentacao || p.data_origem_externa || '-';

  let autor = '-';
  if (p.autores && Array.isArray(p.autores) && p.autores.length > 0) {
    const primeiro = p.autores[0];
    if (typeof primeiro === 'string' && primeiro.startsWith('http')) {
      autor = await resolverAutor(primeiro);
    } else if (typeof primeiro === 'object') {
      autor = primeiro.nome || primeiro.name || '-';
    } else {
      autor = String(primeiro);
    }
  } else if (p.autor) {
    autor = await resolverAutor(p.autor);
  }

  return { id: gerarId(p), tipo, numero, ano, autor, data, ementa };
}

(async () => {
  console.log('🚀 Iniciando monitor ALE-AM...');
  console.log(`⏰ ${new Date().toLocaleString('pt-BR')}`);

  const estado = carregarEstado();
  const idsVistos = new Set(estado.proposicoes_vistas);

  const mapasTipos = await buscarTipos();
  const proposicoesRaw = await buscarProposicoes();

  if (proposicoesRaw.length === 0) {
    console.log('⚠️ Nenhuma proposição encontrada.');
    process.exit(0);
  }

  console.log('🔄 Normalizando proposições...');
  const proposicoes = await Promise.all(proposicoesRaw.map(p => normalizarProposicao(p, mapasTipos)));
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
