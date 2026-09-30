/**
 * Configuração vem só de variável de ambiente.
 *
 * No Coolify: todas marcadas como Secret. Na máquina de desenvolvimento: um
 * `.env` FORA do repositório (ex.: C:\Users\...\.pulsar-sharepoint\robo.env),
 * carregado com `node --env-file=<caminho> demo.js`.
 */

const { version } = require('../package.json')

// Brasil sem horário de verão desde 2019: Brasília = UTC-3 o ano todo.
const OFFSET_BRASILIA_MIN = -180

function lerHorarios(texto) {
  // Uma vez por dia, de madrugada (decisão da equipe, 01/10/2026). 03:00 cai
  // DEPOIS da sincronização da Grade (02:00) — o mês já está atualizado quando
  // o robô confere as sessões — e fora de todos os outros jobs noturnos.
  // Perto do dia de pagamento, o reforço é o botão "Executar agora".
  return String(texto || '03:00')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => {
      const m = s.match(/^(\d{1,2}):(\d{2})$/)
      if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw Object.assign(new Error(`HORARIOS inválido: "${s}"`), { fatal: true })
      return { h: Number(m[1]), m: Number(m[2]) }
    })
    .sort((a, b) => a.h * 60 + a.m - (b.h * 60 + b.m))
}

function carregarConfig(env = process.env) {
  return {
    versao: version,
    siteId: env.SHAREPOINT_SITE_ID,
    somentePastaId: env.SHAREPOINT_SOMENTE_PASTA || null,
    tenantId: env.AZURE_TENANT_ID,
    clientId: env.AZURE_CLIENT_ID,
    supabaseUrl: env.SUPABASE_URL,
    supabaseAnon: env.SUPABASE_ANON_KEY,
    machineToken: env.MACHINE_TOKEN,
    segredoGatilho: env.ROBO_TRIGGER_SECRET || null,
    porta: Number(env.PORT || 8080),
    horarios: lerHorarios(env.HORARIOS),
  }
}

/** Próximo horário agendado (em Brasília) depois de `agora`. */
function proximaExecucao(horarios, agora = new Date()) {
  const agoraBrt = new Date(agora.getTime() + OFFSET_BRASILIA_MIN * 60000)
  for (let dia = 0; dia <= 1; dia++) {
    for (const { h, m } of horarios) {
      const alvoBrt = Date.UTC(agoraBrt.getUTCFullYear(), agoraBrt.getUTCMonth(), agoraBrt.getUTCDate() + dia, h, m)
      const alvo = new Date(alvoBrt - OFFSET_BRASILIA_MIN * 60000)
      if (alvo.getTime() > agora.getTime()) return alvo
    }
  }
  return null
}

module.exports = { carregarConfig, proximaExecucao, lerHorarios }
