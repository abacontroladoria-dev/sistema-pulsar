// Varredura EXTERNA de vazamento — o sistema inteiro, do lado de fora, como um
// invasor faria. Generaliza scripts/seguranca-cadastro-profissionais.mjs.
//
//   node scripts/seguranca-varredura-completa.mjs
//   TOKEN_SEM_PERMISSAO=eyJ... node scripts/seguranca-varredura-completa.mjs
//
// 1. Invasor EXTERNO (só a chave anon, que está no JavaScript do site):
//    • lê a OpenAPI anônima: tudo o que aparece lá é objeto que o anon alcança;
//    • tenta ler 1 linha de cada tabela/view listada;
//    • lista as RPCs que o anon pode executar (NÃO executa nenhuma);
//    • pergunta ao GraphQL quais tabelas ele expõe ao anon;
//    • lista as Edge Functions com nome de teste/diagnóstico (devem sair do ar);
//    • SÓ com SONDAR_FUNCOES=1: faz GET sem credencial em cada Edge Function
//      (deve dar 401). Desligado por padrão: uma função publicada sem
//      verify_jwt EXECUTARIA com esse GET — e há funções de teste no repo.
// 2. Invasor INTERNO (TOKEN_SEM_PERMISSAO = access_token de um usuário logado
//    SEM nenhuma permissão de cadastro/agenda, copiado do navegador: DevTools →
//    Application → Local Storage → sb-…-auth-token): tenta ler 1 linha de cada
//    tabela sensível, cada coluna revogada, as RPCs de paciente e — com
//    SITE_URL=https://… — as rotas /api que exigem permissão. Precisa voltar
//    vazio/recusado.
//
// Só LÊ. Termina com "✔ Nenhum vazamento" ou a lista de "✘ VAZAMENTO".
// Resultado e matriz: docs/SEGURANCA_DADOS_AGENDA.md.

