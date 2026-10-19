"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Drawer } from "@/components/cronograma/ui/Drawer"
import { StatusChip } from "@/components/ui/tones"
import { formatarData, formatarHorario, normalizarDescricao, registroDoProfissional } from "@/lib/exportarEvolucoes/formato"
import { ErroExportacao, lerConteudo } from "@/services/exportar-evolucoes.service"
import type { EvolucaoConteudo, EvolucaoItem } from "@/types/exportarEvolucoes"
import { ROTULO_ORIGEM } from "./CardEvolucao"

// Texto completo de uma evolução. Abrir conta como leitura (finalidade
// "visualizacao") e fica no registro, como o PDF e o CSV.

export function PainelEvolucao({ item, onClose }: { item: EvolucaoItem; onClose: () => void }) {
  // Resultado da tentativa N; enquanto não chega, "Abrindo…". O pai monta um
  // painel por evolução (key), então não há resultado de outra para limpar.
  const [tentativa, setTentativa] = useState(0)
  const [resultado, setResultado] = useState<{ tentativa: number; conteudo?: EvolucaoConteudo; erro?: string } | null>(null)

  useEffect(() => {
    let vivo = true
    lerConteudo([item.chave], "visualizacao")
      .then(([c]) => vivo && setResultado(c ? { tentativa, conteudo: c } : { tentativa, erro: "Esta evolução não está mais disponível." }))
      .catch(e => vivo && setResultado({ tentativa, erro: e instanceof ErroExportacao ? e.message : "Não foi possível abrir a evolução." }))
    return () => {
      vivo = false
    }
  }, [item.chave, tentativa])

  const atual = resultado?.tentativa === tentativa ? resultado : null
  const conteudo = atual?.conteudo ?? null
  const erro = atual?.erro ?? null

  const registro = conteudo ? registroDoProfissional(conteudo) : ""

  return (
    <Drawer
      title={item.paciente_nome}
      subtitle={`${formatarData(item.data)} · ${formatarHorario(item.hora_inicio, item.hora_fim)}`}
      width={520}
      onClose={onClose}
    >
      <div className="space-y-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[14px]">
          <dt className="text-muted-foreground">Terapia</dt>
          <dd className="font-semibold text-foreground">{item.terapia}</dd>
          <dt className="text-muted-foreground">Profissional</dt>
          <dd className="text-foreground">
            {item.profissional_nome}
            {registro && <span className="block text-[12px] text-muted-foreground">{registro}</span>}
            {item.substituicao && <StatusChip tone="blue" dense className="mt-1">substituição</StatusChip>}
          </dd>
          {item.convenio && (
            <>
              <dt className="text-muted-foreground">Convênio</dt>
              <dd className="text-foreground">{item.convenio}</dd>
            </>
          )}
          <dt className="text-muted-foreground">Origem</dt>
          <dd><StatusChip tone="gray" dense>{ROTULO_ORIGEM[item.origem]}</StatusChip></dd>
          {conteudo?.registrado_por_nome && (
            <>
              <dt className="text-muted-foreground">Registrado por</dt>
              <dd className="text-foreground">{conteudo.registrado_por_nome}</dd>
            </>
          )}
        </dl>

        <section aria-live="polite">
          <h3 className="mb-1.5 text-[13px] font-semibold text-foreground">Descrição</h3>
          {conteudo ? (
            <p className="whitespace-pre-wrap break-words rounded-xl border border-border bg-muted/30 p-3 text-[14px] leading-relaxed text-foreground">
              {normalizarDescricao(conteudo.descricao)}
            </p>
          ) : erro ? (
            <div className="space-y-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-[14px] text-rose-800 dark:border-rose-800/60 dark:bg-rose-950/30 dark:text-rose-200">
              <p>{erro}</p>
              <button
                type="button"
                onClick={() => setTentativa(t => t + 1)}
                className="min-h-11 rounded-lg border border-rose-300 bg-white px-3 text-[13px] font-semibold text-rose-800 hover:bg-rose-50 dark:border-rose-700 dark:bg-transparent dark:text-rose-200"
              >
                Tentar de novo
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[14px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Abrindo…
            </div>
          )}
        </section>
      </div>
    </Drawer>
  )
}
