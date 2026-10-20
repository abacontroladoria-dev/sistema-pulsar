import type { SessaoAgenda } from '@/lib/agenda';

/**
 * Status de evolução da sessão — mesma regra de
 * frontend/lib/grade/evolucaoStatus.ts (Grade web), para app e web mostrarem a
 * mesma cor. Diferença só no relógio: aqui Brasília é UTC−3 fixo (sem horário de
 * verão desde 2019) em vez de Intl com timeZone, que o Hermes não garante igual
 * em todo aparelho.
 */
export type CodigoStatus = 'futuro' | 'sem_registro_passado' | 'evoluido' | 'cancelado' | 'inconsistencia';

export type InfoStatus = {
  codigo: CodigoStatus;
  rotulo: string;
  descricaoCurta: string;
};

const OFFSET_BRASILIA_MS = -3 * 60 * 60 * 1000;

/** Data ("AAAA-MM-DD") e hora ("HH:MM") de agora em Brasília. */
export function agoraBrasilia(agora: Date = new Date()): { data: string; hhmm: string } {
  const br = new Date(agora.getTime() + OFFSET_BRASILIA_MS);
  const iso = br.toISOString(); // em UTC = horário de Brasília deslocado
  return { data: iso.slice(0, 10), hhmm: iso.slice(11, 16) };
}

/** Soma dias a "AAAA-MM-DD" (sem fuso: aritmética de calendário). */
export function somarDias(dataIso: string, dias: number): string {
  const [a, m, d] = dataIso.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d + dias));
  return dt.toISOString().slice(0, 10);
}

const DIAS_SEMANA_LONGOS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** "AAAA-MM-DD" → { semana: "Segunda", data: "19 de outubro" }. */
export function formatarDiaLongo(dataIso: string): { semana: string; data: string } {
  const [a, m, d] = dataIso.split('-').map(Number);
  return {
    semana: DIAS_SEMANA_LONGOS[new Date(Date.UTC(a, m - 1, d)).getUTCDay()],
    data: `${d} de ${MESES[m - 1]}`,
  };
}

export function horario(sessao: Pick<SessaoAgenda, 'hora_inicio' | 'hora_fim'>): string {
  return `${sessao.hora_inicio.slice(0, 5)} às ${sessao.hora_fim.slice(0, 5)}`;
}

/** Regra do web: 10:00 agendado → azul até 10:00, amarelo a partir de 10:01. */
export function sessaoJaPassou(dataSessao: string, horaInicio: string, agora: Date = new Date()): boolean {
  const { data: hoje, hhmm } = agoraBrasilia(agora);
  if (dataSessao < hoje) return true;
  if (dataSessao > hoje) return false;
  return hhmm > (horaInicio || '00:00').slice(0, 5);
}

/**
 * Inconsistência (recepção marcou falta + houve evolução) só para admin; os
 * demais veem só que a recepção registrou falta.
 */
export function statusDaSessao(sessao: SessaoAgenda, ehAdmin: boolean, agora: Date = new Date()): InfoStatus {
  const statusExec = (sessao.status_execucao ?? '').toLowerCase();
  const ehCancelado = statusExec.includes('cancel') || statusExec === 'falta' || !!sessao.tipo_falta;

  if (sessao.falta_recepcao && sessao.possui_tratativa) {
    return ehAdmin
      ? {
          codigo: 'inconsistencia',
          rotulo: 'Inconsistência',
          descricaoCurta: 'A recepção marcou falta, mas há evolução registrada.',
        }
      : {
          codigo: 'cancelado',
          rotulo: 'Falta informada pela recepção',
          descricaoCurta: 'A recepção registrou falta nesta sessão.',
        };
  }

  if (sessao.possui_tratativa) {
    return {
      codigo: 'evoluido',
      rotulo: 'Evoluído',
      descricaoCurta: sessao.tratativa_profissional_nome
        ? `Realizado por ${sessao.tratativa_profissional_nome}`
        : 'Atendimento evoluído',
    };
  }

  if (ehCancelado || sessao.falta_recepcao) {
    if (sessao.falta_recepcao && !sessao.registrado) {
      return {
        codigo: 'cancelado',
        rotulo: 'Falta informada pela recepção',
        descricaoCurta: 'A recepção registrou falta nesta sessão.',
      };
    }
    const tipo =
      sessao.tipo_falta === 'terapeuta'
        ? 'Falta do profissional'
        : sessao.tipo_falta === 'paciente'
          ? 'Falta do paciente'
          : 'Agendamento cancelado (falta)';
    return { codigo: 'cancelado', rotulo: tipo, descricaoCurta: tipo };
  }

  if (sessaoJaPassou(sessao.data, sessao.hora_inicio, agora)) {
    return {
      codigo: 'sem_registro_passado',
      rotulo: 'Sem registro',
      descricaoCurta: 'Falta registrar a evolução ou a falta.',
    };
  }

  return {
    codigo: 'futuro',
    rotulo: 'Agendada',
    descricaoCurta: `Começa às ${(sessao.hora_inicio || '').slice(0, 5)}.`,
  };
}

/** Cores da Grade web (sky-600, amber-500, emerald-600, rose-600, violet-600): o ponto do selo. */
export const COR_STATUS: Record<CodigoStatus, string> = {
  futuro: '#0284C7',
  sem_registro_passado: '#F59E0B',
  evoluido: '#059669',
  cancelado: '#E11D48',
  inconsistencia: '#7C3AED',
};

/**
 * Selo no padrão do Pulsar (DESIGN.md, correção de contraste de 19/08): fundo
 * -100 e texto -700 (-800 no âmbar, que no -700 fica abaixo de 4,5:1 nesse
 * fundo); no escuro, o tom translúcido e texto -300.
 */
export const SELO_STATUS: Record<CodigoStatus, { claro: { fundo: string; texto: string }; escuro: { fundo: string; texto: string } }> = {
  futuro: { claro: { fundo: '#e0f2fe', texto: '#0369a1' }, escuro: { fundo: 'rgba(2, 132, 199, 0.18)', texto: '#7dd3fc' } },
  sem_registro_passado: { claro: { fundo: '#fef3c7', texto: '#92400e' }, escuro: { fundo: 'rgba(245, 158, 11, 0.16)', texto: '#fcd34d' } },
  evoluido: { claro: { fundo: '#d1fae5', texto: '#047857' }, escuro: { fundo: 'rgba(5, 150, 105, 0.18)', texto: '#6ee7b7' } },
  cancelado: { claro: { fundo: '#ffe4e6', texto: '#be123c' }, escuro: { fundo: 'rgba(225, 29, 72, 0.18)', texto: '#fda4af' } },
  inconsistencia: { claro: { fundo: '#ede9fe', texto: '#6d28d9' }, escuro: { fundo: 'rgba(124, 58, 237, 0.2)', texto: '#c4b5fd' } },
};
