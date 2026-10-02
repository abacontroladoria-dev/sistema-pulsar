import type { EventoEvidenciaTipo, RoboEtapaNome } from '@/types/roboSharepoint'

// Texto humano para os códigos que o banco grava (sp_pep_reavaliar,
// 20261001120000) e para as etapas do robô (robo-pep-sharepoint/lib/execucao.js).
// Um lugar só: o painel e a gaveta da PEP falam a mesma língua.

export const ETAPAS: { etapa: RoboEtapaNome; rotulo: string; explica: string }[] = [
  { etapa: 'autenticar', rotulo: 'Autenticar', explica: 'Entra na Microsoft com o certificado do robô' },
  { etapa: 'listar', rotulo: 'Listar o SharePoint', explica: 'Pede só o que mudou desde a última leitura' },
  { etapa: 'classificar', rotulo: 'Classificar', explica: 'Pasta → prestador, paciente e item do PEP' },
  { etapa: 'planilhas', rotulo: 'Ler planilhas', explica: 'CNPJ e CPFs da planilha de planejamento' },
  { etapa: 'enviar', rotulo: 'Reconhecer no Pulsar', explica: 'CNPJ, CPF e sessão na Grade; grava sugestões' },
]

export const MOTIVOS: Record<string, string> = {
  planilha_ausente: 'Pasta sem planilha de planejamento',
  planilha_ilegivel: 'Planilha não pôde ser lida',
  cnpj_ausente: 'Planilha sem CNPJ',
  cnpj_invalido: 'CNPJ da planilha inválido',
  cnpj_nao_cadastrado: 'CNPJ não está em Contratos',
  cnpj_duplicado: 'CNPJ em mais de um contrato',
  prestador_nao_reconhecido: 'Prestador não reconhecido',
  paciente_fora_da_planilha: 'Pasta do paciente não está na planilha',
  cpf_ausente: 'Paciente sem CPF na planilha',
  cpf_invalido: 'CPF da planilha inválido',
  cpf_nao_encontrado: 'CPF não encontrado no Pulsar',
  cpf_duplicado_no_pulsar: 'CPF em mais de um cadastro',
  nome_divergente: 'Nome da pasta não bate com o cadastro',
  paciente_nao_reconhecido: 'Paciente não reconhecido',
  sem_sessao_cc_no_mes: 'Sem sessão de Coordenador de Caso no mês',
  competencia_indefinida: 'Mês da entrega não identificado',
  item_desconhecido: 'Item do PEP desconhecido',
  caminho_incompleto: 'Caminho do arquivo incompleto',
  arquivo_na_raiz: 'Arquivo solto na raiz do site',
  pasta_prestador_fora_padrao: 'Pasta de prestador fora do padrão',
  secao_desconhecida: 'Pasta fora de Planejamento/Geral/Pacientes',
  item_geral_desconhecido: 'Subpasta do Geral desconhecida',
  item_paciente_desconhecido: 'Subpasta do paciente desconhecida',
  fora_padrao: 'Fora do padrão de pastas',
}

// A fila "O que precisa de você" fala com quem nem sabe o que é PEP: cada
// motivo de pasta vira um título em português comum, uma frase de porquê e o
// verbo do botão. Planilha ausente não está aqui de propósito: só a planilha
// resolve, e ela tem a própria tarefa ("Pedir a planilha").
export type GrupoMotivo = { titulo: string; porque: string; botao: string }

