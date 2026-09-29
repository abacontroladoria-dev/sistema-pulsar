// Tipos da tela Status Laudos e Senhas (/acompanhamento/laudos).
//
// Vivem AQUI, e não em services/laudos/acompanhamento.ts, porque aquele módulo é
// `server-only` (lê `orbita_laudos_*` com service_role) e os componentes desta
// tela são cliente — importar o tipo de lá arrastaria o módulo de servidor para
// o bundle. Mesma separação já feita por `MetaImportacaoLaudos` em
// types/cronograma.ts.

import type { EspecialidadeQtd, SituacaoLaudo } from "@/lib/laudos/acompanhamento"
import type { OrigemConvenio } from "@/lib/laudos/convenio"
import type {
  AutorizacaoSenha,
  EspecialidadeAutorizada,
  SenhaDoRol,
  SenhasDoLaudo,
  StatusSenha,
} from "@/lib/laudos/senhas"

export type { EspecialidadeQtd, OrigemConvenio, SituacaoLaudo }
export type { AutorizacaoSenha, EspecialidadeAutorizada, SenhaDoRol, SenhasDoLaudo, StatusSenha }

/**
 * Situação do paciente no cadastro do Pulsar, do ponto de vista desta tela.
 *
 * `ficticio` são Notificação Prévia, Horário Administrativo e afins — não são
 * pessoas, e /cadastros/pacientes os deixa fora por padrão pelo mesmo motivo.
 * Medido em 28/08/2026: 1 dos 343 laudos do relatório é de paciente fictício
 * (laudo 464, "Notificação Prévia", vigente). Um só, e ainda assim não pode
 * ficar na fila de cobrança: não existe responsável para avisar.
 *
 * `ficticio` VENCE `ativo`/`inativo` quando os dois valem — igual à listagem do
 * cadastro.
 */
export type SituacaoPaciente = "ativo" | "inativo" | "sem_cadastro" | "ficticio"

/**
 * Uma linha da tela: o laudo do Órbita + o cadastro do Pulsar (quando existe) +
 * o registro da recepção (quando existe).
 *
 * Todas as datas em ISO (`AAAA-MM-DD`) — a tela ordena e filtra por elas, e
 * "DD/MM/AAAA" não se compara como string. Formatação BR só no render.
 */
export interface ItemAcompanhamentoLaudo {
  // ─── Do relatório do Órbita (fonte da lista) ───
  /** `ID Laudo`. A chave da linha e a única que sobrevive à troca de importação. */
  idLaudo: string
  /** `ID Favorecido` — o "ID PAC" que a tela mostra. */
  idFavorecido: number | null
  /** Nome do relatório. O do cadastro, quando existe, está em `pacienteNomeCadastro`. */
  nome: string
  dataLaudo: string | null
  validade: string | null
  autorizadoEm: string | null
  /** Calculada por `validade` contra hoje (Brasília), conferida com o Órbita. */
  situacao: SituacaoLaudo
  situacaoOrbita: string
  /** O Órbita e o cálculo por validade discordam — mostrar, nunca engolir. */
  situacaoDivergente: boolean
  especialidades: string[]
  /** Especialidades com `Qtd laudo`/`Qtd autorizada` — a tabela do detalhe. */
  especialidadesQtd: EspecialidadeQtd[]
  /** `Plano` do relatório do Órbita, como veio. */
  plano: string
  /**
   * O convênio do paciente: o da GRADE da TiTa (próximo agendamento, ou o
   * último) e, sem o paciente na grade, o `Plano` do Órbita. É o que o filtro
   * "Convênio" lê, o que o cartão mostra quando a senha não se aplica, e o que
   * decide entre "Sem senha" (ASSIM) e outro convênio. `null` = nenhum dos dois.
   */
  convenio: string | null
  convenioOrigem: OrigemConvenio | null
  /**
   * O nome como veio da grade/Órbita quando o convênio foi INCORPORADO por outro
   * (ex.: "MEMORIAL SAÚDE LTDA", absorvida pela ASSIM). `null` no caso normal.
   */
  convenioOriginal: string | null

  // ─── Do cadastro do Pulsar (enriquecimento; pode faltar) ───
  /** Nulo nos laudos cujo paciente não tem cadastro — 58 de 343 em 28/08/2026. */
  pacienteId: number | null
  pacienteNomeCadastro: string | null
  /** `ativo`/`inativo`/`sem_cadastro` — é o campo "ATIVO (PACIENTE)" da tela. */
  situacaoPaciente: SituacaoPaciente
  /** PATH no bucket privado, não URL. A URL assinada é gerada no cliente. */
  fotoPath: string | null

