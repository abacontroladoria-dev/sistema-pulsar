/**
 * Modelo de severidade da Central de Operações Clínicas.
 *
 * Em vez de pintar cada `status_operacional` com uma cor própria (ruído visual),
 * mapeamos cada status a UMA de quatro severidades. Cor = exceção: num dia
 * saudável a tela fica quase toda neutra, e o olho vai direto ao que precisa de
 * ação. Esta é a fonte única de verdade para rótulo, cor e ícone — StatusBadge,
 * AttendanceCard, a triagem da lista e os chips do cabeçalho consomem daqui.
 */

import {
  CheckCircle2,
  Clock3,
  Loader2,
  AlertTriangle,
  Ban,
  UserMinus,
  UserX,
  CalendarX,
  type LucideIcon,
} from 'lucide-react'

export type Severidade = 'resolvido' | 'andamento' | 'atencao' | 'critico'

export interface StatusToken {
  /** chave canônica do status_operacional */
  key: string
  /** palavra exibida ao coordenador */
  label: string
  severidade: Severidade
  icon: LucideIcon
  /** anima o ícone (estados transitórios) */
  spin?: boolean
}

/** Severidade → paleta. Quatro cores + tinta, sem roxo. */
export const SEVERIDADE_UI: Record<
  Severidade,
  {
    /** cor sólida do "dot" / barra do pulse */
    solid: string
    /** texto da palavra de status */
    text: string
    /** preenchimento suave do chip/badge */
    soft: string
    /** borda do chip/badge */
    softBorder: string
    /** espinha lateral do card (loud) */
    spine: string
    /** rank para ordenar exceções (maior = mais urgente) */
    rank: number
    /** entra no bloco "Precisa de atenção" */
    exige_acao: boolean
  }
> = {
  critico: {
    solid: 'bg-rose-500',
    text: 'text-rose-700',
    soft: 'bg-rose-50',
    softBorder: 'border-rose-200',
    spine: 'bg-rose-500',
    rank: 3,
    exige_acao: true,
  },
  atencao: {
    solid: 'bg-amber-500',
    text: 'text-amber-700',
    soft: 'bg-amber-50',
    softBorder: 'border-amber-200',
    spine: 'bg-amber-400',
    rank: 2,
    exige_acao: true,
  },
  andamento: {
    solid: 'bg-slate-300',
    text: 'text-slate-500',
    soft: 'bg-slate-100',
    softBorder: 'border-slate-200',
    spine: 'bg-transparent',
    rank: 1,
    exige_acao: false,
  },
  resolvido: {
    solid: 'bg-emerald-500',
    text: 'text-emerald-700',
    soft: 'bg-emerald-50',
    softBorder: 'border-emerald-200',
    spine: 'bg-transparent',
    rank: 0,
    exige_acao: false,
  },
}

const TOKENS: Record<string, StatusToken> = {
  autorizado: {
    key: 'autorizado',
    label: 'Autorizado',
    severidade: 'resolvido',
    icon: CheckCircle2,
  },
  concluido: {
    key: 'autorizado',
    label: 'Autorizado',
    severidade: 'resolvido',
    icon: CheckCircle2,
  },
  presenca_confirmada: {
    key: 'presenca_confirmada',
    label: 'Presença confirmada',
    severidade: 'andamento',
    icon: CheckCircle2,
  },
  processando: {
    key: 'processando',
    label: 'Processando',
    severidade: 'andamento',
    icon: Loader2,
    spin: true,
  },
  executando: {
    key: 'processando',
    label: 'Processando',
    severidade: 'andamento',
    icon: Loader2,
    spin: true,
  },
  pendente: {
    key: 'pendente',
    label: 'Pendente',
    severidade: 'andamento',
    icon: Clock3,
  },
  concluido_sem_guia: {
    key: 'concluido_sem_guia',
    label: 'Aguardando guia',
    severidade: 'andamento',
    icon: Clock3,
  },
  falta_paciente: {
    key: 'falta_paciente',
    label: 'Falta do paciente',
    severidade: 'atencao',
    icon: UserMinus,
  },
  falta: {
    key: 'falta_paciente',
    label: 'Falta do paciente',
    severidade: 'atencao',
    icon: UserMinus,
  },
  falta_terapeuta: {
    key: 'falta_terapeuta',
    label: 'Falta do terapeuta',
    severidade: 'critico',
    icon: UserX,
  },
  // A clínica não abriu: feriado, ponto facultativo, falta de energia.
  //
  // Não é falta de ninguém, e por isso não é 'atencao' — não há tratativa a
  // fazer, ninguém deixou de comparecer. Severidade 'resolvido' mantém a sessão
  // fora do bloco "Precisa de atenção", que é justamente o ponto: a recepção não
  // deve ser cobrada todo dia por um dia em que não houve atendimento.
  //
  // Chega aqui por `tipo_falta = 'unidade'`, não por status_operacional — o CASE
  // do banco ainda não tem o ramo 'falta_unidade' (ver o TODO em
  // 20260908100200_falta_da_unidade_fora_da_assiduidade.sql).
  falta_unidade: {
    key: 'falta_unidade',
    label: 'Unidade fechada',
    severidade: 'resolvido',
    icon: CalendarX,
  },
  erro: {
    key: 'erro',
    label: 'Sem autorização',
    severidade: 'critico',
    icon: AlertTriangle,
  },
  // Ícone próprio, e não o triângulo do 'erro', porque as duas coisas pedem
  // ações opostas: 'erro' é o robô que não terminou (refazer); 'glosa' é a ASSIM
  // que respondeu recusando (contestar). Sem este token a sessão caía no
  // FALLBACK e aparecia como a palavra crua "glosa" pintada de pendente.
  glosa: {
    key: 'glosa',
    label: 'Glosa',
    severidade: 'critico',
    icon: Ban,
  },
  // A recusa aconteceu E uma autorização externa passou a cobrir a sessão (aba
  // Reconciliação). Não pede nada: existe guia liberada. Mesma palavra da
  // Auditoria (SITUACAO_CONFIG.GLOSA_RESOLVIDA) porque é o mesmo fato — quem
  // trabalha nas duas telas não deveria ter de aprender dois nomes para ele.
  //
  // Não existe `status_operacional = 'glosa_resolvida'` no banco: este token só
  // é alcançado pelo ramo do vínculo em `resolverStatus`.
  glosa_resolvida: {
    key: 'glosa_resolvida',
    label: 'Glosa Resolvida',
    severidade: 'resolvido',
    icon: CheckCircle2,
  },
}

