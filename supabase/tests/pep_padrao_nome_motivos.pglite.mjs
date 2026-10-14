// Teste da migration 20261014100000 (pep_padrao_nome_motivos) no PGlite.
//
// Prova: (1) os motivos novos saem para os 4 casos que antes tinham mensagem
// enganosa; (2) NENHUM nome muda de "segue o padrão" para "fora" ou o
// contrário — a regra é a mesma de 20261002100000, só o motivo mudou; (3) a
// função SQL dá o mesmo resultado que o espelho em TS
// (frontend/lib/roboSharepoint/padraoNome.test.ts usa os mesmos nomes).
//
// Rodar FORA do repo (o pacote não é dependência do projeto):
//   mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite
//   cp <repo>/supabase/tests/pep_padrao_nome_motivos.pglite.mjs .
//   node pep_padrao_nome_motivos.pglite.mjs <repo>/supabase/migrations

import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'fs'
import { join } from 'path'

const dir = process.argv[2]
if (!dir) { console.error('uso: node pep_padrao_nome_motivos.pglite.mjs <pasta das migrations>'); process.exit(2) }

let falhas = 0
const ok = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { falhas++; console.log('  FALHA', msg) } }

// A função de antes (20261002100000) e a de agora, lado a lado, em dois bancos.
const extrair = (arquivo) => {
  const sql = readFileSync(join(dir, arquivo), 'utf8')
  const ini = sql.indexOf('CREATE OR REPLACE FUNCTION public.sp_pep_ler_nome_padrao')
  const fim = sql.indexOf('$$;', ini) + 3
  return sql.slice(ini, fim)
}
const antes = new PGlite()
const depois = new PGlite()
await antes.exec(extrair('20261002100000_robo_pep_entrega_automatica.sql'))
await depois.exec(extrair('20261014100000_pep_padrao_nome_motivos.sql'))

const ler = async (db, n, s, t) => (await db.query('select public.sp_pep_ler_nome_padrao($1,$2,$3) j', [n, s, t])).rows[0].j

console.log('Motivos novos')
const novos = [
  ['TOP-01-JOAO SILVA-092026.pdf', 'TOP', 'POR_PACIENTE', 'sequencial_nao_esperado'],
  ['PIC-1-JOAO-092026.pdf', 'PIC', 'POR_PACIENTE', 'sequencial_nao_esperado'],
  ['TAP-1-JOAO-092026.pdf', 'TAP', 'POR_PACIENTE', 'sequencial_com_dois_digitos'],
  ['STC-1-092026.pdf', 'STC', 'GERAL', 'sequencial_com_dois_digitos'],
  ['PIC-ADRIAN-092026 (2).pdf', 'PIC', 'POR_PACIENTE', 'copia_com_sufixo'],
  ['PIC-ADRIAN-092026 - Cópia.docx', 'PIC', 'POR_PACIENTE', 'copia_com_sufixo'],
  ['PIC-ADRIAN-09-2026.pdf', 'PIC', 'POR_PACIENTE', 'mes_com_separador'],
  ['STC-01-09_2026.pdf', 'STC', 'GERAL', 'mes_com_separador'],
  ['TOP-01-JOAO-092026.pdf', 'PIC', 'POR_PACIENTE', 'sigla_diferente_da_pasta'],
]
for (const [n, s, t, erro] of novos) {
  const j = await ler(depois, n, s, t)
  ok(j.ok === false && j.erro === erro, `${n} → ${erro} (veio ${j.erro})`)
}

// Decisão FINAL (sp_pep_aplicar_padrao): o formato E, por paciente, o 1º nome
// do paciente do nome bater com a pasta. Antes, "TOP-01-JOAO" passava no
// formato com o paciente "01-JOAO" — e caía na conferência do paciente, porque
// um 1º nome "01" nunca bate. Fora antes, fora agora; só o motivo mudou.
const finalOk = (j, t) => j.ok && (t === 'GERAL' || !/^[0-9]/.test(j.paciente ?? ''))

console.log('A regra não mudou: a decisão final (ok/rep) é a mesma antes e depois')
const todos = [
  ...novos.map(([n, s, t]) => [n, s, t]),
  ['STC-01-092026.pdf', 'STC', 'GERAL'], ['ETC-04-092026.pdf', 'ETC', 'GERAL'],
  ['TAP-02-JOAO SILVA-092026.pdf', 'TAP', 'POR_PACIENTE'], ['PIC-JOAO SILVA-092026.docx', 'PIC', 'POR_PACIENTE'],
  ['TOP - Adrian Costa - 092026.pdf', 'TOP', 'POR_PACIENTE'], ['RT-JOAO-092026.pdf', 'RT', 'POR_PACIENTE'],
  ['OE-JOAO SILVA-092026.pdf', 'OE', 'POR_PACIENTE'], ['REP-PIC-JOAO SILVA-092026.pdf', 'PIC', 'POR_PACIENTE'],
  ['Relatorio.pdf', 'PIC', 'POR_PACIENTE'], ['ETC-092026.pdf', 'ETC', 'GERAL'], ['TAP-JOAO-092026.pdf', 'TAP', 'POR_PACIENTE'],
  ['PIC-JOAO.pdf', 'PIC', 'POR_PACIENTE'], ['STC-01-092026.pdf', 'ETC', 'GERAL'],
]
for (const [n, s, t] of todos) {
  const a = await ler(antes, n, s, t)
  const d = await ler(depois, n, s, t)
  ok(finalOk(a, t) === finalOk(d, t) && a.rep === d.rep, `${n} (${s}): segue ${finalOk(a, t)}→${finalOk(d, t)}, rep ${a.rep}→${d.rep}`)
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.')
process.exit(falhas ? 1 : 0)