  // ─── Do acompanhamento da recepção (pode faltar) ───
  /** A data que a recepção digitou. `null` = pendência em aberto. */
  mensagemEnviadaEm: string | null
  observacao: string | null
  /** Quem salvou por último e quando (data/hora de Brasília, já formatada). */
  registradoPorNome: string | null
  registradoEm: string | null

  // ─── Do relatório de senhas da ASSIM (upload manual) ───
  /**
   * `null` enquanto nenhum relatório de senhas foi importado (ou se a leitura
   * falhou — ver `MetaAcompanhamentoLaudos.senhasErro`). Com relatório, TODO
   * laudo tem `senhas`, mesmo os ausentes dele ("Sem senha"/"Outro convênio").
   */
  senhas: SenhasDoLaudo | null
}

/** De onde vieram as senhas da tela, e o que do relatório não casou. */
export interface MetaSenhas {
  importacaoId: string
  arquivoNome: string
  /** `DD/MM/AAAA HH:MM`, Brasília. */
  importadoEm: string | null
  importadoPorNome: string | null
  totalLinhas: number
  autorizacoes: number
  /** Laudos da tela com ao menos uma autorização casada (laudo + favorecido). */
  laudosCasados: number
  /** Laudos do relatório que não estão no Órbita. */
  laudosOrfaos: string[]
  /** Laudo no Órbita com favorecido diferente no relatório — não casados. */
  laudosDivergentes: string[]
}

/** Metadados da resposta — de onde veio a lista e o que ela deixou de fora. */
export interface MetaAcompanhamentoLaudos {
  /** Importação do robô que originou a lista. */
  importacaoId: string
  arquivoNome: string
  concluidoEm: string | null
  /** Linhas do relatório lidas (uma por laudo × especialidade). */
  linhasLidas: number
  /** Laudos distintos — o número de cartões. */
  laudos: number
  /** Hoje em Brasília, na base do cálculo vigente/vencido. */
  hoje: string
  /** Linhas do relatório sem `ID Laudo`, descartadas. Esperado: 0. */
  descartadas: number
  /** Laudos com campo divergente entre suas linhas. Esperado: 0. */
  comCamposDivergentes: number
  /** Laudos onde o rótulo do Órbita discorda da validade. Esperado: 0. */
  comSituacaoDivergente: number
  /** Importação de senhas em uso. `null` = nenhuma ainda, ou leitura falhou. */
  senhas: MetaSenhas | null
  /** Por que as senhas não vieram, quando a leitura falhou. A lista vem mesmo assim. */
  senhasErro: string | null
  /** Laudos cujo convênio veio da grade da TiTa (o resto, do Plano do Órbita). */
  convenioPelaGrade: number
  /** Por que o convênio da grade não veio. A lista vem com o Plano do Órbita. */
  convenioErro: string | null
}

/** Resposta de POST /api/acompanhamento-laudos/senhas/. */
/**
 * O que a regra de meses fechados fez num upload (migration 20261001100000).
 * Meses antes de `mesCorte` são inalteráveis: vêm da importação anterior, e o
 * que o arquivo traz deles é ignorado.
 */
export interface MesesFechadosUpload {
  /** "AAAA-MM-01" — o mês aberto no upload (Brasília). */
  mesCorte: string
  /** Sem importação anterior: carga completa, nada foi ignorado. */
  primeiraImportacao: boolean
  autorizacoesArquivo: number
  /** Do mês aberto em diante, gravadas a partir do arquivo. */
  aplicadas: number
  /** Do arquivo, de mês fechado — não gravadas. */
  ignoradas: number
  /** Da importação anterior, de mês fechado — copiadas intocadas. */
  mantidas: number
  /** De mês aberto, estavam na importação anterior e não vieram no arquivo. */
  removidas: number
}

export interface RespostaUploadSenhas {
  ok: true
  duplicado: boolean
  importadoEm: string | null
  importadoPorNome: string | null
  /** `null` quando o arquivo é duplicado (nada foi gravado). */
  mesesFechados: MesesFechadosUpload | null
  resumo: {
    linhas: number
    linhasDescartadas: number
    autorizacoes: number
    laudosCasados: number
    laudosOrfaos: string[]
    laudosDivergentes: string[]
    autorizacoesDivergentes: string[]
    datasInvalidas: number
  }
}

export interface RespostaAcompanhamentoLaudos {
  ok: true
  itens: ItemAcompanhamentoLaudo[]
  meta: MetaAcompanhamentoLaudos
}

/** O que a recepção grava. `null` em `mensagemEnviadaEm` limpa a data. */
export interface EdicaoAcompanhamentoLaudo {
  mensagemEnviadaEm: string | null
  observacao: string | null
}
