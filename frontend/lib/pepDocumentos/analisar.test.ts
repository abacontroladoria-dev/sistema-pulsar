import { beforeEach, describe, expect, test, vi } from 'vitest'

// O orquestrador de ponta a ponta, contra um banco em memória que imita as
// chamadas do supabase-js que ele usa. A IA é simulada (vi.mock).

vi.mock('./ia', () => ({
  temRegua: (s: string) => ['OE', 'ETC', 'PIC'].includes((s ?? '').toUpperCase()),
  lerDocumentoComIA: vi.fn(async () => ({
    achados: [{ codigo: 'ia', familia: 'qualidade', nivel: 'atencao', origem: 'ia', titulo: 'Texto genérico' }],
    resumo: 'ok', modelo: 'gpt-teste', regua: 'OE@2026-10-14',
  })),
}))

import { analisarDocumentosPep } from './analisar'
import { lerDocumentoComIA } from './ia'

type Linha = Record<string, unknown>
type Tabelas = Record<string, Linha[]>

/** Banco falso: só o que analisar.ts chama. */
function bancoFalso(t: Tabelas) {
  const rpc = vi.fn(async (nome: string, args: { p_sp_ids: string[] }) => {
    // Mesma regra da sp_pep_documentos_consolidar.
    for (const d of t.sp_pep_documentos.filter(x => args.p_sp_ids.includes(x.sp_id as string))) {
      const pares = t.sp_pep_documentos_semelhancas.filter(p => (p.a_sp_id === d.sp_id || p.b_sp_id === d.sp_id) && p.revisao_status !== 'falso_positivo')
      const achados = d.achados as { nivel: string }[]
      d.veredito = d.extracao_status !== 'ok' ? 'ilegivel'
        : d.analise_status !== 'concluida' ? null
        : pares.some(p => p.nivel === 'errado') || achados.some(a => a.nivel === 'errado') ? 'errado'
        : pares.length || achados.length || (d.ia_achados as unknown[]).length ? 'pode_conter_erros' : 'bom'
    }
    return { data: null, error: null, nome }
  })
  function from(tabela: string) {
    const filtros: ((l: Linha) => boolean)[] = []
    let embed = false
    let acao: { tipo: 'select' | 'update' | 'delete' | 'upsert'; valor?: unknown } = { tipo: 'select' }
    let lim = Infinity
    const q = {
      select(cols: string) { embed = cols.includes('sp_pep_itens!inner'); return q },
      update(v: Linha) { acao = { tipo: 'update', valor: v }; return q },
      delete() { acao = { tipo: 'delete' }; return q },
      upsert(rows: Linha[]) {
        for (const r of rows) {
          const i = t[tabela].findIndex(x => x.a_sp_id === r.a_sp_id && x.b_sp_id === r.b_sp_id)
          if (i >= 0) Object.assign(t[tabela][i], r); else t[tabela].push({ revisao_status: 'pendente', ...r })
        }
        return Promise.resolve({ data: null, error: null })
      },
      eq(c: string, v: unknown) { filtros.push(l => l[c] === v); return q },
      in(c: string, v: unknown[]) { filtros.push(l => v.includes(l[c])); return q },
      is(c: string) { if (c === 'sp_pep_itens.removido_em') filtros.push(l => !itemDe(l.sp_id as string)?.removido_em); return q },
      order() { return q },
      limit(n: number) { lim = n; return q },
      or(expr: string) {
        if (expr.startsWith('analise_status.eq.pendente')) filtros.push(l => l.analise_status === 'pendente' || (l.ia_status === 'erro' && (l.ia_tentativas as number) < 3))
        else { const id = expr.match(/a_sp_id\.eq\.([^,]+)/)![1]; filtros.push(l => l.a_sp_id === id || l.b_sp_id === id) }
        return q
      },
      maybeSingle() { return q.then(r => ({ ...r, data: r.data[0] ?? null })) },
      then<T>(res: (r: { data: Linha[]; error: null }) => T) {
        const linhas = t[tabela].filter(l => filtros.every(f => f(l)))
        if (acao.tipo === 'update') { linhas.forEach(l => Object.assign(l, acao.valor)); return Promise.resolve(res({ data: [], error: null })) }
        if (acao.tipo === 'delete') { t[tabela] = t[tabela].filter(l => !linhas.includes(l)); return Promise.resolve(res({ data: [], error: null })) }
        const data = linhas.slice(0, lim).map(l => (embed ? { ...l, sp_pep_itens: itemDe(l.sp_id as string) } : { ...l }))
        return Promise.resolve(res({ data, error: null }))
      },
    }
    return q
  }
  const itemDe = (id: string) => t.sp_pep_itens.find(i => i.sp_id === id)
  return { from, rpc } as unknown as Parameters<typeof analisarDocumentosPep>[0] & { rpc: typeof rpc }
}

const OE_BOM = `ORIENTAÇÃO ESCOLAR
Data do registro: 15/09/2026
Horário: 14h00 às 15h00
Paciente: João Pedro Silva
Psicóloga responsável: Maria Souza Lima
Representante da escola: Ana Paula Costa
Cargo: Coordenadora pedagógica
Foi apresentado à coordenação o plano de manejo de comportamentos de fuga durante a transição do recreio para a sala, com antecipação visual e reforço diferencial, e combinado o registro diário em folha de frequência com nova conversa em outubro.`

