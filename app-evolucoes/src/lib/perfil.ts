import { supabase } from '@/lib/supabase';

/**
 * - `terapeuta`: a própria agenda + sessões que estiver cobrindo.
 * - `gestao`: admin e diretoria; veem as agendas de todos os profissionais.
 * - `responsavel`: agendamentos dos pacientes vinculados, nunca texto clínico.
 */
export type TipoPerfil = 'terapeuta' | 'gestao' | 'responsavel';

export type Perfil = {
  tipo: TipoPerfil;
  nome: string;
  /** Evoluir/marcar falta. Terapeuta e admin sim; diretoria não (mesma regra da Grade web). */
  podeEvoluir: boolean;
};

const TIPOS: readonly string[] = ['terapeuta', 'gestao', 'responsavel'] satisfies TipoPerfil[];

/**
 * Quem é a pessoa logada, decidido NO BANCO pela RPC `app_meu_perfil()`.
 * O app nunca deduz o papel sozinho (pelo e-mail, pelo método de login etc.).
 *
 * Devolve `null` quando a conta existe no Supabase mas não tem acesso ao app
 * (usuário do Pulsar de outro papel, celular sem responsável vinculado).
 *
 * A RPC ainda NÃO existe no banco: ver docs/app-evolucoes/PLANO_BACKEND.md.
 */
export async function buscarPerfil(): Promise<Perfil | null> {
  const { data, error } = await supabase.rpc('app_meu_perfil');
  if (error) throw error;

  const linha = Array.isArray(data) ? data[0] : data;
  if (!linha) return null;

  const { tipo, nome, pode_evoluir } = linha as { tipo?: unknown; nome?: unknown; pode_evoluir?: unknown };
  if (typeof tipo !== 'string' || !TIPOS.includes(tipo)) return null;
  return {
    tipo: tipo as TipoPerfil,
    nome: typeof nome === 'string' ? nome : '',
    podeEvoluir: pode_evoluir === true,
  };
}
