import { TERAPIA_ID } from '@/lib/cronograma/constants'

// Único sobrevivente do módulo /agenda (páginas removidas em 2026-08-17):
// alimenta a sugestão de terapia do AlocarSessaoModal, no cronograma de salas.
//
// Antes esta função buscava `terapia_nome` em `agenda_tita_autorizacao_v2` com
// `.limit(200)` e sem `order` — um corte arbitrário nas 200 primeiras linhas
// FÍSICAS da tabela, antes do dedupe. Terapias raras na ordem física da tabela
// (ex.: Fonoaudiologia) podiam nunca entrar nesse recorte e sumiam da lista
// inteira, mesmo a clínica tendo profissionais só dessa especialidade — achado
// 2026-09-18, caso Luciana Lima Dos Santos. TERAPIA_ID (mesmo usado por
// NOME_PARA_TERAPIA_ID pra resolver terapia_id no salvamento) já é o
// vocabulário completo e estável da clínica — usar ele aqui elimina a consulta
// e o corte junto.
export async function listarTerapiasFiltro(): Promise<string[]> {
  return Object.keys(TERAPIA_ID)
}