export const GRUPOS_MOTIVO: Record<string, GrupoMotivo> = {
  paciente_fora_da_planilha: {
    titulo: 'O paciente não está na planilha',
    porque: 'O nome desta pasta não aparece na lista de pacientes que o prestador mandou. Diga quem é o paciente.',
    botao: 'Escolher o paciente',
  },
  cpf_duplicado_no_pulsar: {
    titulo: 'Dois cadastros com o mesmo CPF',
    porque: 'Há duas fichas do mesmo paciente no Pulsar. Diga qual é a certa e depois peça para juntar as duas.',
    botao: 'Escolher o cadastro certo',
  },
  cpf_nao_encontrado: {
    titulo: 'Paciente sem cadastro com esse CPF',
    porque: 'O CPF da planilha não bate com nenhuma ficha. Encontre o paciente pelo nome.',
    botao: 'Escolher o paciente',
  },
  cpf_ausente: {
    titulo: 'Paciente sem CPF na planilha',
    porque: 'A planilha traz o nome, mas não o CPF. Encontre o paciente pelo nome.',
    botao: 'Escolher o paciente',
  },
  cpf_invalido: {
    titulo: 'CPF da planilha está errado',
    porque: 'O CPF escrito na planilha não é um CPF válido. Encontre o paciente pelo nome.',
    botao: 'Escolher o paciente',
  },
  nome_divergente: {
    titulo: 'O nome da pasta não bate com o cadastro',
    porque: 'O CPF achou uma pessoa com outro nome. Confira de quem é a pasta.',
    botao: 'Escolher o paciente',
  },
  cnpj_ausente: {
    titulo: 'Planilha sem CNPJ',
    porque: 'Sem o CNPJ, o robô não sabe de qual contrato é a pasta. Diga quem é o prestador.',
    botao: 'Escolher o prestador',
  },
  cnpj_invalido: {
    titulo: 'CNPJ da planilha está errado',
    porque: 'O CNPJ escrito na planilha não é válido. Diga quem é o prestador.',
    botao: 'Escolher o prestador',
  },
  cnpj_nao_cadastrado: {
    titulo: 'CNPJ que não está em Contratos',
    porque: 'Nenhum contrato tem esse CNPJ. Diga quem é o prestador, ou cadastre o CNPJ no contrato.',
    botao: 'Escolher o prestador',
  },
  cnpj_duplicado: {
    titulo: 'CNPJ em dois contratos',
    porque: 'Dois contratos usam o mesmo CNPJ. Diga qual é o certo.',
    botao: 'Escolher o prestador',
  },
}

export const grupoMotivo = (m: string | null | undefined): GrupoMotivo =>
  (m && GRUPOS_MOTIVO[m]) || { titulo: rotuloMotivo(m), porque: 'Diga de quem é esta pasta.', botao: 'Escolher' }

/** Texto pronto para mandar ao prestador (WhatsApp/e-mail). Sem a palavra PEP. */
export function mensagemPedirPlanilha(nomeCurto: string, pacientes: number) {
  const primeiro = nomeCurto.trim().split(/\s+/)[0] || nomeCurto
  const quantos = pacientes > 0 ? ` dos seus ${pacientes} ${pacientes === 1 ? 'paciente' : 'pacientes'}` : ''
  return `Olá, ${primeiro}! Tudo bem? Na sua pasta do SharePoint da Universo ABA, a pasta "1. Planejamento - Prestador de Serviço" ainda está sem a planilha de planejamento (arquivo .xlsx). Sem ela não conseguimos registrar os documentos${quantos}. Pode colocar a planilha lá, por favor? Obrigado!`
}

export const rotuloMotivo =(m: string | null | undefined) => (m ? MOTIVOS[m] ?? MOTIVOS_IGNORADO[m] ?? m.replace(/_/g, ' ') : '—')

// Por que um arquivo lido não é evidência do PEP (robo-pep-sharepoint/lib/mapeamento.js).
export const MOTIVOS_IGNORADO: Record<string, string> = {
  pasta_fora_do_pep: 'Nas pastas 6 ou 7 do paciente (Avaliações Gerais, Protocolo de Conduta), que não entram no PEP',
  arquivo_solto_no_paciente: 'Solto na pasta do paciente, fora das 7 subpastas',
  arquivo_solto_em_pacientes: 'Solto em “3. Pacientes”, fora da pasta de um paciente',
  arquivo_solto_no_geral: 'Solto em “2. Geral”, fora de Supervisão ou Estudo',
  arquivo_solto_no_prestador: 'Solto na pasta do prestador, fora das 3 seções',
  nao_e_planilha: 'Na pasta de Planejamento, mas não é planilha',
  havia_planilha_mais_recente: 'Havia outra planilha mais recente na mesma pasta',
}

