import { getSupabaseClient } from '@/lib/supabase/client'
import { getCatalogoItens } from '@/services/pep.service'
import { getCalendarioCompetencia } from '@/services/pepCalendario.service'
import { getFeriados } from '@/services/feriados.service'
import { semanasEsperadas } from '@/lib/remuneracao/semanasCompetencia'
import { nomeCurtoPrestador } from '@/lib/roboSharepoint/rotulos'
import {
  montarRelatorio, type ArquivoRelatorio, type CatalogoRelatorio, type PastaPaciente, type PlanoRelatorio,
  type RegistroRelatorio, type Relatorio,
} from '@/lib/roboSharepoint/relatorioPrestador'

// Lê o que o PDF por prestador precisa e monta o relatório
// (lib/roboSharepoint/relatorioPrestador.ts). Só leitura. Funciona com ou sem
// a migration 20261002100000: sem ela, sp_pep_itens não tem `padrao` e o
// relatório confere o nome pela mesma regra em JS (padraoNome.ts).

const faltaColuna = (e: unknown) => {
  const x = e as { code?: string } | null
  return !!x && (x.code === '42703' || x.code === 'PGRST204')
}

export function competenciaAtual(): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(new Date())
  return `${p.find(x => x.type === 'year')!.value}-${p.find(x => x.type === 'month')!.value}`
}

export async function carregarRelatorioPrestador(prestadorPastaId: string, nomePasta: string, competencia: string): Promise<Relatorio> {
  const sb = getSupabaseClient()

  const [prest, pacs, catalogoRes, calendario, feriados] = await Promise.all([
    sb.from('sp_pep_prestadores').select('prestador_nome, planilha_sp_id, razao_social_planilha').eq('pasta_id', prestadorPastaId).maybeSingle(),
    sb.from('sp_pep_pacientes').select('pasta_id, paciente_nome, motivo').eq('prestador_pasta_id', prestadorPastaId),
    getCatalogoItens(),
    getCalendarioCompetencia(competencia),
    getFeriados(),
  ])
  if (prest.error) throw prest.error
  if (pacs.error) throw pacs.error

  // Arquivos: com padrao/padrao_motivo quando a coluna existe.
  const lerArquivos = (comPadrao: boolean) => sb.from('sp_pep_itens')
    .select(comPadrao ? 'nome, sigla, competencia, status, paciente_pasta_id, padrao, padrao_motivo' : 'nome, sigla, competencia, status, paciente_pasta_id')
    .eq('prestador_pasta_id', prestadorPastaId)
    .eq('tipo', 'evidencia')
    .limit(2000)
  let arq = await lerArquivos(true)
  if (arq.error && faltaColuna(arq.error)) arq = await lerArquivos(false)
  if (arq.error) throw arq.error

  const idsPasta = (pacs.data ?? []).map(p => p.pasta_id as string)
  const nomesPasta = new Map<string, string>()
  if (idsPasta.length) {
    const { data } = await sb.from('sp_pep_pastas').select('id, nome').in('id', idsPasta)
    for (const p of data ?? []) nomesPasta.set(p.id as string, p.nome as string)
  }
  const pacientes: PastaPaciente[] = (pacs.data ?? []).map(p => ({
    pasta_id: p.pasta_id as string,
    nome_pasta: nomesPasta.get(p.pasta_id as string) ?? '(pasta)',
    paciente_nome: (p.paciente_nome as string | null) ?? null,
    motivo: (p.motivo as string | null) ?? null,
  }))
  const nomesPacientes = pacientes.map(p => p.paciente_nome).filter((n): n is string => !!n)
  const prestadorNome = (prest.data?.prestador_nome as string | null) ?? null

  // Entregas registradas: as do prestador no mês (recorrentes, Geral) e as
  // semestrais dos pacientes (seguem o paciente se ele trocou de analista).
  const campos = 'paciente_nome, item_id, competencia, status, quantidade_entregue'
  const [regPrest, regPac, planos] = await Promise.all([
    prestadorNome ? sb.from('pep_registros_entrega').select(campos).eq('prestador_nome', prestadorNome).eq('competencia', competencia) : Promise.resolve({ data: [], error: null }),
    nomesPacientes.length ? sb.from('pep_registros_entrega').select(campos).in('paciente_nome', nomesPacientes) : Promise.resolve({ data: [], error: null }),
    nomesPacientes.length ? sb.from('pep_planejamento_semestral').select('paciente_nome, item_id, competencia_planejada').in('paciente_nome', nomesPacientes).eq('ativo', true) : Promise.resolve({ data: [], error: null }),
  ])
  const vistos = new Set<string>()
  const registros: RegistroRelatorio[] = []
  for (const r of [...(regPrest.data ?? []), ...(regPac.data ?? [])] as RegistroRelatorio[]) {
    const k = `${r.paciente_nome}|${r.item_id}|${r.competencia}`
    if (!vistos.has(k)) { vistos.add(k); registros.push(r) }
  }

  const semanas = calendario.data?.semanas_supervisao_estudo ?? semanasEsperadas(competencia, feriados.data ?? [])

  return montarRelatorio({
    nomePasta: nomeCurtoPrestador(nomePasta),
    prestadorNome: prestadorNome ? nomeCurtoPrestador(nomePasta) : null,
    razaoSocial: (prest.data?.razao_social_planilha as string | null) ?? (/\(([^()]+)\)\s*$/.exec(nomePasta)?.[1] ?? null),
    temPlanilha: !!prest.data?.planilha_sp_id,
    competencia,
    semanas,
    catalogo: (catalogoRes.data ?? []).filter(c => c.ativo) as unknown as CatalogoRelatorio[],
    pacientes,
    arquivos: (arq.data ?? []) as unknown as ArquivoRelatorio[],
    registros,
    planos: (planos.data ?? []) as PlanoRelatorio[],
  })
}
