import type { PostgrestError } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

/** Linha de app_agenda() (20261019210000). Nunca traz o texto da evolução. */
export type SessaoAgenda = {
  agendamento_id: string;
  data: string; // AAAA-MM-DD
  hora_inicio: string; // HH:MM:SS
  hora_fim: string;
  paciente_nome: string;
  terapia_nome: string;
  sala_nome: string | null;
  unidade_nome: string | null;
  profissional_id: number;
  profissional_nome: string;
  cobertura_profissional_id: number | null;
  cobertura_profissional_nome: string | null;
  /** O profissional consultado é quem atende (o da cobertura, se houver). */
  efetivo: boolean;
  registrado: boolean;
  status_execucao: string | null;
  tipo_falta: string | null;
  possui_tratativa: boolean;
  tratativa_profissional_nome: string | null;
  tratativa_criada_em: string | null;
  falta_recepcao: boolean;
};

/** grade_detalhe_evolucao(): o texto vem nulo para quem não pode evoluir a sessão. */
export type DetalheEvolucao = {
  registrado: boolean;
  status_execucao: string | null;
  tipo_falta: string | null;
  possui_tratativa: boolean;
  descricao_evolucao: string | null;
  tratativa_profissional_nome: string | null;
  tratativa_criada_em_brasilia: string | null;
  registrado_por_nome: string | null;
  atualizado_em_brasilia: string | null;
  substituicao: boolean;
  falta_recepcao: boolean;
  inconsistencia: boolean;
};

export type ProfissionalApp = { id: number; nome: string };

/**
 * Erro do banco → frase para a tela. As RPCs da Grade já falam português nas
 * regras de negócio (42501 sem permissão, 22023 dado inválido, P0002 não achou);
 * o resto vira mensagem genérica.
 */
export function mensagemErroBanco(erro: unknown): string {
  const e = erro as Partial<PostgrestError> | null;
  if (e?.code && ['42501', '22023', 'P0002'].includes(e.code) && e.message) return e.message;
  return 'Não foi possível concluir. Verifique a internet e tente de novo.';
}

export async function buscarAgenda(de: string, ate: string, profissionalId?: number): Promise<SessaoAgenda[]> {
  const { data, error } = await supabase.rpc('app_agenda', {
    p_de: de,
    p_ate: ate,
    p_profissional_id: profissionalId ?? null,
  });
  if (error) throw error;
  return (data ?? []) as SessaoAgenda[];
}

export async function buscarProfissionaisApp(): Promise<ProfissionalApp[]> {
  const { data, error } = await supabase.rpc('app_agenda_profissionais');
  if (error) throw error;
  return (data ?? []) as ProfissionalApp[];
}

export async function buscarDetalheEvolucao(agendamentoId: string): Promise<DetalheEvolucao> {
  const { data, error } = await supabase.rpc('grade_detalhe_evolucao', { p_agendamento_id: agendamentoId });
  if (error) throw error;
  return data as DetalheEvolucao;
}

export async function registrarEvolucao(agendamentoId: string, descricao: string): Promise<void> {
  const { error } = await supabase.rpc('grade_registrar_evolucao', {
    p_agendamento_id: agendamentoId,
    p_descricao: descricao,
  });
  if (error) throw error;
}

export async function registrarFalta(agendamentoId: string, tipo: 'paciente' | 'terapeuta'): Promise<void> {
  const { error } = await supabase.rpc('grade_registrar_falta', {
    p_agendamento_id: agendamentoId,
    p_tipo_falta: tipo,
  });
  if (error) throw error;
}
