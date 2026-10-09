"use client"

import { useCallback, useEffect, useState } from "react"
import { AlertCircle, AlertTriangle, FileSignature, Plus } from "lucide-react"
import { hojeBrasilia } from "@/lib/contratos/status"
import {
  buscarContratosDoPaciente,
  ErroContratos,
  type ContratosDoPaciente,
} from "@/services/pacienteContratos.service"
import type { ContratoPaciente } from "@/types/contratosPaciente"
import { foco } from "../ui/campos"
import { DetalheContratoPainel } from "./contratos/DetalheContratoPainel"
import { ListaContratos } from "./contratos/ListaContratos"
import { NovoContratoPainel } from "./contratos/NovoContratoPainel"

// Aba "Contratos": Avaliação Neuropsicológica, Terapias e Técnico Terapêutico
// Particular — início, vencimento e se foi assinado.
//
// Fica FORA do fluxo Editar/Salvar do cadastro (como Escola e Disponibilidade):
// cada ação grava na hora por RPC e vira um evento na linha do tempo do
// contrato. Nada aqui entra no `dirtyCount` da ficha.
//
// Hoje a assinatura é MANUAL (anexa o PDF, marca "assinado" com a data). A
// integração D4Sign + WhatsApp (fases 3 e 4 do docs/PLANO_CONTRATOS_PACIENTE.md)
// passa a mover o mesmo registro pelo webhook, sem mudar esta tela de forma.
//
// Três estados que não podem se confundir: carregando, falha de leitura (com
// "migração pendente" à parte, em âmbar — o localhost usa o banco de produção)
// e "nenhum contrato".

export function AbaContratos({ pacienteId }: { pacienteId: number }) {
  const [dados, setDados] = useState<ContratosDoPaciente | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<{ mensagem: string; migracao: boolean } | null>(null)
  const [novo, setNovo] = useState(false)
  const [editando, setEditando] = useState<ContratoPaciente | null>(null)
  const [abertoId, setAbertoId] = useState<number | null>(null)

  const carregar = useCallback(async () => {
    setErro(null)
    try {
      setDados(await buscarContratosDoPaciente(pacienteId))
    } catch (e) {
      setErro({
        mensagem:
          e instanceof ErroContratos
            ? e.message
            : "Não foi possível consultar os contratos. Isto é uma falha de leitura, não quer dizer que o paciente não tenha contrato.",
        migracao: e instanceof ErroContratos && e.migracaoPendente,
      })
    } finally {
      setCarregando(false)
    }
  }, [pacienteId])

  useEffect(() => {
    setCarregando(true)
    void carregar()
  }, [carregar])

  const hoje = hojeBrasilia()
  // O painel lê do estado recarregado, não de uma cópia: depois de uma ação, o
  // detalhe já mostra o status e o evento novos.
  const aberto = abertoId !== null ? dados?.contratos.find((c) => c.id === abertoId) ?? null : null

  if (carregando) {
    return (
      <div className="min-w-0 flex-1 rounded-lg border border-border bg-card px-4 py-4">
        <div className="space-y-3">
          <div className="h-4 w-48 animate-pulse rounded bg-muted" />
          <div className="h-16 animate-pulse rounded bg-muted" />
          <div className="h-16 animate-pulse rounded bg-muted" />
        </div>
      </div>
    )
  }

  if (erro || !dados) {
    const migracao = erro?.migracao
    return (
      <div className="min-w-0 flex-1 rounded-lg border border-border bg-card px-4 py-4">
        <div
          role="alert"
          className={`rounded-md border px-3 py-3 text-sm ${
            migracao
              ? "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300"
              : "border-destructive/40 bg-destructive/10 text-destructive"
          }`}
        >
          <div className="flex items-start gap-2">
            {migracao ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            ) : (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            )}
            <span>{erro?.mensagem ?? "Não foi possível consultar os contratos."}</span>
          </div>
          {!migracao && (
            <button
              type="button"
              onClick={() => {
                setCarregando(true)
                void carregar()
              }}
              className={`mt-3 rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted ${foco}`}
            >
              Tentar novamente
            </button>
          )}
        </div>
      </div>
    )
  }

  const botaoNovo = (
    <button
      type="button"
      onClick={() => setNovo(true)}
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 sm:min-h-0 ${foco}`}
    >
      <Plus className="h-4 w-4" aria-hidden="true" />
      Novo contrato
    </button>
  )

  return (
    <div className="min-w-0 flex-1 space-y-4">
      {dados.contratos.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-4 py-10 text-center">
          <FileSignature className="mx-auto h-8 w-8 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
          <p className="mt-3 text-sm font-medium text-foreground">Nenhum contrato registrado</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Registre o contrato de Avaliação Neuropsicológica, Terapias ou Técnico Terapêutico Particular, com início, vencimento e assinatura.
          </p>
          <div className="mt-4">{botaoNovo}</div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">Contratos</h2>
              <p className="text-sm text-muted-foreground">
                Status da assinatura e vigência de cada contrato. Clique para ver o detalhe e o histórico.
              </p>
            </div>
            {botaoNovo}
          </div>
          <ListaContratos contratos={dados.contratos} hoje={hoje} onAbrir={(c) => setAbertoId(c.id)} />
        </>
      )}

      {(novo || editando) && (
        <NovoContratoPainel
          pacienteId={pacienteId}
          editando={editando ?? undefined}
          onFechar={() => {
            setNovo(false)
            setEditando(null)
          }}
          onSalvo={(c) => {
            setNovo(false)
            setEditando(null)
            setAbertoId(c.id)
            void carregar()
          }}
        />
      )}

      {aberto && !editando && (
        <DetalheContratoPainel
          key={aberto.id}
          contrato={aberto}
          eventos={dados.eventos.get(aberto.id) ?? []}
          signatarios={dados.signatarios.get(aberto.id) ?? []}
          pacienteId={pacienteId}
          onFechar={() => setAbertoId(null)}
          onEditar={() => setEditando(aberto)}
          onMudou={carregar}
        />
      )}
    </div>
  )
}
