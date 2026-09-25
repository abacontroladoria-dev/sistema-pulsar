'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CalendarDays } from 'lucide-react'
import { useAuditoriaAssim } from '@/hooks/useAuditoriaAssim'
import { useFeriados } from '@/hooks/useFeriados'
import KpiCards from '@/components/auditoria-assim/KpiCards'
import FiltrosAuditoria from '@/components/auditoria-assim/FiltrosAuditoria'
import TabelaAuditoria from '@/components/auditoria-assim/TabelaAuditoria'
import type { AlvoAnalise } from '@/components/auditoria-assim/types'

type Props = {
  /** Leva para a aba Reconciliação, posicionada na semana daquele atendimento. */
  onAnalisarSemana: (alvo: AlvoAnalise) => void
}

/**
 * Aba Auditoria — a visão analítica e de conferência.
 *
 * Conteúdo movido VERBATIM do antigo app/(dashboard)/auditoria-assim/page.tsx.
 * Nenhuma mudança de comportamento: mesmos KPIs, filtros, tabela, ordenação,
 * paginação e modal de glosa. A única diferença é que o título do header agora é
 * definido pelo Shell, não aqui.
 */
export default function AuditoriaTab({ onAnalisarSemana }: Props) {
  // `?data=AAAA-MM-DD` — o link de outra tela (a Conferência de Guias) abre a
  // Conferência já no dia da sessão. Lido uma vez e tirado da URL em seguida:
  // um F5 ou um favorito não pode prender a tela num dia antigo. Valor torto é
  // ignorado em silêncio e a tela abre em hoje, como abria.
  const searchParams = useSearchParams()
  const router = useRouter()
  const [dataDoLink] = useState(() => {
    const d = searchParams.get('data')
    return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined
  })
  useEffect(() => {
    if (searchParams.has('data')) router.replace('/auditoria-assim?tab=auditoria')
  }, [searchParams, router])

  const {
    dados,
    kpis,
    loading,
    filters,
    setFilters,
    pagina,
    setPagina,
    totalPaginas,
    totalFiltrados,
    sortKey,
    sortDir,
    setSort,
    carregarDados,
  } = useAuditoriaAssim(dataDoLink)

  // Cache compartilhado em módulo — montar aqui não custa requisição além da
  // primeira do app inteiro.
  const { feriados } = useFeriados()
  const feriado = feriados[filters.data]

  return (
    <div className="bg-card rounded-2xl">
      <div className="flex flex-col gap-4 overflow-hidden">

        {/* Feriado NÃO muda número nenhum — as sessões continuam no Total e em
            "Não Solicitadas", porque elas de fato estavam na agenda e de fato
            não foram solicitadas. O que faltava era a legenda: sem ela, um dia
            parado lê-se como um dia de trabalho perdido, e a auditoria não tem
            como saber a diferença (na RPC, `NAO_SOLICITADA` é o ELSE do CASE —
            o balde do "nada aconteceu"). Este aviso é o que separa as duas
            leituras, e mora ACIMA dos cards por isso: quem vê o número tem de
            ver o motivo antes de reagir a ele. */}
        {feriado && (
          <div
            role="status"
            // Sem variantes `dark:`: este módulo depende do shim global de tema
            // escuro, que cobre `bg-`/`text-` sólidos. Nada de opacidade
            // (`bg-amber-50/60`) nem de degraus `-400`/`-800` aqui — os dois
            // vazam claro no escuro, calados.
            className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-amber-50 px-4 py-2.5 text-xs text-amber-800"
          >
            <span className="flex items-center gap-1.5 font-semibold">
              <CalendarDays size={13} />
              Feriado — {feriado.nome}
            </span>
            <span>
              {feriado.tipo === 'parcial'
                ? `expediente encerrado das ${feriado.horario_inicio} às ${feriado.horario_fim}. As sessões desta janela seguem na agenda, mas não foram operadas — os números abaixo as contam assim mesmo.`
                : 'as sessões abaixo estavam na agenda, mas o dia não foi operado — os números as contam assim mesmo.'}
            </span>
          </div>
        )}

        <KpiCards
          kpis={kpis}
          loading={loading}
          activeFilter={filters.situacao}
          onFilter={(situacao) => setFilters({ ...filters, situacao })}
        />

        <FiltrosAuditoria filters={filters} onChange={setFilters} />

        <TabelaAuditoria
          dados={dados}
          loading={loading}
          pagina={pagina}
          totalPaginas={totalPaginas}
          totalFiltrados={totalFiltrados}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={setSort}
          onPaginaChange={setPagina}
          onRefresh={() => carregarDados(true)}
          onAnalisarSemana={(item) =>
            onAnalisarSemana({
              pacienteNome: item.paciente_nome,
              carteirinha: item.carteirinha,
              data: item.data_atendimento ?? filters.data,
            })
          }
        />

      </div>
    </div>
  )
}
