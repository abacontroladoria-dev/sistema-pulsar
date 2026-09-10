#!/usr/bin/env node
// Confere as vagas ofertáveis contra a GRADE da TiTa, na janela da tela.
//
//   node scripts/conferir-vagas-sem-grade.js [de] [ate]
//
//   node scripts/conferir-vagas-sem-grade.js                    # janela de getJanelaOcupacaoPaciente()
//   node scripts/conferir-vagas-sem-grade.js 2026-10-01 2026-10-07
//
// Somente leitura: nenhuma escrita, nenhuma chamada à API da TiTa.
//
// Por que este script existe
// ──────────────────────────
// Em 10/09/2026 a Ocupação de Paciente ofertou a segunda-feira de manhã da Evelyn
// Andressa (profissional_id 8638) para o Theo Meneses Da Silva. A profissional não
// tem grade aberta na segunda pela manhã — a segunda dela começa às 13:00.
//
// A causa: `csv_grades_profissionais` (export de AGENDAMENTOS, de onde a oferta é
// lida via vw_grade_base) tinha 13 linhas dela naquela segunda, sendo 6 fantasmas
// na manhã, com status 'Livre'. A `grade_profissionais_tita` (export da GRADE do
// terapeuta) tinha só 7, todas de 13:00 em diante — igual à API da TiTa.
//
// A grade não representa "sem grade aberta" com um status: ela só tem 'Agendado' e
// 'Livre'. O horário sem grade simplesmente NÃO VEM. Por isso a regra C2 de
// frontend/lib/cronograma/gradeTitaOcupacao.ts exige PRESENÇA na grade, e é o
// efeito dela que este script mede.
//
// O que ele responde
// ──────────────────
// Quantos slots 'Livre' de vw_grade_base não têm linha correspondente na grade da
// TiTa — ou seja, quantas vagas a tela ofertaria em horário que não existe.
// Na medição de 10/09/2026 (janela 01/10→07/10): 79 de 748 slots, dos quais a C2
// derruba 8 e 71 caem na abstenção por profissional fora da grade. Meta: 0 na
// linha da C2.
//
// Reporta as três categorias lado a lado, porque a diferença entre elas é o que
// importa: C1 (grade diz 'Agendado'), C2 (o horário não existe na grade) e a
// abstenção (profissional sem NENHUMA linha na grade em qualquer data — ambíguo
// entre sync parcial e desligado com linhas órfãs, então a regra não decide).
//
// Cuidado ao mexer: abster por DIA em vez de por profissional parece mais
// conservador e não é. Medido em 10/09 — os 71 slots viravam "abstenção por dia"
// e nenhum deles era sync parcial: a nossa cópia batia 100% com a API bruta da
// TiTa. Eram profissionais com grade em três dias sendo ofertados nos outros.

const { lerEnv, descreverDestino } = require("./lib/backup-grade.js")

const UNIDADE = 280
const PAGE = 1000

// Mesma janela de getJanelaOcupacaoPaciente() (frontend/lib/cronograma/helpers.ts):
// dia 1 do mês seguinte + 6 dias, escolhida para conter exatamente uma ocorrência
// de cada dia da semana.
function janelaPadrao() {
  const hoje = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }))
  const inicio = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1)
  const fim = new Date(inicio)
  fim.setDate(fim.getDate() + 6)
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  return { de: iso(inicio), ate: iso(fim) }
}

