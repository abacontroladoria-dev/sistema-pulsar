export function getStatusConfig(a: any) {
  const isManual = a.agenda_classificacao?.status === 'manual'

  // 🟢 AUTORIZADO
  if (a.status_assim === 'autorizado') {
    return {
      key: 'autorizado',
      label: 'Atendimento autorizado',
      className: 'bg-green-100 text-green-700'
    }
  }

  // 🔴 GLOSA (NEGADO)
  // Dois caminhos para a mesma coisa: 'pendencia_adm' vem do relatório da ASSIM;
  // status='glosa' é o robô lendo "BENEFICIO REJEITADO" no recibo do aceite, no
  // mesmo dia. Sem o segundo, a linha caía em "Status desconhecido".
  if (a.status_assim === 'pendencia_adm' || a.status === 'glosa') {
    return {
      key: 'glosa',
      label: 'Negado pelo convênio',
      sublabel: null,
      className: 'bg-red-100 text-red-700'
    }
  }

  // ⚫ ESTORNADO
  if (a.status_assim === 'estornado') {
    return {
      key: 'estornado',
      label: 'Autorização cancelada',
      className: 'bg-gray-200 text-gray-700'
    }
  }

  // 🟠 FALTA (DETALHADA)
  if (a.status === 'falta') {
    // A clínica não abriu: feriado, ponto facultativo, falta de energia.
    // Neutro de propósito — não há ausência de ninguém a sinalizar, então não
    // usa o amarelo/vermelho que pedem tratativa.
    if (a.tipo_falta === 'unidade') {
      return {
        key: 'falta_unidade',
        label: 'Unidade fechada',
        sublabel: null,
        className: 'bg-slate-100 text-slate-600'
      }
    }

    if (a.tipo_falta === 'paciente') {
      return {
        key: 'falta_paciente',
        label: 'Falta do Paciente',
        sublabel: null,
        className: 'bg-yellow-100 text-yellow-700'
      }
    }

    if (a.tipo_falta === 'terapeuta') {
      return {
        key: 'falta_terapeuta',
        label: 'Falta do Profissional',
        sublabel: null,
        className: 'bg-red-100 text-red-700'
      }
    }

    return {
      key: 'falta_indefinida',
      label: 'Falta não identificada',
      sublabel: null,
      className: 'bg-orange-100 text-orange-700'
    }
  }

  // 🔵 EXECUTANDO
  if (a.status === 'executando') {
    return {
      key: 'executando',
      label: 'Em processamento',
      sublabel: null,
      className: 'bg-blue-100 text-blue-700'
    }
  }

  // 🟡 CONCLUÍDO SEM RETORNO (fallback raro)
  if (a.status === 'concluido' && !a.status_assim) {
    return {
      key: 'sem_retorno',
      label: 'Aguardando confirmação',
      sublabel: null,
      className: 'bg-yellow-100 text-yellow-700'
    }
  }

  // 🔴 ERRO
  if (a.status === 'erro') {
    return {
      key: 'erro',
      label: 'Erro na autorização',
      sublabel: null,
      className: 'bg-red-100 text-red-700'
    }
  }

  // ⚪ DEFAULT
  return {
    key: 'desconhecido',
    label: 'Status desconhecido',
    sublabel: null,
    className: 'bg-gray-100 text-gray-700'
  }
}