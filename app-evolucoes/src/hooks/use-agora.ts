import { useEffect, useState } from 'react';

/**
 * Relógio que avança a cada 30 s, como a Grade web: a sessão passa de azul
 * (futuro) para amarelo (sem registro) sem precisar recarregar a tela.
 */
export function useAgora(intervaloMs = 30_000): Date {
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setAgora(new Date()), intervaloMs);
    return () => clearInterval(id);
  }, [intervaloMs]);
  return agora;
}