async function buscarTudo(cfg, tabela, campos, filtro) {
  const linhas = []
  for (let from = 0; ; from += PAGE) {
    const url = `${cfg.url}/rest/v1/${tabela}?select=${encodeURIComponent(campos)}&${filtro}&order=id&limit=${PAGE}&offset=${from}`
    const resp = await fetch(url, { headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` } })
    if (!resp.ok) throw new Error(`${tabela}: HTTP ${resp.status} — ${(await resp.text()).slice(0, 300)}`)
    const pagina = await resp.json()
    linhas.push(...pagina)
    if (pagina.length < PAGE) return linhas
  }
}

const hhmm = h => String(h ?? "").slice(0, 5)
const dia = d => String(d ?? "").slice(0, 10)
const dowDe = d => new Date(`${dia(d)}T12:00:00`).getDay()

async function main() {
  const [deArg, ateArg] = process.argv.slice(2)
  const { de, ate } = deArg && ateArg ? { de: deArg, ate: ateArg } : janelaPadrao()

  const cfg = lerEnv()
  console.log(`Destino: ${descreverDestino(cfg)}`)
  console.log(`Janela:  ${de} → ${ate} (unidade ${UNIDADE})\n`)

  // As vagas como a tela as lê: 'Livre' em vw_grade_base.
  const livres = await buscarTudo(
    cfg, "vw_grade_base",
    "id, profissional_id, profissional_nome, data, dia_semana, hora_inicial, terapia_nome",
    `unidade_id=eq.${UNIDADE}&status_agendamento=eq.Livre&data=gte.${de}&data=lte.${ate}`,
  )

  // A grade do terapeuta. Sem filtro de status: a C2 precisa das linhas 'Livre'
  // para saber que o horário EXISTE. `desde` = início da janela, como no módulo —
  // a C1 olha para frente porque a série semanal vai até 31/12.
  const grade = await buscarTudo(
    cfg, "grade_profissionais_tita",
    "id, profissional_id, data, hora_inicial, status_agendamento",
    `id_unidade=eq.${UNIDADE}&data=gte.${de}`,
  )

  const naGrade = new Set()          // profId|data|hora — existe na grade
  const profissionaisLidos = new Set()// profId          — a grade trouxe algo dele
  const comprometidos = new Set()    // profId|dow|hora  — a grade diz 'Agendado'
  for (const l of grade) {
    if (l.profissional_id == null || !l.data || !l.hora_inicial) continue
    profissionaisLidos.add(l.profissional_id)
    naGrade.add(`${l.profissional_id}|${dia(l.data)}|${hhmm(l.hora_inicial)}`)
    if (l.status_agendamento === "Agendado") {
      comprometidos.add(`${l.profissional_id}|${dowDe(l.data)}|${hhmm(l.hora_inicial)}`)
    }
  }

  const semGrade = [], porC1 = [], porC3 = [], abstidos = []
  for (const r of livres) {
    if (r.profissional_id == null || !r.data || !r.hora_inicial) continue
    const d = dia(r.data), h = hhmm(r.hora_inicial)
    if (comprometidos.has(`${r.profissional_id}|${dowDe(d)}|${h}`)) { porC1.push(r); continue }
    if (/^inativo-?\s*/i.test(String(r.profissional_nome ?? "").trim())) { porC3.push(r); continue }
    if (!profissionaisLidos.has(r.profissional_id)) { abstidos.push(r); continue }
    if (!naGrade.has(`${r.profissional_id}|${d}|${h}`)) semGrade.push(r)
  }

  const pct = n => livres.length ? `${(n / livres.length * 100).toFixed(1)}%` : "—"
  console.log(`Slots 'Livre' em vw_grade_base: ${livres.length}`)
  console.log(`Linhas na grade da TiTa:        ${grade.length}\n`)
  console.log(`C1 — grade diz 'Agendado':      ${porC1.length} (${pct(porC1.length)})`)
  console.log(`C3 — profissional desligado:    ${porC3.length} (${pct(porC3.length)})`)
  console.log(`C2 — SEM linha na grade:        ${semGrade.length} (${pct(semGrade.length)})   ← meta: 0`)
  console.log(`C2 abstém (prof. fora da grade):${abstidos.length} (${pct(abstidos.length)})`)

  if (semGrade.length > 0) {
    const porProf = new Map()
    for (const r of semGrade) {
      const k = `${r.profissional_id} — ${r.profissional_nome}`
      if (!porProf.has(k)) porProf.set(k, [])
      porProf.get(k).push(r)
    }
    console.log(`\n── Vagas ofertáveis em horário sem grade aberta (${porProf.size} profissionais) ──`)
    for (const [prof, rows] of [...porProf.entries()].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`\n  ${prof}  (${rows.length} slots)`)
      for (const r of rows.sort((a, b) => `${a.data}${a.hora_inicial}`.localeCompare(`${b.data}${b.hora_inicial}`))) {
        console.log(`    ${dia(r.data)} ${String(r.dia_semana || "").slice(0, 3)} ${hhmm(r.hora_inicial)}  ${r.terapia_nome || ""}`)
      }
    }
  }

  if (abstidos.length > 0) {
    const profs = new Map()
    for (const r of abstidos) {
      const k = `${r.profissional_id} — ${r.profissional_nome}`
      profs.set(k, (profs.get(k) || 0) + 1)
    }
    console.log(`\n── C2 absteve-se: profissional sem NENHUMA linha na grade (qualquer data) ──`)
    console.log("   Ambíguo entre sync parcial da grade e profissional que não tem mais grade,")
    console.log("   então a regra não decide. Desligado já saiu pela C3. Se um nome aqui não")
    console.log("   for nenhum dos dois casos, é sinal de que falta uma regra — investigue.")
    for (const [p, n] of [...profs.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`   ${p}  (${n} slots)`)
    }
  }

  // Sinaliza no exit code para dar pra usar em conferência automatizada.
  process.exitCode = semGrade.length > 0 ? 1 : 0
}

main().catch(e => {
  console.error(`\nFalhou: ${e.message}`)
  process.exit(2)
})
