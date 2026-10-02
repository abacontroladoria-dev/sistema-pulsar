'use client'

// TEMPORÁRIO — prévia visual com dados fictícios. NÃO COMMITAR.
import { PainelVisaoGeralPep } from '@/components/cronograma/remuneracao/pep/VisaoGeralPep'
import type { AnalistaPep, ResumoPep } from '@/lib/remuneracao/visaoGeralPep'

const sit = (o: Partial<NonNullable<AnalistaPep['situacao']>> = {}) => ({
  unidadesFaltando: 0, semestraisVencidas: 0, semestraisPorItem: {}, sugestoesEsperando: 0, conferido: null, conferenciaInvalidada: false, ...o,
})
const a = (nome: string, pac: number, apurado: number, status: AnalistaPep['status'], extra: Partial<AnalistaPep> = {}): AnalistaPep => ({
  nome, pacientes: pac, teto: pac * 150, bruto: apurado, apurado, descontos: 0, naoApurado: pac * 150 - apurado,
  pctTeto: (apurado / (pac * 150)) * 100, valorRobo: apurado * 0.6, valorHumano: apurado * 0.4, pacientesSemApuracao: [],
  status, situacao: sit(), ...extra,
})
const porAnalista = [
  a('Thalia Ferreira Gomes', 12, 1200, 'faltam_entregas', { situacao: sit({ unidadesFaltando: 3, sugestoesEsperando: 2 }) }),
  a('Janine Lopes', 9, 900, 'faltam_entregas', { situacao: sit({ semestraisVencidas: 1 }), pacientesSemApuracao: ['x', 'y'] }),
  a('Willian Drumond', 15, 2250, 'entregas_completas'),
  a('Lorena Corrêa', 18, 2700, 'conferido', { situacao: sit({ conferido: { por: 'Ana Paula', em: '2026-09-30T12:00:00Z' } }) }),
  a('Isabela Suzana', 19, 2850, 'liberado'),
]
const r: ResumoPep = {
  competencia: '2026-09', modoTeste: false, valorPorPaciente: 150, analistas: 5, pacientes: 73,
  pacientesPorAnalista: { media: 14.6, min: 9, max: 19 }, teto: 10950, apurado: 9900,
  descontos: { total: 450, recorrentes: 300, semestrais: 150, saldoAnterior: 0, devolucao: 0 }, naoApurado: 600,
  origem: { robo: 6200, humano: 4150, ajustes: -450 }, pacientesNaoApurados: 4,
  porStatus: { faltam_entregas: 2, entregas_completas: 1, conferido: 1, liberado: 1, sem_dados: 0 },
  porAnalista, foraDaGrade: [{ prestador: 'Pedro Igor', paciente: 'Enzo Gabriel', valorLiquido: 150 }],
}

export default function Page() {
  return (
    <div className="min-h-screen bg-brand-bg p-4 sm:p-8 dark:bg-background">
      <div className="mx-auto max-w-[1180px]">
        <PainelVisaoGeralPep competencia="2026-09" valorPorPaciente={150} r={r} acerto={94} loading={false} erro={null} onSelecionar={() => {}}
          idx={{ roboAprovou: 50, roboVigentes: 47, pessoaAprovou: 31, pessoaDesfez: 3, segue: 81, fora: 12, repetidos: 4 }} />
      </div>
    </div>
  )
}