// Itens do catálogo PEP, na ordem das pastas do SharePoint.
export const ITENS_PEP: { sigla: string; nome: string; onde: string }[] = [
  { sigla: 'STC', nome: 'Supervisão Técnica ABA do Caso', onde: '2. Geral / 1.' },
  { sigla: 'ETC', nome: 'Estudo Técnico de Caso', onde: '2. Geral / 2.' },
  { sigla: 'TAP', nome: 'Treinamento de Aplicadores ABA', onde: 'Paciente / 1.' },
  { sigla: 'TOP', nome: 'Treinamento e Orientação Parental', onde: 'Paciente / 2.' },
  { sigla: 'PIC', nome: 'Plano Individualizado Comportamental', onde: 'Paciente / 3.' },
  { sigla: 'RT', nome: 'Relatório de Fechamento Técnico', onde: 'Paciente / 4.' },
  { sigla: 'OE', nome: 'Orientação Escolar', onde: 'Paciente / 5.' },
]

export const TIPOS_ARQUIVO: Record<string, { rotulo: string; plural: string }> = {
  evidencia: { rotulo: 'Evidência', plural: 'Evidências' },
  planilha: { rotulo: 'Planilha', plural: 'Planilhas' },
  ignorado: { rotulo: 'Fora do PEP', plural: 'Fora do PEP' },
  fora_padrao: { rotulo: 'Fora do padrão', plural: 'Fora do padrão' },
  removido: { rotulo: 'Apagado', plural: 'Apagados' },
}

/**
 * Lê o caminho que o robô gravou ("Prestador de Serviço - Fulana (X LTDA)/3.
 * Pacientes/Beltrano/1. Treinamento…/arquivo.pdf") em partes legíveis.
 */
export function partesDoCaminho(caminho: string | null | undefined) {
  const seg = (caminho ?? '').split('/').filter(Boolean)
  const m = /^prestador\s+de\s+servi[cç]o\s*[-–—]\s*(.+?)\s*(?:\([^()]+\))?\s*$/i.exec(seg[0] ?? '')
  const prestador = m ? m[1] : seg[0] ?? null
  const secao = seg[1] ?? null
  const ehPaciente = /^0*3\s*[.)\-–]/.test(secao ?? '')
  return {
    prestador,
    paciente: ehPaciente && seg.length > 3 ? seg[2] : null,
    pasta: seg.length > 1 ? seg[seg.length - 2] : null,
  }
}

/** "Prestador de Serviço - Fulana (FULANA LTDA)" → "Fulana". */
export const nomeCurtoPrestador = (nomePasta: string | null | undefined) =>
  partesDoCaminho(`${nomePasta ?? ''}/x`).prestador ?? nomePasta ?? '—'

export const numero = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('pt-BR'))

export const GATILHOS: Record<string, string> = {
  agenda: 'Agendada',
  manual: 'Executar agora',
  demo: 'Demonstração',
  inventario: 'Inventário',
}

export const MODOS: Record<string, string> = {
  producao: 'Produção',
  homologacao: 'Homologação',
  simulacao: 'Simulação',
}

export function segundos(ms: number | null | undefined, casas = 1) {
  if (ms == null) return '—'
  return `${(ms / 1000).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })} s`
}

