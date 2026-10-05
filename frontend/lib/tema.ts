// Rotas que ignoram o tema salvo e são SEMPRE claras.
//
// São as telas públicas, abertas por link por quem não tem conta: o responsável
// que recebe a ficha escolar pelo WhatsApp. Elas pintam cores fixas em estilo
// inline, e estilo inline não é alcançado pelo shim de `.dark` do globals.css
// (que remapeia `.bg-white` para a superfície escura). O resultado de deixar o
// tema escuro entrar seria um cartão quase preto com o texto continuando
// escuro em cima — ilegível, para alguém sem meio nenhum de descobrir por quê,
// já que o tema foi salvo em outra visita ao domínio.
//
// Quem realmente impede a piscada é o script pré-hidratação do app/layout.tsx,
// que roda antes da primeira pintura. Esta constante existe para o efeito da
// página cobrir o outro caminho (navegação client-side, em que o script não roda
// de novo) sem que as duas cópias da regra saiam de sincronia.
//
// O `<script>` do layout NÃO consegue importar daqui: ele é uma string embutida
// no HTML, avaliada antes de qualquer bundle carregar. Ao mexer aqui, ajuste
// também o regex literal em app/layout.tsx.
export const ROTAS_SEMPRE_CLARAS = ['/ficha-escolar', '/disponibilidade-paciente'] as const

/** A rota é uma das sempre-claras? Casa a própria rota e o que estiver abaixo dela. */
export function rotaSempreClara(caminho: string): boolean {
  return ROTAS_SEMPRE_CLARAS.some(
    (rota) => caminho === rota || caminho.startsWith(`${rota}/`)
  )
}
