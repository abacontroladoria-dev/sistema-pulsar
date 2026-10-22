"use client"

// Faturamento de Prestadores Mensal (/relacionamento-prestador/rp) — antes
// "Remuneração Mensal". Duas abas, cada uma com o seu código de permissão
// (lib/permissions/routes.ts):
//   - ?tab=faturamento → RemunRPTab, o faturamento do mês de todos os prestadores
//     (relacionamento_prestador_rp);
//   - ?tab=contestacao → EmissaoContestacaoTab, o documento de UM prestador em
//     PDF/Word, só mediante contestação dele (relacionamento_prestador_individual,
//     o código da antiga tela /relacionamento-prestador/individual).
//
// O proxy é quem barra a aba sem permissão (abaPadraoLiberada leva a URL sem
// ?tab= para a primeira aba liberada, mantendo ?prestador=/?sessao=). Aqui só se
// decide quais botões mostrar — a mesma regra do Sidebar (canAccess). O admin
// passa pelo proxy antes dessa conta, por isso o replace abaixo.
//
// Cabeçalho e seletor de mês ficam aqui: as duas abas leem o mesmo mês do
// RemuneracaoRPContext (relacionamento-prestador/layout.tsx).

import { useCallback, useEffect, useMemo } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useHeader } from "@/contexts/HeaderContext"
import { useRemuneracaoRPContext } from "@/contexts/RemuneracaoRPContext"
import { usePermissoesUsuario } from "@/contexts/PermissoesUsuarioContext"
import { SegmentedTabs } from "@/components/cronograma/ui/SegmentedTabs"
import { RemuneracaoGradeBadge } from "./RemuneracaoGradeBadge"
import { RemunRPTab } from "./RemunRPTab"
import { EmissaoContestacaoTab } from "./EmissaoContestacaoTab"

const ROTA = "/relacionamento-prestador/rp"

const ABAS = [
  { value: "faturamento", label: "Faturamento" },
  { value: "contestacao", label: "Contestação do prestador" },
] as const

type Aba = (typeof ABAS)[number]["value"]

export function FaturamentoMensalShell() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const { setHeader, setRightContent } = useHeader()
  const { controlesGrade } = useRemuneracaoRPContext()
  const { role, carregando, canAccess } = usePermissoesUsuario()

  const raw = searchParams.get("tab")
  const ativa: Aba = ABAS.some(a => a.value === raw) ? (raw as Aba) : "faturamento"

  // A aba aberta sempre aparece (o proxy já deixou entrar). As outras, só se
  // liberadas. Sem sessão (localhost) não há o que conferir: mostra as duas.
  const visiveis = useMemo(
    () => ABAS.filter(a => a.value === ativa || (!carregando && (!role || canAccess(`${ROTA}?tab=${a.value}`)))),
    [ativa, carregando, role, canAccess]
  )

  const irPara = useCallback((aba: Aba) => {
    const novos = new URLSearchParams(searchParams.toString())
    novos.set("tab", aba)
    router.replace(`${pathname}?${novos.toString()}`, { scroll: false })
  }, [searchParams, pathname, router])

  useEffect(() => {
    if (raw !== ativa) irPara(ativa)
  }, [raw, ativa, irPara])

  useEffect(() => {
    setHeader("Faturamento de Prestadores Mensal", "Relacionamento Prestador")
    setRightContent(<RemuneracaoGradeBadge c={controlesGrade} />)
    return () => {
      setHeader("", "")
      setRightContent(null)
    }
  }, [setHeader, setRightContent, controlesGrade])

  return (
    <div className="space-y-4">
      {visiveis.length > 1 && (
        <SegmentedTabs<Aba>
          value={ativa}
          onChange={irPara}
          tabs={[...visiveis]}
          ariaLabel="Abas do Faturamento de Prestadores Mensal"
          size="lg"
        />
      )}
      {ativa === "faturamento" ? <RemunRPTab /> : <EmissaoContestacaoTab />}
    </div>
  )
}
