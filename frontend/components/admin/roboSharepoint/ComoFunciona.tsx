'use client'

import { useState } from 'react'
import {
  ArrowRight, BadgeCheck, ChevronDown, ClipboardCheck, EyeOff, FileSpreadsheet, FileText, Folder, FolderTree,
  Hand, KeyRound, Lightbulb, ListTree, Lock, RefreshCw, ScanSearch, Send, Tags, Workflow,
} from 'lucide-react'

// "Como o robô funciona": o caminho de um arquivo do SharePoint até a tela
// Entregas PEP, desenhado. Não lê nada do banco — é a explicação fixa do que o
// painel abaixo mostra ao vivo. Inspirado no "Caminho de uma autorização" do
// estudo do robô da ASSIM, em forma de linha com estações.

type Estacao = { icone: typeof Folder; titulo: string; texto: string; saida: string }
type Zona = { id: string; titulo: string; sub: string; faixa: string; cresce: string; estacoes: Estacao[] }

const ZONAS: Zona[] = [
  {
    id: 'sharepoint', titulo: 'No SharePoint', sub: 'pastas dos prestadores', faixa: 'bg-slate-50 border-slate-200', cresce: 'xl:grow',
    estacoes: [
      { icone: FolderTree, titulo: 'Repositório', texto: 'Uma pasta por prestador, com Planejamento, Geral e Pacientes', saida: 'pastas e arquivos' },
    ],
  },
  {
    id: 'robo', titulo: 'No robô', sub: 'todo dia às 03:00, ou em “Executar agora”', faixa: 'bg-brand-surface/70 border-brand/25', cresce: 'xl:grow-[5]',
    estacoes: [
      { icone: KeyRound, titulo: 'Autenticar', texto: 'Certificado digital com acesso só a este site, só para ler', saida: 'permissão de leitura' },
      { icone: ListTree, titulo: 'Listar', texto: 'Pergunta à Microsoft o que mudou desde a última leitura', saida: 'nome, pasta, data, autor' },
      { icone: Tags, titulo: 'Classificar', texto: 'O caminho de pastas diz o que cada arquivo é', saida: 'item do PEP' },
      { icone: FileSpreadsheet, titulo: 'Ler planilhas', texto: 'Abre a planilha de planejamento em memória', saida: 'CNPJ, pacientes, CPF' },
      { icone: Send, titulo: 'Enviar', texto: 'Entrega um lote ao Pulsar pela porta estreita do robô', saida: 'um lote' },
    ],
  },
  {
    id: 'pulsar', titulo: 'No Pulsar', sub: 'banco e tela Entregas PEP', faixa: 'bg-slate-50 border-slate-200', cresce: 'xl:grow-[2]',
    estacoes: [
      { icone: ScanSearch, titulo: 'Reconhecer', texto: 'Liga pasta a prestador, pasta a paciente e confere a sessão', saida: 'sugestão' },
      { icone: BadgeCheck, titulo: 'RP confirma', texto: 'A sugestão só vira entrega com o clique de alguém do RP', saida: 'entrega registrada' },
    ],
  },
]

const TODAS = ZONAS.flatMap(z => z.estacoes)
const N = TODAS.length
/** índice global da 1ª estação de cada zona */
const INICIO = ZONAS.map((_, zi) => ZONAS.slice(0, zi).reduce((s, z) => s + z.estacoes.length, 0))
const CICLO = 9 // segundos para o sinal atravessar a linha

// O trilho vai do centro da 1ª estação ao da última (6,25% de cada lado, com
// 8 estações). O sinal anda de -20% a 100% do trilho (largura 20%): o centro
// dele passa pela estação k quando t = CICLO · (k/(N-1) + 0,1) / 1,2.
const atraso = (k: number) => `${(CICLO * ((k / (N - 1)) + 0.1) / 1.2).toFixed(2)}s`
const MARGEM_TRILHO = `${50 / N}%`

const ESTILO = `
@keyframes robo-sinal-x { from { left: -20%; } to { left: 100%; } }
@keyframes robo-acende {
  0%, 16%, 100% { background-color: #fff; border-color: rgb(226 232 240); color: var(--color-brand-fg); }
  4%, 9% { background-color: var(--color-brand-fg); border-color: var(--color-brand-fg); color: #fff; }
}
@keyframes robo-fluxo { to { stroke-dashoffset: -20; } }
.robo-sinal-x { animation: robo-sinal-x ${CICLO}s linear infinite; }
.robo-acende { animation: robo-acende ${CICLO}s linear infinite; }
.robo-fluxo { animation: robo-fluxo 1.2s linear infinite; }
@media (prefers-reduced-motion: reduce) {
  .robo-sinal-x, .robo-acende, .robo-fluxo { animation: none; }
  .robo-sinal-x { display: none; }
}
`

