'use client'

import { memo, useEffect, useState } from 'react'

export type AvisoTV = {
  id: string
  url: string
}

/**
 * Quanto tempo cada cartaz fica na tela.
 *
 * 12s é o tempo de quem está sentado na sala olhar pra cima, ler e voltar ao
 * celular. Mais curto vira estímulo piscando na periferia de quem espera; mais
 * longo e um cartaz no fim da fila pode não aparecer durante a espera inteira.
 */
export const DURACAO_SLIDE_MS = 12_000

/** Duração do crossfade. Precisa casar com a classe `duration-` do <img>. */
const FADE_MS = 700

/**
 * Carrossel de avisos institucionais.
 *
 * Vive em dois lugares — no estado de ESPERA da TV da recepção (app/tv/page.tsx) e
 * na prévia da tela de gestão (/tv-avisos). É de propósito o MESMO componente:
 * uma prévia que aproxima o comportamento em vez de reproduzi-lo é uma prévia
 * que mente, e quem publica o cartaz não teria como saber.
 *
 * `aria-hidden` no elemento inteiro: na TV isto fica dentro de um <main> com
 * `aria-live="polite"`, e uma imagem trocando a cada 12s viraria anúncio
 * repetido por cima da única coisa que a tela precisa anunciar — o nome de quem
 * está sendo chamado. O texto de espera continua sendo a informação acessível.
 */
export const CarrosselAvisos = memo(function CarrosselAvisos({
  avisos,
  pausado = false,
  duracaoMs = DURACAO_SLIDE_MS,
}: {
  avisos: AvisoTV[]
  /**
   * Congela a rotação. Na TV é ligado enquanto há uma chamada em destaque: o
   * carrossel está fora da tela nesse momento e continuar disparando re-render
   * a cada 12s só rouba trabalho do que importa.
   */
  pausado?: boolean
  duracaoMs?: number
}) {
  const [indice, setIndice] = useState(0)

  // A lista pode encolher (aviso desativado, apagado) enquanto o índice aponta
  // pro fim dela. Sem isto o carrossel ficaria num slide inexistente — tela
  // preta até a próxima virada.
  const seguro = avisos.length > 0 ? indice % avisos.length : 0

  useEffect(() => {
    if (pausado || avisos.length <= 1) return

    const t = setInterval(() => {
      setIndice((i) => (i + 1) % avisos.length)
    }, duracaoMs)

    return () => clearInterval(t)
  }, [pausado, avisos.length, duracaoMs])

  if (avisos.length === 0) return null

  return (
    <div
      aria-hidden="true"
      className="relative w-full h-full overflow-hidden rounded-[28px]"
    >
      {avisos.map((aviso, i) => (
        // Todos os slides ficam montados e empilhados, alternando só a
        // opacidade. Montar/desmontar faria o navegador buscar a imagem de novo
        // a cada volta — na TV, que fica dias aberta, isso é uma requisição a
        // cada 12s pra sempre, e um piscar branco se a rede engasgar.
        <img
          key={aviso.id}
          src={aviso.url}
          alt=""
          // `object-contain`: cartaz não pode ser cortado. O marketing desenha a
          // arte inteira, e um `cover` comeria justamente a borda onde costuma
          // estar o logo ou a data.
          className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-700 ease-out ${
            i === seguro ? 'opacity-100' : 'opacity-0'
          }`}
          style={{ transitionDuration: `${FADE_MS}ms` }}
          // Os dois primeiros com prioridade; o resto entra durante a espera.
          loading={i < 2 ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
        />
      ))}
    </div>
  )
})
