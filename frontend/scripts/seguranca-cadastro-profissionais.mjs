// Teste EXTERNO de vazamento do Cadastro de Profissionais/Terapias — roda contra
// o Supabase de verdade, do lado de fora, como um atacante faria.
//
//   node scripts/seguranca-cadastro-profissionais.mjs
//   TOKEN_SEM_PERMISSAO=eyJ... node scripts/seguranca-cadastro-profissionais.mjs
//
// Usa SÓ a chave pública (NEXT_PUBLIC_SUPABASE_ANON_KEY do .env.local) — a mesma
// que qualquer pessoa extrai do JavaScript do site. Com TOKEN_SEM_PERMISSAO (o
// access_token de um usuário logado SEM a permissão "Profissionais", copiado do
// navegador: DevTools → Application → Local Storage → sb-…-auth-token), repete
// tudo como esse usuário.
//
// Passa quando: toda tabela/view devolve 401/403 ou lista vazia, toda RPC é
// recusada, e a OpenAPI anônima não lista nenhum objeto novo. Só LÊ e tenta
// executar com argumentos inválidos — não grava nada mesmo se uma porta estiver
// aberta (as RPCs recusam id inexistente antes de gravar).
//
// Rodar DEPOIS de aplicar as migrations 20261006120000…140000 em produção. Antes
// disso tudo dá 404 (objeto não existe), e o script avisa.

import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')

async function main() {
  const arquivo = join(raiz, '.env.local')
  if (!existsSync(arquivo)) {
    console.error('✖ frontend/.env.local não encontrado.')
    return 1
  }
  const env = Object.fromEntries(
    readFileSync(arquivo, 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l))
      .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')] })
  )
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    console.error('✖ Faltam NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.')
    return 1
  }

  const TABELAS = [
    'cadastro_terapias', 'profissionais', 'profissionais_terapias_habilitadas',
    'profissionais_disponibilidade_versoes', 'profissionais_disponibilidade_faixas',
    'profissionais_disponibilidade_faixa_terapias', 'profissionais_disponibilidade_eventos',
    'vw_profissionais_terapias_grade', 'vw_profissionais_disponibilidade_versoes', 'vw_profissionais_grade_situacao',
  ]
  const ZERO = '00000000-0000-0000-0000-000000000000'
  const RPCS = {
    profissionais_importar_tita: {},
    profissionais_locais: {},
    profissional_disponibilidade_criar_versao: {
      p_profissional_id: -1, p_vigente_de: '2099-01-01', p_vigente_ate: null, p_dias: [], p_faixas: [], p_motivo: 'teste de segurança',
    },
    profissional_disponibilidade_alterar_vigencia: { p_versao_id: ZERO, p_vigente_de: '2099-01-01', p_vigente_ate: null, p_motivo: 'teste de segurança' },
    sp_prof_disp_gravar_faixas: { p_versao_id: ZERO, p_profissional_id: -1, p_faixas: [] },
    normalizar_nome_terapia: { p: 'x' },
    hoje_brasilia: {},
  }

  const quem = [['anon', anon]]
  if (process.env.TOKEN_SEM_PERMISSAO) quem.push(['usuário sem permissão', process.env.TOKEN_SEM_PERMISSAO])

  let falhas = 0
  let naoAplicada = 0
  const marca = (ok, texto) => { if (!ok) falhas++; console.log(`${ok ? '✔' : '✘ VAZAMENTO'} ${texto}`) }

  for (const [nome, token] of quem) {
    const h = { apikey: anon, Authorization: `Bearer ${token}` }
    console.log(`\n── Como ${nome} ──`)

    for (const t of TABELAS) {
      const r = await fetch(`${url}/rest/v1/${t}?select=*&limit=1`, { headers: h })
      const corpo = await r.text()
      if (r.status === 404) { naoAplicada++; console.log(`· ${t}: não existe (404) — migration aplicada?`); continue }
      const vazio = r.ok && corpo.trim() === '[]'
      // cadastro_terapias é legível para QUALQUER usuário logado (nome + cor, por desenho); para anon, não.
      const liberadoPorDesenho = t === 'cadastro_terapias' && nome !== 'anon' && r.ok
      marca(r.status === 401 || r.status === 403 || vazio || liberadoPorDesenho,
        `${t}: HTTP ${r.status}${r.ok && !vazio ? ` — devolveu dados${liberadoPorDesenho ? ' (catálogo, esperado)' : ''}` : ''}`)
    }

    for (const [fn, corpo] of Object.entries(RPCS)) {
      const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
        method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
      })
      const texto = (await r.text()).slice(0, 120)
      if (r.status === 404 && /PGRST202/.test(texto)) { naoAplicada++; console.log(`· rpc/${fn}: não existe (404)`); continue }
      marca(!r.ok, `rpc/${fn}: HTTP ${r.status} ${r.ok ? '— EXECUTOU' : texto.replace(/\s+/g, ' ')}`)
    }

    // OpenAPI: o PostgREST só lista o que o papel consegue acessar.
    const api = await fetch(`${url}/rest/v1/`, { headers: { ...h, Accept: 'application/openapi+json' } })
    if (api.ok) {
      const doc = await api.json()
      const expostos = Object.keys(doc.paths ?? {}).filter(p => /profission|cadastro_terapias|rpc\/(sp_prof|hoje_brasilia|normalizar_nome)/.test(p))
      // Logado: a OpenAPI lista o que tem GRANT, mesmo que a RLS não devolva linha
      // nenhuma — isso não é vazamento (as linhas foram testadas acima). Só a
      // função INTERNA de gravação de faixas não pode aparecer para ninguém.
      const tolerado = nome !== 'anon' ? expostos.filter(p => /rpc\/sp_prof/.test(p)) : expostos
      marca(tolerado.length === 0, `OpenAPI ${nome}: ${tolerado.length ? `expõe ${tolerado.join(', ')}` : 'nada novo exposto indevidamente'}`)
    } else {
      console.log(`· OpenAPI ${nome}: HTTP ${api.status} (não listável — ok)`)
    }
  }

  console.log('')
  if (naoAplicada) console.log(`ℹ ${naoAplicada} objeto(s) ainda não existem — aplique as migrations e rode de novo.`)
  console.log(falhas ? `✘ ${falhas} possível(is) vazamento(s). NÃO publique.` : '✔ Nenhum vazamento encontrado.')
  return falhas ? 1 : 0
}

main().then(code => { process.exitCode = code })
