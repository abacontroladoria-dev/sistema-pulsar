import {
  ROTULO_STATUS,
  ROTULO_VIGENCIA,
  TOM_STATUS,
  TOM_VIGENCIA,
  type StatusContrato,
  type Vigencia,
} from "@/lib/contratos/status"

// Os dois selos de um contrato — um por eixo. Usados na aba Contratos e na
// Status Contratos: o mesmo contrato tem a mesma cara nas duas telas.
//
// O selo de vigência some quando o contrato está cancelado: "Cancelado ·
// Vigente" leria como "está valendo", e não está.

const base = "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold"

export function SeloStatus({ status }: { status: StatusContrato }) {
  return <span className={`${base} ${TOM_STATUS[status]}`}>{ROTULO_STATUS[status]}</span>
}

export function SeloVigencia({ vigencia }: { vigencia: Vigencia }) {
  return <span className={`${base} ${TOM_VIGENCIA[vigencia]}`}>{ROTULO_VIGENCIA[vigencia]}</span>
}

export function SelosContrato({ status, vigencia }: { status: StatusContrato; vigencia: Vigencia }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <SeloStatus status={status} />
      {status !== "cancelado" && <SeloVigencia vigencia={vigencia} />}
    </span>
  )
}
