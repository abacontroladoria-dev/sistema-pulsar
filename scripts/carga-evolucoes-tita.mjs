#!/usr/bin/env node
// Carga histórica das evoluções do TiTa na grade_evolucoes (arquivo, linhas
// sem sessão na Grade — migration 20261019200300).
//
// Por que existe: a cópia csv_grades_profissionais só guarda o texto da
// evolução dos últimos ~45 dias (medido em 19/10/2026: texto só a partir de
// 27/07/2026; de janeiro a maio nem o status). O TiTa devolve qualquer data
// passada com o texto completo. Este script busca dia a dia e grava pela MESMA
// função que o gatilho diário usa (sp_grade_evolucoes_arquivar_tita): as regras
// de "o que é evolução" ficam num lugar só.
//
// NÃO toca na csv_grades_profissionais (que alimenta remuneração e outras
// telas). Rodar de novo é seguro: reenviar um dia só atualiza o que mudou.
//
//   node scripts/carga-evolucoes-tita.mjs                         → 2026-01-01 a 2026-07-26
//   node scripts/carga-evolucoes-tita.mjs --de 2026-03-01 --ate 2026-03-31
//   node scripts/carga-evolucoes-tita.mjs --seco                  → só lê o TiTa e conta, não grava
//
// Usa a service_role e o TITA_TOKEN do frontend/.env.local.

import { readFileSync } from "fs"
import { dirname, join } from "path"
import { fileURLToPath } from "url"

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..")
const env = {}
for (const l of readFileSync(join(raiz, "frontend", ".env.local"), "utf8").split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "")
}
// No .env.local o "$" do token vem escapado ("\$"), porque o Next expande "$".
const BARRA = String.fromCharCode(92)
const TITA_TOKEN = (env.TITA_TOKEN ?? "").split(BARRA + "$").join("$")
const SUPABASE_URL = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!TITA_TOKEN || !SUPABASE_URL || !SERVICE_KEY) {
  console.error("✖ Faltam TITA_TOKEN, SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY no frontend/.env.local")
  process.exit(1)
}

const arg = nome => {
  const i = process.argv.indexOf(`--${nome}`)
  return i > 0 ? process.argv[i + 1] : undefined
}
const DE = arg("de") ?? "2026-01-01"
const ATE = arg("ate") ?? "2026-07-26"
if (!/^\d{4}-\d{2}-\d{2}$/.test(DE) || !/^\d{4}-\d{2}-\d{2}$/.test(ATE) || DE > ATE) {
  console.error("✖ Use --de AAAA-MM-DD --ate AAAA-MM-DD (de ≤ até)")
  process.exit(1)
}
const UNIDADE = 280
const LOTE = 200
const SECO = process.argv.includes("--seco")

// ─── CSV do TiTa ──────────────────────────────────────────────────────────────

/** CSV com campo entre aspas, aspas dobradas e quebra de linha dentro do campo. */
function lerCsv(texto) {
  const linhas = []
  let linha = [], campo = "", aspas = false
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]
    if (aspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++ } else aspas = false
      } else campo += c
    } else if (c === '"') aspas = true
    else if (c === ",") { linha.push(campo); campo = "" }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++
      linha.push(campo); linhas.push(linha); linha = []; campo = ""
    } else campo += c
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha) }
  return linhas.filter(l => l.some(v => v.trim()))
}

const normalizar = s => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(String.fromCharCode(0xfeff), "").trim().toLowerCase()

// Mesmas conversões da Edge Function sync-grade-csv (toInt/toTime/toDate/toTimestamp/toBool).
const toInt = s => (/^-?\d+$/.test((s ?? "").trim()) ? Number(s.trim()) : null)
function toTime(s) {
  const m = (s ?? "").match(/^(\d{1,2}):(\d{2})/)
  return m ? `${m[1].padStart(2, "0")}:${m[2]}:00` : null
}
function toDate(s) {
  const t = (s ?? "").trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  const br = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  return br ? `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}` : null
}
function toTimestamp(s) {
  const t = (s ?? "").trim()
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
  if (iso) {
    const [, a, m, d, hh, mm, ss] = iso
    return `${a}-${m}-${d}T${(hh ?? "00").padStart(2, "0")}:${mm ?? "00"}:${ss ?? "00"}-03:00`
  }
  const br = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
  if (br) {
    const [, d, m, a, hh, mm, ss] = br
    return `${a}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T${(hh ?? "00").padStart(2, "0")}:${mm ?? "00"}:${ss ?? "00"}-03:00`
  }
  return null
}
function toBool(s) {
  const t = (s ?? "").trim().toLowerCase()
  if (["sim", "s", "1", "true"].includes(t)) return true
  if (["não", "nao", "n", "0", "false"].includes(t)) return false
  return null
}