export function dataHora(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

export function haQuanto(iso: string | null | undefined, agora = Date.now()) {
  if (!iso) return '—'
  const min = Math.round((agora - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'agora há pouco'
  if (min < 60) return `há ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `há ${h} h`
  return `há ${Math.round(h / 24)} dia(s)`
}

// ── Padrão de nome e entrega automática (20261002100000) ─────────────────────

// Por que o nome do arquivo fere o padrão (sp_pep_itens.padrao_motivo).
export const MOTIVOS_PADRAO: Record<string, string> = {
  sigla_diferente_da_pasta: 'A sigla no nome não é a da pasta',
  sem_competencia: 'Falta o mês no fim do nome (MMAAAA)',
  tap_sem_sequencial: 'TAP precisa do número: TAP-01-PACIENTE-MMAAAA',
  geral_sem_sequencial: 'Falta o número: SIGLA-01-MMAAAA',
  formato_desconhecido: 'Nome fora do padrão',
  paciente_diferente_da_pasta: 'O paciente no nome não é o da pasta',
  repetido: 'Repetido: outro arquivo igual já conta',
}

// Por que o robô não entregou um arquivo que segue o padrão (sp_pep_itens.robo_obs).
export const MOTIVOS_ROBO: Record<string, string> = {
  mes_liberado: 'Mês já liberado: reabra para registrar',
  excedente: 'O mês já tem todas as unidades deste item',
  sem_planejamento: 'Sem planejamento semestral: planeje o item antes',
  fora_do_ciclo: 'Arquivo de um ciclo anterior ao planejamento',
  ja_entregue_no_ciclo: 'Já existe entrega deste item no ciclo',
  arquivo_removido: 'O arquivo foi apagado do SharePoint',
  saiu_da_pasta_do_item: 'O arquivo saiu da pasta do item: a entrega foi retirada',
}

// ── Histórico das evidências (20261003100000) ────────────────────────────────

/** Nome de cada acontecimento, para a lista e a legenda do gráfico. */
export const EVENTOS_EVIDENCIA: Record<EventoEvidenciaTipo, { rotulo: string; explica: string }> = {
  apareceu: { rotulo: 'Apareceu', explica: 'A evidência entrou na pasta do item' },
  sumiu: { rotulo: 'Sumiu', explica: 'A evidência foi apagada do SharePoint' },
  deixou_de_ser_evidencia: { rotulo: 'Saiu do PEP', explica: 'Continua no SharePoint, mas fora das pastas dos itens' },
  voltou: { rotulo: 'Voltou', explica: 'A evidência apagada voltou para a pasta' },
  renomeou: { rotulo: 'Renomeada', explica: 'O nome do arquivo mudou' },
  moveu: { rotulo: 'Mudou de pasta', explica: 'O arquivo foi para outra pasta' },
  saiu_do_padrao: { rotulo: 'Saiu do padrão', explica: 'Já estava entregue e o novo nome fere o padrão (a entrega ficou)' },
  entrega_desfeita: { rotulo: 'Entrega retirada', explica: 'A entrega perdeu a unidade que a evidência sustentava' },
  mes_liberado_mantido: { rotulo: 'Mês liberado: mantida', explica: 'A evidência saiu, mas o mês já estava liberado e não muda' },
}

/** 'AAAA-MM' → 'MM/AAAA'. */
export const mesBR = (c: string | null | undefined) => (c ? c.split('-').reverse().join('/') : '—')

/** Dias entre o envio do arquivo e o momento do evento ("ficou 3 dias na pasta"). */
export function diasNaPasta(criadoEmSp: string | null | undefined, em: string) {
  if (!criadoEmSp) return null
  return Math.max(0, Math.floor((Date.parse(em) - Date.parse(criadoEmSp)) / 86400000))
}

/** Por que um arquivo sugerido está esperando uma pessoa, em uma frase. */
export function porQueEsperando(i: { padrao?: string | null; padrao_motivo?: string | null; robo_obs?: string | null }): string {
  if (i.padrao === 'rep') return 'Reprogramação (REP-): registre na matriz semestral'
  if (i.padrao === 'fora' || i.padrao === 'duplicado') return MOTIVOS_PADRAO[i.padrao_motivo ?? ''] ?? 'Nome fora do padrão'
  if (i.robo_obs) return MOTIVOS_ROBO[i.robo_obs] ?? i.robo_obs.replace(/_/g, ' ')
  return 'Segue o padrão: o robô entrega na próxima leitura'
}

/** Nome que o arquivo deveria ter: "PIC-ADRIAN COSTA-092026", "STC-01-092026", "TAP-01-JOAO-092026". */
export function nomeEsperado(sigla: string | null | undefined, paciente: string | null | undefined, competencia: string | null | undefined) {
  if (!sigla) return null
  const [ano, mes] = (competencia ?? '').split('-')
  const mmaaaa = ano && mes ? `${mes}${ano}` : 'MMAAAA'
  if (sigla === 'STC' || sigla === 'ETC') return `${sigla}-01-${mmaaaa}`
  const pac = (paciente ?? 'PACIENTE').toLocaleUpperCase('pt-BR')
  return sigla === 'TAP' ? `TAP-01-${pac}-${mmaaaa}` : `${sigla}-${pac}-${mmaaaa}`
}
