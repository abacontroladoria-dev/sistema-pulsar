import type { Metadata } from 'next'

// A página é client component e não pode exportar `metadata`; este layout existe
// só para isso. O endereço circula por WhatsApp e pode acabar colado num lugar
// público: o formulário de uma clínica de saúde não deve aparecer em busca.
export const metadata: Metadata = {
  title: 'Disponibilidade para atendimento — Universo ABA',
  robots: { index: false, follow: false },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
