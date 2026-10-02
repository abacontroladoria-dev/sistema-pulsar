/**
 * Processo do container no Coolify.
 *
 * - Agenda interna: uma vez por dia, 03:00 de Brasília (HORARIOS), lendo o
 *   site inteiro (LEITURA_COMPLETA_NA_AGENDA). O "Executar agora" lê só o
 *   que mudou.
 * - Gatilho "Executar agora": POST /executar, chamado SÓ pelo servidor do
 *   Pulsar (rota /api/robo-sharepoint/executar), pela rede interna do Docker.
 *   O container não tem domínio nem porta publicada; o segredo no cabeçalho é
 *   a segunda tranca, caso alguém dentro da rede tente chamar.
 * - Nenhuma sondagem ao banco. Entre uma execução e outra o robô não faz
 *   nada — não consome Disk IO do Supabase parado.
 * - Uma execução por vez. Pedido durante uma execução recebe 409.
 */

const http = require('http')
const crypto = require('crypto')
const { carregarConfig, proximaExecucao, leituraCompleta } = require('./lib/config')
const { criarAutenticador } = require('./lib/auth')
const { Graph } = require('./lib/graph')
const { Api } = require('./lib/api')
const { executar } = require('./lib/execucao')

const config = carregarConfig()
const estado = { executando: false, ultima: null, proxima: null, erroFatal: null, iniciadoEm: new Date() }

let auth
let api
try {
  if (!config.siteId) throw Object.assign(new Error('SHAREPOINT_SITE_ID não definido'), { fatal: true })
  auth = criarAutenticador(config)
  api = new Api(config.supabaseUrl, config.supabaseAnon, config.machineToken)
  if (auth.credencial.diasRestantes < 30) {
    console.warn(`⚠️  certificado "${auth.credencial.assunto}" vence em ${auth.credencial.diasRestantes} dia(s)`)
  }
} catch (e) {
  // Sem credencial não há o que agendar, mas o processo fica de pé para o
  // /health contar o motivo — reiniciar em laço no Coolify só esconderia.
  estado.erroFatal = e.message
  console.error('❌ configuração inválida:', e.message)
}

async function rodar(gatilho, { solicitadoPorNome = null } = {}) {
  if (estado.executando) return { aceito: false, motivo: 'ja_executando' }
  if (estado.erroFatal) return { aceito: false, motivo: 'erro_fatal' }
  estado.executando = true
  const t0 = Date.now()
  console.log(`▶ execução (${gatilho}) iniciada`)

  const graph = new Graph(() => auth.obterToken())
  const forcarCompleta = leituraCompleta(gatilho, config)
  executar({ graph, api, config: { ...config, credencial: auth.credencial, forcarCompleta }, gatilho, solicitadoPorNome })
    .then(r => {
      estado.ultima = { status: r.status, em: new Date(), duracao_ms: r.metricas.duracao_ms }
      const m = r.metricas
      console.log(`✔ concluída em ${(m.duracao_ms / 1000).toFixed(1)} s — graph ${m.chamadas_graph} chamadas, banco ${m.chamadas_banco} chamadas / ${m.ms_banco ?? '?'} ms`)
    })
    .catch(e => {
      estado.ultima = { status: 'erro', em: new Date(), duracao_ms: Date.now() - t0, erro: e.message }
      if (e.fatal) estado.erroFatal = e.message
      console.error(`✖ falhou em ${((Date.now() - t0) / 1000).toFixed(1)} s: ${e.message}`)
    })
    .finally(() => { estado.executando = false })

  return { aceito: true }
}

function agendar() {
  if (estado.erroFatal) return
  const proxima = proximaExecucao(config.horarios)
  estado.proxima = proxima
  const espera = Math.max(1000, proxima.getTime() - Date.now())
  setTimeout(async () => {
    await rodar('agenda')
    agendar()
  }, espera).unref?.()
  console.log(`⏰ próxima execução: ${proxima.toISOString()} (UTC)`)
}

/** Corpo JSON pequeno (só o nome de quem pediu). Acima de 4 KB é descartado. */
function lerCorpo(req) {
  return new Promise((resolve) => {
    let dados = ''
    req.on('data', (c) => { dados += c; if (dados.length > 4096) { dados = ''; req.destroy() } })
    req.on('end', () => { try { resolve(dados ? JSON.parse(dados) : {}) } catch { resolve({}) } })
    req.on('error', () => resolve({}))
  })
}

function segredoConfere(recebido) {
  if (!config.segredoGatilho || !recebido) return false
  const a = Buffer.from(String(recebido))
  const b = Buffer.from(config.segredoGatilho)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

const servidor = http.createServer(async (req, res) => {
  const responder = (status, corpo) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(corpo))
  }

  if (req.method === 'GET' && req.url === '/health') {
    return responder(estado.erroFatal ? 503 : 200, {
      ok: !estado.erroFatal,
      versao: config.versao,
      executando: estado.executando,
      ultima: estado.ultima,
      proxima: estado.proxima,
      erro_fatal: estado.erroFatal,
      modo: config.somentePastaId ? 'homologacao' : 'producao',
      certificado_dias_restantes: auth?.credencial?.diasRestantes ?? null,
    })
  }

  if (req.method === 'POST' && req.url === '/executar') {
    if (!segredoConfere(req.headers['x-robo-segredo'])) return responder(401, { aceito: false, motivo: 'nao_autorizado' })
    const corpo = await lerCorpo(req)
    const r = await rodar('manual', { solicitadoPorNome: typeof corpo.solicitado_por_nome === 'string' ? corpo.solicitado_por_nome.slice(0, 120) : null })
    return responder(r.aceito ? 202 : 409, r)
  }

  responder(404, { erro: 'nao_encontrado' })
})

servidor.listen(config.porta, () => {
  console.log(`robo-pep-sharepoint ${config.versao} ouvindo na porta ${config.porta} (rede interna)`)
  agendar()
})

for (const sinal of ['SIGTERM', 'SIGINT']) {
  process.on(sinal, () => {
    console.log(`recebido ${sinal}, encerrando`)
    servidor.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 5000).unref()
  })
}