function Marcador({ k, icone: Icone }: { k: number; icone: typeof Folder }) {
  return (
    <span className="relative z-10 flex size-14 shrink-0 items-center justify-center rounded-2xl border-2 border-slate-200 bg-white text-brand-fg robo-acende"
      style={{ animationDelay: atraso(k) }}>
      <Icone className="h-6 w-6" aria-hidden />
      <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-800 px-1 text-[10px] font-bold tabular-nums text-white">
        {k + 1}
      </span>
    </span>
  )
}

/** A linha com as estações: horizontal no computador, vertical no celular. */
function Linha() {
  return (
    <div className="relative">
      {/* trilho + sinal, passando pelo centro dos marcadores (computador) */}
      {/* Topo do marcador = borda 1 + pt-3 12 + cabeçalho 34 + mt-4 16 = 63px;
          centro = 91px; trilho de 3px começa em 89,5. */}
      <div className="pointer-events-none absolute top-[89.5px] hidden h-[3px] overflow-hidden rounded-full bg-slate-200 xl:block" aria-hidden
        style={{ left: MARGEM_TRILHO, right: MARGEM_TRILHO }}>
        <span className="robo-sinal-x absolute inset-y-0 w-[20%] rounded-full"
          style={{ background: 'linear-gradient(90deg, transparent, #3aaa5c 45%, #2A92C0 70%, transparent)' }} />
      </div>

      <ol className="flex flex-col gap-3 xl:flex-row xl:gap-2">
        {ZONAS.map((z, zi) => (
          <li key={z.id} className={`rounded-2xl border px-3 pb-4 pt-3 xl:basis-0 ${z.cresce} ${z.faixa}`}>
            <div className="px-1 xl:h-[34px]">
              <p className="truncate text-[11px] font-bold uppercase leading-[17px] tracking-wider text-slate-700">{z.titulo}</p>
              <p className="truncate text-[11px] leading-[17px] text-slate-500" title={z.sub}>{z.sub}</p>
            </div>
            <ol className="mt-3 flex flex-col gap-4 xl:mt-4 xl:flex-row xl:gap-2">
              {z.estacoes.map((e, i) => {
                const k = INICIO[zi] + i
                return (
                  <li key={e.titulo} className="relative flex min-w-0 flex-1 gap-3 xl:flex-col xl:items-center xl:gap-0 xl:text-center">
                    {/* no celular, um trecho de trilho liga à estação de baixo */}
                    {i < z.estacoes.length - 1 && (
                      <span className="absolute bottom-[-1rem] left-[26.5px] top-14 w-[3px] bg-slate-200 xl:hidden" aria-hidden />
                    )}
                    <Marcador k={k} icone={e.icone} />
                    <div className="min-w-0 xl:mt-3">
                      <p className="text-sm font-bold text-slate-800">{e.titulo}</p>
                      <p className="mt-0.5 text-xs leading-snug text-slate-600">{e.texto}</p>
                      <span className="mt-2 inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                        <ArrowRight className="h-3 w-3 text-brand-fg" aria-hidden />{e.saida}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ol>
          </li>
        ))}
      </ol>
    </div>
  )
}

// ── O que o robô enxerga ─────────────────────────────────────────────────────

type NoArvore = { nome: string; sigla?: string; tipo?: 'planilha' | 'fora' | 'pasta'; filhos?: NoArvore[] }
const ARVORE: NoArvore = {
  nome: 'Prestador de Serviço - Nome (EMPRESA)', tipo: 'pasta', filhos: [
    { nome: '1. Planejamento - Prestador de Serviço', tipo: 'pasta', filhos: [{ nome: 'Planejamento Documentos Técnicos.xlsx', tipo: 'planilha' }] },
    { nome: '2. Geral', tipo: 'pasta', filhos: [
      { nome: '1. Supervisão Técnica ABA do Caso', sigla: 'STC' },
      { nome: '2. Estudo Técnico de Caso', sigla: 'ETC' },
    ] },
    { nome: '3. Pacientes', tipo: 'pasta', filhos: [
      { nome: 'Nome do paciente', tipo: 'pasta', filhos: [
        { nome: '1. Treinamento de Aplicadores ABA', sigla: 'TAP' },
        { nome: '2. Treinamento e Orientação Parental', sigla: 'TOP' },
        { nome: '3. Plano Individualizado Comportamental', sigla: 'PIC' },
        { nome: '4. Relatório de Fechamento Técnico', sigla: 'RT' },
        { nome: '5. Orientação Escolar', sigla: 'OE' },
        { nome: '6. Avaliações Gerais', tipo: 'fora' },
        { nome: '7. Protocolo de Conduta', tipo: 'fora' },
      ] },
    ] },
  ],
}

function Ramo({ no, ultimo, prefixo }: { no: NoArvore; ultimo: boolean; prefixo: boolean[] }) {
  const Icone = no.tipo === 'planilha' ? FileSpreadsheet : Folder
  return (
    <li>
      <div className="flex min-h-8 items-center gap-1.5">
        {prefixo.map((continua, i) => (
          <span key={i} className={`h-8 w-4 shrink-0 ${continua ? 'border-l border-slate-300' : ''}`} aria-hidden />
        ))}
        <span className="relative h-8 w-4 shrink-0" aria-hidden>
          <span className={`absolute left-0 top-0 border-l border-slate-300 ${ultimo ? 'h-4' : 'h-8'}`} />
          <span className="absolute left-0 top-4 w-3 border-t border-slate-300" />
        </span>
        <Icone className={`h-4 w-4 shrink-0 ${no.tipo === 'planilha' ? 'text-emerald-600' : no.tipo === 'fora' ? 'text-slate-300' : 'text-brand-fg'}`} aria-hidden />
        <span className={`min-w-0 truncate text-[13px] ${no.tipo === 'fora' ? 'text-slate-400' : 'text-slate-700'} ${no.filhos ? 'font-semibold' : ''}`}>{no.nome}</span>
        {no.sigla && <span className="ml-auto shrink-0 rounded-md bg-sky-50 px-1.5 py-0.5 text-[10px] font-black text-sky-700 ring-1 ring-sky-200">{no.sigla}</span>}
        {no.tipo === 'planilha' && <span className="ml-auto shrink-0 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200">planilha</span>}
        {no.tipo === 'fora' && <span className="ml-auto shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">fora do PEP</span>}
      </div>
      {no.filhos && (
        <ul>
          {no.filhos.map((f, i) => <Ramo key={f.nome} no={f} ultimo={i === no.filhos!.length - 1} prefixo={[...prefixo, !ultimo]} />)}
        </ul>
      )}
    </li>
  )
}

function OQueEnxerga() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <p className="flex items-center gap-2 text-sm font-bold text-slate-800"><FolderTree className="h-4 w-4 text-brand-fg" aria-hidden /> O que o robô enxerga</p>
      <p className="mt-1 text-xs text-slate-500">A pasta onde o arquivo está define o item do PEP. O robô não abre PDF nenhum.</p>
      <div className="mt-3 overflow-x-auto">
        <ul className="min-w-[22rem]">
          <li>
            <div className="flex min-h-8 items-center gap-1.5">
              <Folder className="h-4 w-4 shrink-0 text-brand-fg" aria-hidden />
              <span className="truncate text-[13px] font-bold text-slate-800">{ARVORE.nome}</span>
            </div>
            <ul>{ARVORE.filhos!.map((f, i) => <Ramo key={f.nome} no={f} ultimo={i === ARVORE.filhos!.length - 1} prefixo={[]} />)}</ul>
          </li>
        </ul>
      </div>
    </div>
  )
}

// ── Os 3 sinais ──────────────────────────────────────────────────────────────

const SINAIS = [
  { icone: ClipboardCheck, titulo: 'Prestador', de: 'CNPJ da planilha', para: 'Contratos do Pulsar' },
  { icone: FileText, titulo: 'Paciente', de: 'CPF + nome da planilha', para: 'Cadastro de pacientes' },
  { icone: RefreshCw, titulo: 'Sessão no mês', de: 'Coordenador de Caso', para: 'Grade do TiTa' },
]

function TresSinais() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <p className="flex items-center gap-2 text-sm font-bold text-slate-800"><ScanSearch className="h-4 w-4 text-brand-fg" aria-hidden /> Como um arquivo vira sugestão</p>
      <p className="mt-1 text-xs text-slate-500">Os três sinais precisam bater. Faltando um, o arquivo vai para “Não reconhecidos”, com o motivo.</p>

      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_4.5rem_minmax(0,0.8fr)] sm:gap-0">
        <ul className="grid gap-2.5 sm:grid-rows-3">
          {SINAIS.map(s => (
            <li key={s.titulo} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-2.5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white text-brand-fg ring-1 ring-slate-200"><s.icone className="h-5 w-5" aria-hidden /></span>
              <span className="min-w-0">
                <span className="block text-[13px] font-bold text-slate-800">{s.titulo}</span>
                <span className="flex flex-wrap items-center gap-1 text-[11px] text-slate-600">
                  {s.de} <ArrowRight className="h-3 w-3 text-slate-400" aria-hidden /> {s.para}
                </span>
              </span>
            </li>
          ))}
        </ul>

        {/* as três linhas convergindo */}
        <div className="relative hidden sm:block" aria-hidden>
          <svg viewBox="0 0 100 300" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
            {['M0 50 C 55 50, 45 150, 100 150', 'M0 150 L 100 150', 'M0 250 C 55 250, 45 150, 100 150'].map(d => (
              <g key={d}>
                <path d={d} fill="none" stroke="rgb(226 232 240)" strokeWidth="3" vectorEffect="non-scaling-stroke" />
                <path d={d} fill="none" stroke="#2A92C0" strokeWidth="2" strokeDasharray="4 16" strokeLinecap="round" vectorEffect="non-scaling-stroke" className="robo-fluxo" />
              </g>
            ))}
          </svg>
        </div>

        <div className="flex items-center">
          <div className="w-full overflow-hidden rounded-2xl border border-sky-200 bg-sky-50">
            <div className="h-1 w-full" style={{ background: 'linear-gradient(90deg,#3aaa5c,#2A92C0)' }} />
            <div className="p-3 text-center">
              <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-white text-sky-700 ring-1 ring-sky-200"><Lightbulb className="h-6 w-6" aria-hidden /></span>
              <p className="mt-2 text-sm font-black text-slate-800">Sugestão</p>
              <p className="text-[11px] leading-snug text-slate-600">aparece na Entregas PEP, esperando o RP</p>
              <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200">
                <BadgeCheck className="h-3 w-3" aria-hidden /> RP confirma → entrega
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Garantias ────────────────────────────────────────────────────────────────

const GARANTIAS = [
  { icone: Lock, titulo: 'Só lê', texto: 'Não altera, move nem apaga nada no SharePoint' },
  { icone: EyeOff, titulo: 'CPF nunca aparece', texto: 'A tela mostra só se ele é válido' },
  { icone: FileSpreadsheet, titulo: 'Nada em disco', texto: 'A planilha é lida em memória e descartada' },
  { icone: Hand, titulo: 'Uma pessoa decide', texto: 'Nada vira entrega sem o RP confirmar' },
  { icone: RefreshCw, titulo: 'Leve', texto: 'Só busca o que mudou; o Pulsar mal percebe' },
]

export function ComoFunciona() {
  const [aberto, setAberto] = useState(true)
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]" aria-labelledby="titulo-como-funciona">
      <style>{ESTILO}</style>
      <div className="h-1 w-full" style={{ background: 'linear-gradient(90deg,#3aaa5c,#2A92C0)' }} />
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="titulo-como-funciona" className="flex items-center gap-2 text-base font-bold text-slate-800">
            <Workflow className="h-4 w-4 text-brand-fg" aria-hidden /> Como o robô funciona
          </h2>
          <button type="button" onClick={() => setAberto(a => !a)} aria-expanded={aberto}
            className="inline-flex min-h-11 items-center gap-1 rounded-xl px-3 text-sm font-medium text-brand-fg hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
            {aberto ? 'Recolher' : 'Mostrar'}
            <ChevronDown className={`h-4 w-4 transition-transform motion-reduce:transition-none ${aberto ? 'rotate-180' : ''}`} aria-hidden />
          </button>
        </div>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          O caminho de um documento, da pasta do prestador no SharePoint até a tela Entregas PEP. Cada número abaixo é uma etapa que aparece, com o tempo que levou, em “Resultado da última leitura”.
        </p>

        {aberto && (
          <div className="mt-5 space-y-4">
            <Linha />
            <div className="grid gap-4 xl:grid-cols-2">
              <OQueEnxerga />
              <TresSinais />
            </div>
            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
              {GARANTIAS.map(g => (
                <li key={g.titulo} className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                  <g.icone className="mt-0.5 h-4 w-4 shrink-0 text-brand-fg" aria-hidden />
                  <span>
                    <span className="block text-[13px] font-bold text-slate-800">{g.titulo}</span>
                    <span className="block text-[11px] leading-snug text-slate-600">{g.texto}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}
