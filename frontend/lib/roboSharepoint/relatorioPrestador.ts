// "O que está nas pastas e o que falta entregar" — o PDF por prestador do
// painel "O que o robô leu" (pedido de 02/10/2026). PURO: recebe o que já foi
// lido do banco e devolve o relatório pronto para desenhar. A regra de quanto
// cada item espera é a mesma da tela PEP: STC/ETC uma por semana do mês
// (pep_semanas_esperadas / semanasEsperadas), TAP 2, TOP 1, e os semestrais
// (PIC, RT, OE) conforme o planejamento do paciente.

import { lerNomePadrao, nomesCompativeis } from './padraoNome'
import { MOTIVOS_PADRAO, nomeEsperado } from './rotulos'
import { abreviarNomePaciente } from '@/lib/remuneracao/pacientes'
import { formatCNPJ } from '@/lib/remuneracao/documento'

export type CatalogoRelatorio = {
  id: string; sigla: string; nome: string
  classe: 'recorrente' | 'semestral'
  tipo_registro: 'GERAL' | 'POR_PACIENTE'
  periodicidade: string
  qtd_referencia_mes: number | null
}

export type ArquivoRelatorio = {
  nome: string; sigla: string | null; competencia: string | null; status: string
  paciente_pasta_id: string | null
  padrao?: string | null; padrao_motivo?: string | null
}

export type PastaPaciente = { pasta_id: string; nome_pasta: string; paciente_nome: string | null; motivo: string | null }
export type RegistroRelatorio = { paciente_nome: string | null; item_id: string; competencia: string; status: string; quantidade_entregue: number | null }
export type PlanoRelatorio = { paciente_nome: string; item_id: string; competencia_planejada: string }

export type Situacao = 'completo' | 'parcial' | 'faltando' | 'previsto' | 'sem_planejamento'

export type LinhaItem = {
  sigla: string
  documento: string
  /** null nos semestrais: não é "por quantidade". */
  esperado: number | null
  naPasta: number
  falta: number
  situacao: Situacao
  nota: string
}

export type BlocoPaciente = { nome: string; reconhecido: boolean; aviso: string | null; itens: LinhaItem[] }
export type ArquivoForaDoPadrao = { arquivo: string; onde: string; motivo: string; nomeCerto: string | null }