async function buscarDia(dia) {
  const r = await fetch("https://apiv2.apptita.com.br/api/integracao/csv_grade_profissionais", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-INTEGRACAO-TOKEN": TITA_TOKEN },
    body: JSON.stringify({ data_inicio: dia, data_fim: dia, unidade: UNIDADE }),
  })
  if (!r.ok) throw new Error(`TiTa respondeu ${r.status}`)
  const linhas = lerCsv(await r.text())
  if (linhas.length < 2) return []
  const cab = linhas[0].map(normalizar)
  const col = nome => cab.indexOf(normalizar(nome))
  const i = {
    ag: col("id agendamento"), pac: col("id favorecido"), pacNome: col("nome favorecido"), data: col("data"),
    hi: col("hora inicial"), hf: col("hora final"), prof: col("id profissional"), profNome: col("profissional"),
    ter: col("terapia"), terEx: col("terapia exibição"), uni: col("id unidade"), conv: col("convênio"),
    status: col("status"), possui: col("possui tratativa"), trat: col("id profissional tratativa"),
    tratNome: col("nome profissional tratativa"), tratEm: col("criação tratativa"), tratOrig: col("origem tratativa"),
    vinc: col("vínculo da evolução"), desc: col("descrição da evolução"),
  }
  for (const [k, v] of Object.entries(i)) if (v < 0) throw new Error(`coluna "${k}" sumiu do CSV do TiTa`)
  const v = (l, k) => (l[i[k]] ?? "").trim()
  return linhas.slice(1).map(l => ({
    tita_agendamento_id: toInt(v(l, "ag")),
    paciente_id: toInt(v(l, "pac")),
    paciente_nome: v(l, "pacNome") || null,
    data: toDate(v(l, "data")),
    hora_inicial: toTime(v(l, "hi")),
    hora_final: toTime(v(l, "hf")),
    profissional_id: toInt(v(l, "prof")),
    profissional_nome: v(l, "profNome") || null,
    terapia_nome: v(l, "ter") || null,
    terapia_exibicao_nome: v(l, "terEx") || null,
    unidade_id: toInt(v(l, "uni")),
    convenio_nome: v(l, "conv") || null,
    status_execucao: v(l, "status") || null,
    possui_tratativa: toBool(v(l, "possui")),
    tratativa_profissional_id: toInt(v(l, "trat")),
    tratativa_profissional_nome: v(l, "tratNome") || null,
    tratativa_criada_em: toTimestamp(v(l, "tratEm")),
    tratativa_origem: v(l, "tratOrig") || null,
    evolucao_vinculo: v(l, "vinc") || null,
    // O texto vai como veio (sem trim): quebras de linha e espaços são do profissional.
    descricao_evolucao: (l[i.desc] ?? "") || null,
    ativo: true,
  }))
}

async function arquivar(lote) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/sp_grade_evolucoes_arquivar_tita`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_linhas: lote }),
  })
  const corpo = await r.text()
  if (!r.ok) throw new Error(`banco respondeu ${r.status}: ${corpo.slice(0, 200)}`)
  return Number(corpo) || 0
}

async function comRetentativa(rotulo, fn) {
  for (let t = 1; ; t++) {
    try {
      return await fn()
    } catch (e) {
      if (t >= 4) throw new Error(`${rotulo}: ${e.message}`)
      await new Promise(r => setTimeout(r, 2000 * t))
    }
  }
}

// ─── Laço ────────────────────────────────────────────────────────────────────

const proximo = d => {
  const x = new Date(`${d}T12:00:00Z`)
  x.setUTCDate(x.getUTCDate() + 1)
  return x.toISOString().slice(0, 10)
}

const porMes = {}
let totalEvol = 0, totalGravadas = 0
console.log(`Carga de evoluções do TiTa: ${DE} a ${ATE}${SECO ? " (seco: não grava)" : ""}`)
for (let dia = DE; dia <= ATE; dia = proximo(dia)) {
  try {
    const linhas = await comRetentativa(`TiTa ${dia}`, () => buscarDia(dia))
    const evol = linhas.filter(l => l.possui_tratativa === true && (l.descricao_evolucao ?? "").trim())
    let gravadas = 0
    for (let k = 0; !SECO && k < evol.length; k += LOTE) {
      gravadas += await comRetentativa(`banco ${dia}`, () => arquivar(evol.slice(k, k + LOTE)))
    }
    totalEvol += evol.length
    totalGravadas += gravadas
    const mes = dia.slice(0, 7)
    porMes[mes] = (porMes[mes] ?? 0) + evol.length
    console.log(`${dia}  linhas ${String(linhas.length).padStart(5)}  evoluções ${String(evol.length).padStart(4)}  gravadas/atualizadas ${gravadas}`)
  } catch (e) {
    console.error(`✖ ${dia} falhou: ${e.message}`)
    console.error(`  Para retomar: node scripts/carga-evolucoes-tita.mjs --de ${dia} --ate ${ATE}`)
    process.exitCode = 1
    break
  }
}
console.log("\nEvoluções vindas do TiTa por mês:", porMes)
console.log(`Total: ${totalEvol} evoluções; ${totalGravadas} gravadas ou atualizadas.`)
