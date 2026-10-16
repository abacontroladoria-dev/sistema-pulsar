// O contador de menções não lidas mora no ChatEquipeProvider (layout raiz),
// para ser UMA consulta por aba e sobreviver à troca entre Pulsar e Connect.
// Este arquivo só mantém os imports antigos funcionando.
export { useMencoesNaoLidas } from '@/contexts/ChatEquipeContext'
export { avisarMencoesAlteradas } from '@/lib/central/mencoes-evento'