const FALLBACK: StatusToken = {
  key: 'pendente',
  label: 'Pendente',
  severidade: 'andamento',
  icon: Clock3,
}

/** Resolve o token de um registro a partir do status_operacional. */
export function resolverStatus(item: any): StatusToken {
  const bruto =
    item?.status_operacional ||
    item?.status_assim ||
    item?.status ||
    ''

  // Eco local de `situacaoComVinculo` (auditoria-assim/reconciliacao/cobertura.ts):
  // a cobertura mora em `autorizacoes_vinculos` e nada na `fila_autorizacoes`
  // muda quando ela é gravada — a linha continua dizendo 'glosa' para sempre. A
  // tela não pode ficar cobrando tratativa de uma sessão que ela própria acabou
  // de ler como coberta: seria mostrar como trabalho a fazer algo já feito.
  //
  // O `status_operacional` cru é preservado de propósito (quem anexa o vínculo
  // não o reescreve): é ele que faz `motivoGlosaDaSessao` continuar devolvendo o
  // motivo da recusa, que segue visível na ficha. O histórico não se apaga.
  if (String(bruto).toLowerCase() === 'glosa' && item?.vinculo) {
    return TOKENS.glosa_resolvida
  }

  // A clínica não abriu — feriado, ponto facultativo, falta de energia.
  //
  // Precisa vir ANTES da resolução por status porque a leitura do banco ainda
  // não distingue este caso: o CASE de status_operacional testa tipo_falta
  // 'terapeuta'/'paciente' e nada mais, então uma linha 'unidade' escorrega até
  // o ELSE e chega aqui como 'falta' cru — que o TOKENS mapeia para "Falta do
  // paciente", exatamente o rótulo errado. Ver o TODO em
  // supabase/migrations/20260908100200_falta_da_unidade_fora_da_assiduidade.sql;
  // quando o ramo 'falta_unidade' existir no banco, este bloco vira redundante
  // (e inofensivo).
  if (item?.tipo_falta === 'unidade') {
    return TOKENS.falta_unidade
  }

  const token = TOKENS[String(bruto).toLowerCase()]
  if (token) {
    if (token.key === 'autorizado') {
      const conv = (item?.convenio || item?.convenio_nome || '').toLowerCase()
      if (!conv.includes('assim')) {
        return { ...token, label: 'Presente' }
      }
    }
    return token
  }

  return { ...FALLBACK, label: bruto || 'Sem status' }
}

export function uiDe(item: any) {
  return SEVERIDADE_UI[resolverStatus(item).severidade]
}

/** Quem realizou o atendimento (substituto, se houve; senão o agendado). */
export function realizouPor(item: any): string | null {
  return (
    item?.profissional_realizou_nome ||
    item?.profissional_substituto_nome ||
    item?.profissional_nome ||
    null
  )
}

export function houveSubstituicao(item: any): boolean {
  return (
    item?.is_substituicao === true ||
    (!!item?.profissional_substituto_nome &&
      item?.profissional_substituto_nome !== item?.profissional_nome)
  )
}
