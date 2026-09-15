'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  BookOpen,
  Check,
  Copy,
  KeyRound,
  Plug,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react'

import PageHeader from '@/components/PageHeader'

// Referência da API de faltas para parceiros externos.
//
// Esta tela é DELIBERADAMENTE somente leitura: não mostra token, não chama o
// endpoint e não escreve nada. Ela existe para quem vai entregar a API a um dev
// de fora ter o contrato à mão sem abrir o repositório — o token continua
// saindo por canal privado, gerado pelo snippet
// `supabase/snippets/integracao_faltas_provisionar.sql`.
//
// A documentação completa (a que se manda para o parceiro) é a página
// publicada; aqui fica só o essencial e o link.

// Rota INTERNA, não o artifact publicado: o botão precisa abrir uma página do
// próprio Pulsar para o `window.print()` dela funcionar. Impressão só opera
// sobre conteúdo da mesma origem — um documento hospedado fora não pode ser
// impresso a partir daqui, e um <iframe> seria recusado pelo X-Frame-Options.
const DOC_ROTA = '/admin/api/documentacao'
const BASE_URL = 'https://orbitaautomacao.com.br/api'
const ENDPOINT = `${BASE_URL}/integracao/faltas/`

type Param = {
  nome: string
  tipo: string
  padrao: string
  descricao: string
}

const PARAMS: Param[] = [
  { nome: 'desde', tipo: 'ISO 8601', padrao: '—', descricao: 'Só o que mudou depois deste instante. Metade do cursor.' },
  { nome: 'desde_id', tipo: 'inteiro', padrao: '—', descricao: 'Segunda metade do cursor. Sempre junto com `desde`.' },
  { nome: 'limite', tipo: '1–1000', padrao: '500', descricao: 'Tamanho da página.' },
  { nome: 'agendamento_id', tipo: 'lista', padrao: '—', descricao: 'Consulta pontual por agendamento. Até 200.' },
  { nome: 'paciente_id', tipo: 'lista', padrao: '—', descricao: 'Consulta pontual por paciente. Até 200.' },
  { nome: 'data_de', tipo: 'AAAA-MM-DD', padrao: '—', descricao: 'Sessões a partir deste dia, inclusive.' },
  { nome: 'data_ate', tipo: 'AAAA-MM-DD', padrao: '—', descricao: 'Sessões até este dia, inclusive.' },
]

function BotaoCopiar({ texto, rotulo }: { texto: string; rotulo: string }) {
  const [copiado, setCopiado] = useState(false)

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1800)
    } catch {
      // Clipboard bloqueado (contexto não seguro, permissão negada): o valor
      // continua visível e selecionável na tela, então não há o que recuperar.
    }
  }

  return (
    <button
      type="button"
      onClick={copiar}
      aria-label={rotulo}
      className="
        inline-flex items-center gap-1.5 shrink-0
        rounded-md border border-slate-200 bg-white
        px-2 py-1 text-xs font-medium text-slate-600
        hover:bg-slate-50 hover:text-slate-900
        transition-colors cursor-pointer
      "
    >
      {copiado ? (
        <>
          <Check className="h-3.5 w-3.5 text-emerald-600" />
          Copiado
        </>
      ) : (
        <>
          <Copy className="h-3.5 w-3.5" />
          Copiar
        </>
      )}
    </button>
  )
}

