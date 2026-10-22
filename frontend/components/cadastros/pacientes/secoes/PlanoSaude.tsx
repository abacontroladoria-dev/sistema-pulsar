"use client"

import { useEffect, useState } from "react"
import { Info } from "lucide-react"
import { getPlanosSaude, PLANOS_SAUDE_DISPONIVEL, rotuloPlano } from "@/services/planosSaude.service"
import type { PlanoSaude as PlanoSaudeTipo } from "@/services/planosSaude.service"
import type { PacienteFichaMedica } from "@/types/paciente"
import { Campo, Secao, campo, rotulo, CampoSelect } from "../ui/campos"

// O plano de saúde NUNCA é texto livre: só vem do cadastro de Convênios/Planos.
// Esta tela conhece apenas o contrato de planosSaude.service — o service de
// convênios fica atrás dele, para a origem do dado poder mudar num arquivo só.
//
// O rótulo de cada plano (convênio + plano) vem de rotuloPlano, o mesmo que o
// histórico usa.

export function PlanoSaude({
  ficha,
  setFicha,
  disabled,
}: {
  ficha: Omit<PacienteFichaMedica, "paciente_id">
  setFicha: (patch: Partial<Omit<PacienteFichaMedica, "paciente_id">>) => void
  disabled: boolean
}) {
  const [planos, setPlanos] = useState<PlanoSaudeTipo[]>([])
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let ativo = true
    getPlanosSaude().then(({ data, error }) => {
      if (!ativo) return
      setPlanos(data)
      setErro(error)
    })
    return () => {
      ativo = false
    }
  }, [])

  return (
    <Secao titulo="Plano de saúde" descricao="Convênio particular do paciente">
      {!PLANOS_SAUDE_DISPONIVEL && (
        <div className="sm:col-span-2 flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            O cadastro de planos de saúde ainda não está disponível. Assim que ele
            existir, os planos aparecem aqui para seleção.
          </span>
        </div>
      )}

      {erro && (
        <div
          role="alert"
          className="sm:col-span-2 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Não foi possível carregar os planos de saúde. {erro}</span>
        </div>
      )}

      <CampoSelect
        label="Plano de saúde"
        value={ficha.plano_saude_id ? String(ficha.plano_saude_id) : null}
        onChange={(v) => setFicha({ plano_saude_id: v ? Number(v) : null })}
        disabled={disabled || planos.length === 0}
        vazio={planos.length === 0 ? "Nenhum plano cadastrado" : "Não informado"}
        opcoes={planos.map(p => ({ valor: String(p.id), rotulo: rotuloPlano(p) }))}
      />

      <Campo
        label="Número da carteirinha"
        value={ficha.numero_carteirinha ?? ""}
        onChange={(v) => setFicha({ numero_carteirinha: v || null })}
        disabled={disabled}
        dica="Carteirinha do plano de saúde, digitada aqui — não é a do convênio que fatura a sessão."
      />
    </Secao>
  )
}