export type Relatorio = {
  /**
   * Identificação JURÍDICA do prestador — nunca o nome da pessoa (pedido de
   * 02/10/2026, mesmo cuidado do "PDF - Apuração do Faturamento"):
   * "CNPJ 00.000.000/0000-00 – RAZÃO SOCIAL".
   */
  razaoSocial: string
  cnpj: string | null
  competencia: string
  mesRotulo: string
  temPlanilha: boolean
  geral: LinhaItem[]
  pacientes: BlocoPaciente[]
  foraDoPadrao: ArquivoForaDoPadrao[]
  totais: { esperados: number; naPasta: number; faltam: number; semestraisPendentes: number }
}

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
export const rotuloMes = (comp: string) => {
  const [a, m] = comp.split('-').map(Number)
  return `${MESES[(m || 1) - 1]}/${a}`
}
const mesBR = (comp: string) => comp.split('-').reverse().join('/')
const somaMeses = (comp: string, n: number) => {
  const [a, m] = comp.split('-').map(Number)
  const d = new Date(a, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Conta o arquivo como "no padrão"? Usa o que o banco decidiu; sem isso, a mesma regra em JS. */
function contaNoPadrao(a: ArquivoRelatorio, cat: CatalogoRelatorio | undefined, nomePasta: string | null, paciente: string | null) {
  if (a.padrao) return a.padrao === 'ok'
  const p = lerNomePadrao(a.nome, a.sigla, cat?.tipo_registro)
  if (!p.ok) return false
  if (cat?.tipo_registro === 'POR_PACIENTE') return nomesCompativeis(p.paciente, nomePasta) || nomesCompativeis(p.paciente, paciente)
  return true
}

function motivoFora(a: ArquivoRelatorio, cat: CatalogoRelatorio | undefined, nomePasta: string | null, paciente: string | null): string | null {
  if (a.padrao) {
    if (a.padrao === 'ok' || a.padrao === 'rep') return null
    return MOTIVOS_PADRAO[a.padrao_motivo ?? ''] ?? 'Nome fora do padrão'
  }
  const p = lerNomePadrao(a.nome, a.sigla, cat?.tipo_registro)
  if (p.rep) return null
  if (!p.ok) return MOTIVOS_PADRAO[p.erro ?? ''] ?? 'Nome fora do padrão'
  if (cat?.tipo_registro === 'POR_PACIENTE' && !nomesCompativeis(p.paciente, nomePasta) && !nomesCompativeis(p.paciente, paciente)) {
    return MOTIVOS_PADRAO.paciente_diferente_da_pasta
  }
  return null
}

export function montarRelatorio(input: {
  razaoSocial: string | null
  cnpj: string | null
  temPlanilha: boolean
  competencia: string
  semanas: number
  catalogo: CatalogoRelatorio[]
  pacientes: PastaPaciente[]
  arquivos: ArquivoRelatorio[]
  registros: RegistroRelatorio[]
  planos: PlanoRelatorio[]
}): Relatorio {
  const { competencia: comp, catalogo } = input
  const porSigla = new Map(catalogo.map(c => [c.sigla, c]))
  const vivos = input.arquivos.filter(a => a.status !== 'removido' && a.status !== 'revertido')
  const pastaPorId = new Map(input.pacientes.map(p => [p.pasta_id, p]))
  const foraDoPadrao: ArquivoForaDoPadrao[] = []
  const vistosFora = new Set<string>()

  const naPastaDe = (sigla: string, pastaId: string | null, so: (a: ArquivoRelatorio) => boolean) => {
    const cat = porSigla.get(sigla)
    const pasta = pastaId ? pastaPorId.get(pastaId) ?? null : null
    let n = 0
    const seqs = new Set<string>()
    for (const a of vivos) {
      if (a.sigla !== sigla || (a.paciente_pasta_id ?? null) !== pastaId || !so(a)) continue
      const motivo = motivoFora(a, cat, pasta?.nome_pasta ?? null, pasta?.paciente_nome ?? null)
      if (motivo) {
        const chave = `${pastaId}|${a.nome}`
        if (!vistosFora.has(chave)) {
          vistosFora.add(chave)
          foraDoPadrao.push({
            arquivo: a.nome,
            onde: pasta ? `${abreviarNomePaciente(pasta.paciente_nome ?? pasta.nome_pasta)} · ${cat?.nome ?? sigla}` : `Geral · ${cat?.nome ?? sigla}`,
            motivo,
            nomeCerto: nomeEsperado(sigla, pasta?.paciente_nome ?? pasta?.nome_pasta ?? null, a.competencia ?? comp),
          })
        }
        continue
      }
      if (!contaNoPadrao(a, cat, pasta?.nome_pasta ?? null, pasta?.paciente_nome ?? null)) continue
      // Repetido (mesmo sequencial / mesmo mês) conta uma vez.
      const p = lerNomePadrao(a.nome, a.sigla, cat?.tipo_registro)
      const chave = `${p.competencia ?? a.competencia}|${p.seq ?? ''}`
      if (a.padrao === 'duplicado' || seqs.has(chave)) continue
      seqs.add(chave)
      n++
    }
    return n
  }

  const registroDe = (paciente: string | null, itemId: string, so: (r: RegistroRelatorio) => boolean) =>
    input.registros.filter(r => r.item_id === itemId && (r.paciente_nome ?? null) === paciente && so(r))

  const linhaRecorrente = (cat: CatalogoRelatorio, pastaId: string | null, paciente: string | null): LinhaItem => {
    const esperado = cat.periodicidade === 'semanal' ? input.semanas : (cat.qtd_referencia_mes ?? 1)
    const naPasta = naPastaDe(cat.sigla, pastaId, a => a.competencia === comp)
    const registrado = registroDe(paciente, cat.id, r => r.competencia === comp)
      .reduce((s, r) => s + (r.quantidade_entregue ?? (r.status === 'entregue' ? 1 : 0)), 0)
    const feito = Math.min(esperado, Math.max(naPasta, registrado))
    const falta = Math.max(0, esperado - feito)
    return {
      sigla: cat.sigla, documento: cat.nome, esperado, naPasta: Math.min(naPasta, esperado), falta,
      situacao: falta === 0 ? 'completo' : feito > 0 ? 'parcial' : 'faltando',
      nota: falta === 0 ? 'Completo no mês' : `Falta${falta > 1 ? 'm' : ''} ${falta} de ${esperado}`,
    }
  }

  const linhaSemestral = (cat: CatalogoRelatorio, pastaId: string | null, paciente: string | null): LinhaItem => {
    const plano = paciente ? input.planos.find(p => p.paciente_nome === paciente && p.item_id === cat.id) : undefined
    const base = { sigla: cat.sigla, documento: cat.nome, esperado: null }
    if (!plano) {
      const naPasta = naPastaDe(cat.sigla, pastaId, () => true)
      return { ...base, naPasta, falta: 0, situacao: 'sem_planejamento', nota: 'Sem planejamento semestral (o RP precisa planejar)' }
    }
    const inicio = somaMeses(plano.competencia_planejada, -5)
    const naPasta = naPastaDe(cat.sigla, pastaId, a => !!a.competencia && a.competencia >= inicio)
    const entregue = naPasta > 0 || registroDe(paciente, cat.id, r => r.status === 'entregue' && r.competencia >= inicio).length > 0
    if (entregue) return { ...base, naPasta, falta: 0, situacao: 'completo', nota: 'Entregue neste ciclo' }
    if (plano.competencia_planejada <= comp) {
      return { ...base, naPasta: 0, falta: 1, situacao: 'faltando',
        nota: plano.competencia_planejada < comp ? `Vencido desde ${mesBR(plano.competencia_planejada)}` : `Vence neste mês (${mesBR(plano.competencia_planejada)})` }
    }
    return { ...base, naPasta: 0, falta: 0, situacao: 'previsto', nota: `Previsto para ${mesBR(plano.competencia_planejada)}` }
  }

  const recGeral = catalogo.filter(c => c.classe === 'recorrente' && c.tipo_registro === 'GERAL')
  const recPac = catalogo.filter(c => c.classe === 'recorrente' && c.tipo_registro === 'POR_PACIENTE')
  const sem = catalogo.filter(c => c.classe === 'semestral')

  const geral = recGeral.map(c => linhaRecorrente(c, null, null))
  const pacientes: BlocoPaciente[] = [...input.pacientes]
    .sort((a, b) => (a.paciente_nome ?? a.nome_pasta).localeCompare(b.paciente_nome ?? b.nome_pasta))
    .map(p => ({
      // Abreviado, como no PDF de faturamento: "Joao S. S.".
      nome: abreviarNomePaciente(p.paciente_nome ?? p.nome_pasta) ?? p.nome_pasta,
      reconhecido: !!p.paciente_nome,
      aviso: p.paciente_nome ? null : 'Pasta ainda não ligada a um paciente do Pulsar: os números vêm só do que está na pasta.',
      itens: [...recPac.map(c => linhaRecorrente(c, p.pasta_id, p.paciente_nome)), ...sem.map(c => linhaSemestral(c, p.pasta_id, p.paciente_nome))],
    }))

  const todas = [...geral, ...pacientes.flatMap(p => p.itens)]
  const recorrentes = todas.filter(l => l.esperado !== null)
  return {
    razaoSocial: (input.razaoSocial ?? 'RAZÃO SOCIAL NÃO INFORMADA NA PLANILHA').toLocaleUpperCase('pt-BR'),
    cnpj: formatCNPJ(input.cnpj) || null,
    competencia: comp,
    mesRotulo: rotuloMes(comp),
    temPlanilha: input.temPlanilha,
    geral,
    pacientes,
    foraDoPadrao,
    totais: {
      esperados: recorrentes.reduce((s, l) => s + (l.esperado ?? 0), 0) + todas.filter(l => l.esperado === null && l.situacao === 'faltando').length,
      naPasta: recorrentes.reduce((s, l) => s + Math.min(l.naPasta, l.esperado ?? 0), 0),
      faltam: todas.reduce((s, l) => s + l.falta, 0),
      semestraisPendentes: todas.filter(l => l.esperado === null && l.situacao === 'faltando').length,
    },
  }
}
