import type { RoboEtapaNome } from '@/types/roboSharepoint'

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

export const rotuloMotivo = (m: string | null | undefined) => (m ? MOTIVOS[m] ?? m.replace(/_/g, ' ') : '—')

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