function docPendente(sp_id: string, sha: string): Linha {
  return { sp_id, sha256: sha, extracao_status: 'ok', analise_status: 'pendente', analise_tentativas: 0, ia_status: 'pendente', ia_tentativas: 0,
    extraido_em: '2026-10-14', achados: [], ia_achados: [], assinatura: null, veredito: null }
}
function item(sp_id: string, paciente: string, pasta: string, sigla = 'OE'): Linha {
  return { sp_id, nome: `${sigla}-${paciente}-092026.docx`, sigla, competencia: '2026-09', prestador_nome: 'Maria Souza Lima',
    prestador_pasta_id: 'P1', paciente_nome: paciente, paciente_pasta_id: pasta, padrao: 'ok', removido_em: null, tipo: 'evidencia' }
}

let t: Tabelas
beforeEach(() => {
  vi.mocked(lerDocumentoComIA).mockClear()
  t = {
    sp_pep_documentos: [docPendente('A', 'h1'), docPendente('B', 'h2'), docPendente('C', 'h3')],
    sp_pep_documentos_texto: [
      { sp_id: 'A', texto: OE_BOM },
      // Cópia do de João, com o nome do Lucas: o caso do print da auditoria.
      { sp_id: 'B', texto: OE_BOM.replace(/João Pedro Silva/g, 'Lucas Andrade Rocha') },
      // Outro paciente citado no lugar do dono da pasta.
      { sp_id: 'C', texto: OE_BOM.replace('Paciente: João Pedro Silva', 'Paciente: Lucas Andrade Rocha') },
    ],
    sp_pep_itens: [item('A', 'João Pedro Silva', 'X1'), item('B', 'Lucas Andrade Rocha', 'X2'), item('C', 'Ana Clara Dias', 'X3')],
    pep_catalogo_itens: [{ sigla: 'OE', tipo_registro: 'POR_PACIENTE', ativo: true }],
    sp_pep_pastas: [
      { id: 'X1', nome: 'João Pedro', prestador_pasta_id: 'P1', papel: 'paciente' },
      { id: 'X2', nome: 'Lucas Andrade', prestador_pasta_id: 'P1', papel: 'paciente' },
      { id: 'X3', nome: 'Ana Clara', prestador_pasta_id: 'P1', papel: 'paciente' },
    ],
    sp_pep_documentos_semelhancas: [],
  }
})

describe('analisarDocumentosPep', () => {
  test('analisa, compara e dá a indicação de cada documento', async () => {
    const db = bancoFalso(t)
    const r = await analisarDocumentosPep(db, { orcamentoMs: 30_000 })
    expect(r).toMatchObject({ analisados: 3, falhas: 0, ia: 3 })
    const doc = Object.fromEntries(t.sp_pep_documentos.map(d => [d.sp_id, d]))
    // Todos com impressão digital e IA registrada.
    expect(doc.A.analise_status).toBe('concluida')
    expect((doc.A.assinatura as number[]).length).toBe(128)
    expect(doc.A.ia_modelo).toBe('gpt-teste')
    // A e B são o mesmo texto com o nome trocado: par "errado" entre pacientes.
    const par = t.sp_pep_documentos_semelhancas.find(p => p.a_sp_id === 'A' && p.b_sp_id === 'B')
    expect(par).toMatchObject({ tipo: 'parecido', relacao: 'outro_paciente', nivel: 'errado' })
    expect(doc.A.veredito).toBe('errado')
    expect(doc.B.veredito).toBe('errado')
    // C cita outro paciente no campo Paciente: errado pela regra fixa.
    expect((doc.C.achados as { codigo: string }[]).map(a => a.codigo)).toContain('paciente_diferente')
    expect(db.rpc).toHaveBeenCalledWith('sp_pep_documentos_consolidar', expect.anything())
  })

  test('sem régua (STC): não chama a IA', async () => {
    t.sp_pep_itens = t.sp_pep_itens.map(i => ({ ...i, sigla: 'STC' }))
    t.pep_catalogo_itens = [{ sigla: 'STC', tipo_registro: 'GERAL', ativo: true }]
    await analisarDocumentosPep(bancoFalso(t), {})
    expect(lerDocumentoComIA).not.toHaveBeenCalled()
    expect(t.sp_pep_documentos.every(d => d.ia_status === 'nao_se_aplica')).toBe(true)
  })

  test('falha da IA não perde as conferências fixas', async () => {
    vi.mocked(lerDocumentoComIA).mockRejectedValue(new Error('IA: OpenAI respondeu 500'))
    await analisarDocumentosPep(bancoFalso(t), {})
    const c = t.sp_pep_documentos.find(d => d.sp_id === 'C')!
    expect(c).toMatchObject({ analise_status: 'concluida', ia_status: 'erro', ia_tentativas: 1, veredito: 'errado' })
  })

  test('texto expirado: erro registrado, sem inventar indicação', async () => {
    t.sp_pep_documentos_texto = []
    const r = await analisarDocumentosPep(bancoFalso(t), {})
    expect(r.falhas).toBe(3)
    expect(t.sp_pep_documentos.every(d => d.analise_status === 'erro' && d.veredito === null)).toBe(true)
  })

  test('só os pedidos (spIds)', async () => {
    const r = await analisarDocumentosPep(bancoFalso(t), { spIds: ['C'] })
    expect(r.analisados).toBe(1)
    expect(t.sp_pep_documentos.find(d => d.sp_id === 'A')!.analise_status).toBe('pendente')
  })
})
