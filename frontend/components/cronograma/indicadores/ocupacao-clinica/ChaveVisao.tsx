"use client"

// ChaveVisao — liga/desliga entre ver as unidades em cartões e compará-las
// numa tabela. Fica colada ao seletor de semana para quem abre a tela notar
// que a comparação existe (como abas à direita, passava despercebida).
// O desenho é o ChaveDupla (também usado no Dashboard de Pacientes).

import { ChaveDupla } from "@/components/cronograma/ui/ChaveDupla"

export type Visao = "unidades" | "comparar"

export function ChaveVisao({ visao, onChange }: { visao: Visao; onChange: (v: Visao) => void }) {
  return (
    <ChaveDupla
      valor={visao}
      esquerda={{ valor: "unidades", rotulo: "Unidades" }}
      direita={{ valor: "comparar", rotulo: "Comparar" }}
      onChange={onChange}
      ariaLabel="Comparar unidades lado a lado"
    />
  )
}