export default function ApiIntegracaoShell() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="API"
        subtitle="Integrações de leitura expostas a sistemas parceiros"
        actions={
          <Link
            href={DOC_ROTA}
            className="
              inline-flex items-center gap-2
              rounded-lg bg-slate-800 px-3 py-2
              text-sm font-medium text-white
              hover:bg-slate-700 transition-colors
            "
          >
            <BookOpen className="h-4 w-4" />
            Documentação completa
          </Link>
        }
      />

      {/* ── Faltas ─────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-slate-100 p-2 shrink-0">
            <Plug className="h-5 w-5 text-slate-600" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-slate-800">Faltas</h2>
            <p className="mt-1 text-sm text-slate-500">
              Entrega as faltas registradas no Pulsar para o parceiro lançar no sistema dele.
              A chave é o <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">tita_agendamento_id</code>,
              o mesmo id que ele já recebe da API do TiTa.
            </p>
          </div>
          <span className="
            shrink-0 rounded-md bg-emerald-50 px-2 py-1
            text-xs font-semibold text-emerald-700
          ">
            No ar
          </span>
        </div>

        <div className="mt-5 space-y-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
              Endpoint
            </p>
            <div className="
              flex items-center gap-3
              rounded-lg border border-slate-200 bg-slate-50 px-3 py-2
            ">
              <span className="
                shrink-0 rounded bg-slate-700 px-1.5 py-0.5
                text-[10px] font-bold tracking-wide text-white
              ">
                GET
              </span>
              <code className="flex-1 truncate font-mono text-xs text-slate-700">
                {ENDPOINT}
              </code>
              <BotaoCopiar texto={ENDPOINT} rotulo="Copiar endpoint" />
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
              Autenticação
            </p>
            <div className="
              flex items-center gap-3
              rounded-lg border border-slate-200 bg-slate-50 px-3 py-2
            ">
              <code className="flex-1 truncate font-mono text-xs text-slate-700">
                Authorization: Bearer &lt;token&gt;
              </code>
              <BotaoCopiar texto="Authorization: Bearer " rotulo="Copiar header" />
            </div>
          </div>
        </div>

        {/* A barra final já custou um diagnóstico inteiro: o parceiro tomou 404
            achando que era o token. Fica em destaque aqui também. */}
        <div className="
          mt-4 flex items-start gap-2.5
          rounded-lg border border-amber-200 bg-amber-50 p-3
        ">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-xs leading-relaxed text-amber-900">
            <strong>A barra final é obrigatória</strong>, e vem antes da query string
            (<code className="rounded bg-amber-100 px-1">/faltas/?limite=5</code>). Sem ela o
            Next responde <code className="rounded bg-amber-100 px-1">308</code>, e a maioria
            dos clientes HTTP não repassa o header de autenticação num redirecionamento — o
            sintoma aparece como 404 ou 401, e parece problema de token.
          </p>
        </div>
      </section>

      {/* ── Parâmetros ────────────────────────────────────────── */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <h2 className="text-base font-bold text-slate-800">Parâmetros</h2>
        <p className="mt-1 text-sm text-slate-500">
          Sem filtro, o endpoint sincroniza por cursor. Com qualquer filtro, vira consulta
          pontual e o cursor é ignorado.
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="pb-2 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Parâmetro
                </th>
                <th className="pb-2 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Tipo
                </th>
                <th className="pb-2 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Padrão
                </th>
                <th className="pb-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Para quê
                </th>
              </tr>
            </thead>
            <tbody>
              {PARAMS.map((p) => (
                <tr key={p.nome} className="border-b border-slate-100 last:border-0">
                  <td className="py-2.5 pr-4 align-top">
                    <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">
                      {p.nome}
                    </code>
                  </td>
                  <td className="py-2.5 pr-4 align-top text-xs text-slate-500">{p.tipo}</td>
                  <td className="py-2.5 pr-4 align-top text-xs tabular-nums text-slate-500">
                    {p.padrao}
                  </td>
                  <td className="py-2.5 align-top text-xs leading-relaxed text-slate-600">
                    {p.descricao}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-xs text-slate-500">
          Limite de <strong className="text-slate-700">60 requisições por minuto</strong> por
          token. Ao estourar, a resposta é <code className="rounded bg-slate-100 px-1">429</code>{' '}
          com <code className="rounded bg-slate-100 px-1">Retry-After</code>.
        </p>
      </section>

      {/* ── Token ─────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-slate-100 p-2 shrink-0">
            <KeyRound className="h-5 w-5 text-slate-600" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-800">Token do parceiro</h2>
            <p className="mt-1 text-sm text-slate-500">
              Individual por parceiro, revogável isoladamente, com data de corte própria.
            </p>
          </div>
        </div>

        <ul className="mt-4 space-y-2.5 text-sm text-slate-600">
          <li className="flex gap-2.5">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
            <span>
              Gerar, revogar ou mudar a data de corte:{' '}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
                supabase/snippets/integracao_faltas_provisionar.sql
              </code>
            </span>
          </li>
          <li className="flex gap-2.5">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
            <span>
              O valor em claro aparece <strong>uma única vez</strong>, no retorno do INSERT.
              Não há como recuperá-lo depois — se perder, revogue e gere outro.
            </span>
          </li>
          <li className="flex gap-2.5">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
            <span>
              Entregue por canal privado. Nunca por commit, nunca por e-mail em texto.
            </span>
          </li>
        </ul>

        <div className="
          mt-4 flex items-start gap-2.5
          rounded-lg border border-slate-200 bg-slate-50 p-3
        ">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
          <p className="text-xs leading-relaxed text-slate-600">
            Esta tela é somente leitura e <strong>não exibe nenhum token</strong>. A regra de
            quais colunas saem mora no banco, na view{' '}
            <code className="rounded bg-slate-100 px-1">vw_integracao_faltas</code> — sem CPF,
            carteirinha ou guia.
          </p>
        </div>
      </section>
    </div>
  )
}
