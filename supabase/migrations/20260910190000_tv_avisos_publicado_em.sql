-- `publicado_em`: a distinção entre "nunca foi ao ar" e "já foi e saiu".
--
-- ─── O problema ──────────────────────────────────────────────────────────────
--
-- No banco, rascunho e aposentado são a mesma coisa: `ativo = false`. A tela de
-- gestão precisava separá-los para não oferecer "publicar" a um cartaz que
-- alguém tirou do ar de propósito, e resolveu isso com um Set em memória —
-- quem esteve ativo DURANTE ESTA SESSÃO é aposentado, o resto é rascunho.
--
-- Isso funciona até o F5. Depois de recarregar, todo cartaz fora do ar volta a
-- se declarar "Nunca publicada", inclusive os de julho. O rótulo está presente
-- quando o risco é baixo (a pessoa acabou de mexer, lembra do que fez) e some
-- justamente quando o risco é alto (voltou semanas depois e não lembra).
--
-- Uma tela que afirma com confiança algo que a pessoa sabe ser falso perde a
-- credibilidade de tudo o mais que ela diz.
--
-- ─── A escolha ───────────────────────────────────────────────────────────────
--
-- Timestamp e não boolean: "já foi publicado" é o que a UI precisa hoje, mas a
-- data responde à pergunta seguinte, que é "isso é da campanha de qual mês?" —
-- e um boolean não teria como respondê-la depois sem outra migration.
--
-- Guarda a PRIMEIRA publicação, não a última. A pergunta é "este cartaz já
-- esteve na parede?", e essa resposta não muda quando ele volta. Por isso o
-- trigger abaixo usa `coalesce(old.publicado_em, now())`: republicar não
-- reescreve a data original.

alter table public.tv_avisos
  add column if not exists publicado_em timestamptz;

-- ─── Backfill ────────────────────────────────────────────────────────────────
--
-- Só o que está ativo AGORA recebe data. Para esses, `atualizado_em` é o
-- melhor limite superior disponível e a linha está no ar de fato — a afirmação
-- "já foi publicado" é verdadeira mesmo que o instante seja aproximado.
--
-- O que está inativo fica NULL de propósito. Não há como saber, olhando a
-- tabela, se uma linha `ativo = false` é rascunho esquecido ou cartaz
-- aposentado; `atualizado_em` marca a última edição qualquer, não a publicação.
-- Chutar aqui seria trocar uma mentira previsível (tudo vira "nunca publicada"
-- no F5) por uma imprevisível (metade vira "já publicada" sem ter ido ao ar).
--
-- Consequência aceita: cartazes hoje fora do ar continuam se declarando
-- "Nunca publicada" para sempre. Da próxima vez que forem publicados a data
-- passa a existir e nunca mais se perde. O erro se extingue sozinho, em vez de
-- ser espalhado agora por toda a tabela.
update public.tv_avisos
   set publicado_em = atualizado_em
 where ativo
   and publicado_em is null;

-- ─── Manutenção ──────────────────────────────────────────────────────────────
--
-- No mesmo trigger de `atualizado_em`, e não num segundo: dois triggers BEFORE
-- na mesma tabela disputam ordem alfabética, e nada aqui justifica esse risco.
--
-- `is distinct from true` cobre o insert (old é NULL no INSERT, e o operador
-- não explode) e o update vindo de ativo=false. Publicar é a única transição
-- que carimba.
create or replace function public.set_tv_avisos_atualizado()
returns trigger language plpgsql set search_path = public as $$
begin
  new.atualizado_em := now();
  new.atualizado_em_brasilia :=
    to_char(new.atualizado_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI');

  -- Carimba na subida para o ar. `coalesce` preserva a primeira data: um cartaz
  -- que volta em outubro continua dizendo que estreou em agosto.
  if new.ativo and (tg_op = 'INSERT' or old.ativo is distinct from true) then
    new.publicado_em := coalesce(
      case when tg_op = 'UPDATE' then old.publicado_em end,
      new.publicado_em,
      now()
    );
  end if;

  return new;
end;
$$;

comment on column public.tv_avisos.publicado_em is
  'Instante da PRIMEIRA vez que o aviso foi ao ar; NULL significa que nunca esteve. Carimbado pelo trigger na transição para ativo=true e nunca reescrito depois — republicar preserva a data de estreia. Separa "rascunho" de "aposentado", que no resto do schema são ambos ativo=false. Backfill de 20260910190000 preencheu apenas as linhas ativas: as inativas ficaram NULL porque não há como distingui-las retroativamente.';