import { existsSync, readFileSync, readdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')

// Dado pessoal ou de saúde. Usuário sem permissão não pode ler nenhuma linha.
const SENSIVEIS = [
  'pacientes', 'pacientes_importacoes_log', 'pacientes_disponibilidade_versoes',
  'profissionais', 'profissionais_terapias_habilitadas',
  'profissionais_disponibilidade_versoes', 'profissionais_disponibilidade_faixas', 'profissionais_disponibilidade_eventos',
  'grade_agendamentos', 'grade_series', 'grade_bloqueios', 'grade_eventos', 'grade_importacoes', 'grade_importacoes_itens',
  'tita_importacoes', 'tita_importacoes_itens', 'sistema_tita_corte',
  'csv_grades_profissionais', 'agenda_tita', 'grade_profissionais_tita', 'controle_terapeutico', 'cadastros_auditoria',
  'vw_grade_base', 'vw_grade_atendimentos', 'vw_central_terapeutica',
]

// Leitura por coluna (migration 20261019140000 e seguintes): NENHUM login lê
// estas colunas, tenha a permissão que tiver. `select=*` nessas tabelas dá
// "permission denied" pelo `*`, não pela RLS — por isso cada coluna é pedida
// sozinha.
const COLUNAS_REVOGADAS = {
  grade_profissionais_tita: ['cpf_profissional', 'numero_telefone', 'cbo_profissional', 'registro_profissional',
    'tipo_registro_profissional', 'uf_registro_profissional', 'raw_json', 'observacoes_sala'],
  csv_grades_profissionais: ['profissional_cpf', 'sala_observacoes'],
}

// RPCs que devolvem dado de paciente: usuário SEM permissão tem de ser recusado.
const RPCS_PROTEGIDAS = [
  ['pacientes_lista_basica', {}],
  ['pacientes_buscar_para_pep', { p_termo: 'ana' }],
  ['listar_pacientes_assim', {}],
]

// Rotas /api do Next que exigem permissão de tela (feat/seguranca-falhas-dados).
// Testadas com SITE_URL (ex. http://localhost:3000 sem DISABLE_AUTH, ou o
// endereço de produção) + TOKEN_SEM_PERMISSAO: a sessão vai no cookie do
// @supabase/ssr. Esperado: 401/403 em todas.
const ROTAS_PROTEGIDAS = [
  ['GET', '/api/laudos/'],
  ['GET', '/api/tita/situacao-favorecidos/'],
  ['GET', '/api/pdi-controle-prazos/'],
  ['POST', '/api/terapeutico/auditoria-evolucoes/grade/', { dataInicio: '2026-09-01' }],
  ['GET', '/api/central/organization/'],
]

// Edge Functions de teste apagadas do repositório (P0). Precisam responder 404.
const FUNCOES_REMOVIDAS = ['tita-compare-endpoints', 'test_env', 'cco-test-setup', 'cco-conciliation-engine-test']

/** Toda tabela/view do schema public criada nas migrations (a OpenAPI anônima pode estar fechada). */
function objetosDasMigrations() {
  const pasta = join(raiz, '..', 'supabase', 'migrations')
  const nomes = new Set()
  const re = /create\s+(?:or\s+replace\s+)?(?:table|view|materialized\s+view)\s+(?:if\s+not\s+exists\s+)?(?:"?public"?\.)?"?(\w+)"?\s*[\s(]/gi
  for (const f of readdirSync(pasta).filter(x => x.endsWith('.sql'))) {
    const sql = readFileSync(join(pasta, f), 'utf8')
    for (const m of sql.matchAll(re)) {
      const antes = sql.slice(Math.max(0, m.index - 1), m.index)
      if (!/\w/.test(antes)) nomes.add(m[1].toLowerCase())
    }
  }
  return [...nomes].filter(n => !/^(tmp_|pg_)/.test(n)).sort()
}

function lerEnv() {
  const arquivo = join(raiz, '.env.local')
  if (!existsSync(arquivo)) return null
  return Object.fromEntries(
    readFileSync(arquivo, 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l))
      .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')] })
  )
}

async function main() {
  const env = lerEnv()
  const url = env?.NEXT_PUBLIC_SUPABASE_URL
  const anon = env?.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    console.error('✖ Faltam NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY em frontend/.env.local.')
    return 1
  }

  let vazamentos = 0
  let atencao = 0
  const vaza = t => { vazamentos++; console.log(`✘ VAZAMENTO ${t}`) }
  const olhar = t => { atencao++; console.log(`⚠ ATENÇÃO  ${t}`) }
  const okLog = t => console.log(`✔ ${t}`)
  const hAnon = { apikey: anon, Authorization: `Bearer ${anon}` }

  // ── 1. Externo ────────────────────────────────────────────────────────────
  console.log('\n── Invasor externo (chave anon) ──')
  const api = await fetch(`${url}/rest/v1/`, { headers: { ...hAnon, Accept: 'application/openapi+json' } })
  const spec = api.ok ? await api.json().catch(() => null) : null
  const caminhos = Object.keys(spec?.paths ?? {}).filter(p => p !== '/')
  const tabelas = caminhos.filter(p => !p.startsWith('/rpc/')).map(p => p.slice(1))
  const rpcs = caminhos.filter(p => p.startsWith('/rpc/')).map(p => p.slice(5))
  if (!spec) okLog(`OpenAPI fechada ao anon (HTTP ${api.status}): ele não enxerga o catálogo.`)
  else olhar(`OpenAPI aberta ao anon: ${tabelas.length} tabela(s)/view(s) e ${rpcs.length} RPC(s) visíveis.`)

  const alvos = [...new Set([...tabelas, ...objetosDasMigrations()])]
  let negados = 0
  for (const t of alvos) {
    const r = await fetch(`${url}/rest/v1/${t}?select=*&limit=1`, { headers: hAnon })
    const corpo = r.ok ? await r.json().catch(() => null) : null
    if (r.ok && Array.isArray(corpo) && corpo.length) vaza(`anon LÊ ${t} (${Object.keys(corpo[0]).length} colunas)`)
    else if (r.ok) olhar(`anon enxerga ${t} (vazio para ele pela RLS, mas tem GRANT — revogue)`)
    else negados++
  }
  okLog(`${negados} de ${alvos.length} tabela(s)/view(s) recusadas ao anon.`)
  for (const f of rpcs) olhar(`anon pode EXECUTAR rpc/${f} — confira se é pública de propósito`)

  const gql = await fetch(`${url}/graphql/v1`, {
    method: 'POST', headers: { ...hAnon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '{ __schema { queryType { fields { name } } } }' }),
  }).catch(() => null)
  const campos = gql?.ok ? ((await gql.json().catch(() => null))?.data?.__schema?.queryType?.fields ?? []).map(f => f.name) : []
  const gqlSensivel = campos.filter(c => SENSIVEIS.some(s => c.toLowerCase().includes(s.replace(/_/g, '').slice(0, 10))))
  if (gqlSensivel.length) vaza(`GraphQL expõe ao anon: ${gqlSensivel.join(', ')}`)
  else if (campos.length > 1) olhar(`GraphQL responde ao anon (${campos.length} campos). Se não é usado, desligue a extensão pg_graphql.`)
  else okLog('GraphQL não expõe tabelas ao anon.')

  const pastaFuncoes = join(raiz, '..', 'supabase', 'functions')
  const funcoes = existsSync(pastaFuncoes)
    ? readdirSync(pastaFuncoes, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('_')).map(d => d.name)
    : []
  for (const f of funcoes.filter(n => /test|debug|diag|compare|env/i.test(n))) {
    olhar(`Edge Function de teste/diagnóstico no repositório: ${f} — se estiver publicada, remova (supabase functions delete ${f})`)
  }
  if (process.env.SONDAR_FUNCOES === '1') {
    for (const f of funcoes) {
      const r = await fetch(`${url}/functions/v1/${f}`, { method: 'GET' }).catch(() => null)
      if (!r || r.status === 401 || r.status === 403 || r.status === 404) continue
      olhar(`Edge Function ${f} responde sem credencial (HTTP ${r.status}) — confirme verify_jwt ou checagem própria`)
    }
    okLog(`${funcoes.length} Edge Function(s) sondada(s) sem credencial.`)
    // Removidas do repositório: OPTIONS não executa o código, só diz se ainda está publicada.
    for (const f of FUNCOES_REMOVIDAS) {
      const r = await fetch(`${url}/functions/v1/${f}`, { method: 'OPTIONS' }).catch(() => null)
      if (r?.status === 404) okLog(`Edge Function removida ${f}: fora do ar (404).`)
      else vaza(`Edge Function removida ${f} AINDA PUBLICADA (HTTP ${r?.status ?? 'sem resposta'}) — supabase functions delete ${f}`)
    }
  } else {
    console.log('(Sondagem das Edge Functions pulada: rode com SONDAR_FUNCOES=1 depois de remover as de teste.)')
  }

  // ── 2. Interno ────────────────────────────────────────────────────────────
  const token = process.env.TOKEN_SEM_PERMISSAO
  if (token) {
    console.log('\n── Invasor interno (logado, sem permissão) ──')
    const h = { apikey: anon, Authorization: `Bearer ${token}` }
    for (const t of SENSIVEIS) {
      const r = await fetch(`${url}/rest/v1/${t}?select=*&limit=1`, { headers: h })
      const corpo = r.ok ? await r.json().catch(() => null) : null
      if (r.ok && Array.isArray(corpo) && corpo.length) vaza(`logado sem permissão LÊ ${t}`)
      else okLog(`${t}: ${r.ok ? 'vazio' : `HTTP ${r.status}`}`)
    }
    for (const [t, colunas] of Object.entries(COLUNAS_REVOGADAS)) {
      for (const c of colunas) {
        const r = await fetch(`${url}/rest/v1/${t}?select=${c}&limit=1`, { headers: h })
        const corpo = r.ok ? await r.json().catch(() => null) : null
        if (r.ok && Array.isArray(corpo) && corpo.length) vaza(`logado LÊ a coluna ${t}.${c}`)
        else if (r.ok) olhar(`${t}.${c}: sem linha, mas a coluna ainda tem GRANT para o login — aplique a migration 20261019140000`)
        else okLog(`${t}.${c}: recusada (HTTP ${r.status})`)
      }
    }
    for (const [fn, corpo] of RPCS_PROTEGIDAS) {
      const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
        method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
      })
      const json = r.ok ? await r.json().catch(() => null) : null
      if (r.ok && Array.isArray(json) && json.length) vaza(`logado sem permissão EXECUTA rpc/${fn} e recebe ${json.length} linha(s)`)
      else if (r.status === 404) olhar(`rpc/${fn} não existe neste banco (migration pendente?)`)
      else okLog(`rpc/${fn}: ${r.ok ? 'vazio' : `recusada (HTTP ${r.status})`}`)
    }

    const site = process.env.SITE_URL?.replace(/\/$/, '')
    if (site) {
      // Cookie de sessão no formato do @supabase/ssr: base64-<json da sessão>.
      const ref = new URL(url).hostname.split('.')[0]
      const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
      const sessao = { access_token: token, token_type: 'bearer', expires_at: claims.exp, expires_in: 3600, refresh_token: 'varredura', user: { id: claims.sub } }
      const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(sessao)).toString('base64url')}`
      for (const [metodo, caminho, corpo] of ROTAS_PROTEGIDAS) {
        const r = await fetch(`${site}${caminho}`, {
          method: metodo, redirect: 'manual',
          headers: { cookie, ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
          body: corpo ? JSON.stringify(corpo) : undefined,
        }).catch(() => null)
        if (!r) olhar(`${caminho}: sem resposta de ${site}`)
        else if (r.status === 401 || r.status === 403) okLog(`${caminho}: recusada (HTTP ${r.status})`)
        else if (r.ok) vaza(`logado sem permissão recebe ${caminho} (HTTP ${r.status})`)
        else olhar(`${caminho}: HTTP ${r.status} — confira à mão`)
      }
    } else {
      console.log('(Sem SITE_URL: as rotas /api não foram testadas.)')
    }
  } else {
    console.log('\n(Sem TOKEN_SEM_PERMISSAO: o teste do invasor interno foi pulado.)')
  }

  console.log(`\n${vazamentos ? `✘ ${vazamentos} VAZAMENTO(S)` : '✔ Nenhum vazamento'} · ${atencao} ponto(s) de atenção`)
  return vazamentos ? 1 : 0
}

main().then(c => { process.exitCode = c }).catch(e => { console.error(e); process.exitCode = 1 })
