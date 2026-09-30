import { getSupabaseClient } from '@/lib/supabase/client'

// Par de teste da homologação do robô SharePoint (plano, etapa 5).
//
// O Pulsar esconde de propósito "Profissional Teste…" e "Paciente Teste…"
// (PROFS_IGNORAR e isFakePatient em lib/remuneracao) para não sujar
// remuneração, receita e indicadores. Isso continua valendo. Só a tela PEP,
// com o interruptor de modo teste (visível para admin), busca estas sessões
// DIRETO da Grade — sem passar pelo cálculo compartilhado — e as mostra.
//
// Os nomes são os que vão ser cadastrados no TiTa. `vw_grade_base` só corta
// 'Profissional Teste' EXATO (20260807110000), então "Profissional Teste Robô
// PEP" passa pela view; quem o esconde do resto do sistema é o filtro do TS.

export const PROF_TESTE_PREFIXO = 'Profissional Teste Robô PEP'

export type AnalistaTeste = { nome: string; pacientes: string[] }

export async function carregarAnalistasDeTeste(competencia: string): Promise<AnalistaTeste[]> {
  const [ano, mes] = competencia.split('-').map(Number)
  if (!ano || !mes) return []
  const de = `${competencia}-01`
  const fim = new Date(Date.UTC(ano, mes, 0)).toISOString().slice(0, 10)

  const { data, error } = await getSupabaseClient()
    .from('vw_grade_base')
    .select('profissional_nome, paciente_nome')
    .eq('unidade_id', 280)
    .eq('terapia_nome', 'Coordenador de Caso')
    .ilike('profissional_nome', `${PROF_TESTE_PREFIXO}%`)
    .gte('data', de)
    .lte('data', fim)
    .limit(500)
  if (error || !data) return []

  const porProf = new Map<string, Set<string>>()
  for (const r of data) {
    if (!r.profissional_nome || !r.paciente_nome) continue
    if (!porProf.has(r.profissional_nome)) porProf.set(r.profissional_nome, new Set())
    porProf.get(r.profissional_nome)!.add(r.paciente_nome)
  }
  return [...porProf.entries()].map(([nome, p]) => ({ nome, pacientes: [...p].sort() }))
}

export const ehProfissionalDeTeste = (nome: string) => nome.startsWith(PROF_TESTE_PREFIXO)
