-- =============================================================================
-- APLICAR NO SQL EDITOR -- o adiantamento para de ser apagado por escrita cega
-- =============================================================================
-- O CASO
--
-- Sessão de Davi Lucas (11579) agendada para 16/09 08:00 e ATENDIDA em 15/09.
-- A recepção lançou falta na quarta; a Luana lançou o adiantamento por cima em
-- 16/09 14:51:34, gravando os quatro campos de uma vez (marcar_sessao_adiantada,
-- 20260916120000:146-149).
--
-- Em 17/09 11:37:33 -- ~21h depois -- `data_atendimento_real` virou null.
-- Os outros três campos do MESMO update sobreviveram intactos:
--
--   adiantada_justificativa  preservada (o texto inteiro)
--   adiantada_por_nome       preservado ('Luana Calixto')
--   adiantada_em             preservado (16/09 14:51:34)
--   data_atendimento_real    ZERADO
--
-- Três de quatro intactos descarta reescrita de linha e descarta
-- desfazer_sessao_adiantada, que limpa os quatro juntos e teria sido recusada
-- pela guarda do vínculo (o vínculo existe e está ativo). Nenhum código deste
-- repositório zera essa coluna isoladamente -- procurado em migrations, frontend
-- e rotas de API. A assinatura é de escrita externa campo-a-campo (sync TiTa),
-- que manda null porque a origem não tem o conceito de data real.
--
-- CONSEQUÊNCIA, que é o que justifica a trigger
--
-- Com a coluna nula a sessão volta a ser falta para o anti-join de
-- get_auditoria_assim_periodo (20260916130100:69-85) e SOME da Conferência de
-- quarta -- a célula fica vazia. Não aparece nas faltas tampouco, porque
-- tipo_falta é null e get_faltas_auditoria_assim exige paciente/terapeuta. Uma
-- sessão atendida, vinculada a uma guia e faturável fica invisível em todas as
-- telas. É pior que uma falta visível: ninguém audita o que não vê.
--
-- E o adiantamento não é refazível pela tela: marcar_sessao_adiantada exige
-- `status = 'falta'` (cláusula do UPDATE, :167) e a linha está em 'cancelado'.
--
-- O DESENHO
--
-- A trigger não impede o campo de ser limpo -- desfazer_sessao_adiantada precisa
-- fazer isso. Ela impede que ele seja limpo SOZINHO, deixando para trás um
-- adiantamento pela metade. Quem desfaz de verdade limpa `adiantada_em` no mesmo
-- UPDATE e passa reto.
--
-- Escolhido RAISE em vez de restaurar o valor calado: um sync que apaga dado de
-- faturamento precisa aparecer, não ser absorvido. O erro nomeia o autor provável
-- e o que fazer.
-- =============================================================================

-- ── 1. ANTES: a foto do estrago (guarde o resultado) ────────────────────────
select id, data_atendimento, horario, tuss,
       data_atendimento_real, adiantada_em, adiantada_por_nome,
       status, status_assim, tipo_falta, updated_at
from public.fila_autorizacoes
where adiantada_em is not null
  and data_atendimento_real is null;
-- Esperado hoje: 1 linha (Davi Lucas). Se vierem várias, o apagamento é
-- sistemático e TODAS precisam de restauração -- me avise antes de seguir.


-- ── 2. A PROTEÇÃO ───────────────────────────────────────────────────────────
create or replace function public.fn_protege_adiantamento()
returns trigger
language plpgsql
as $$
begin
  -- Só o caso exato: a data sai, mas o registro do adiantamento fica. Desfazer
  -- de verdade limpa adiantada_em junto (20260916120000:238-241) e não cai aqui.
  if old.data_atendimento_real is not null
     and new.data_atendimento_real is null
     and new.adiantada_em is not null then
    raise exception
      'Tentativa de apagar data_atendimento_real (%) da sessão % mantendo o adiantamento de % por %. Para desfazer use desfazer_sessao_adiantada(); para sincronizar, exclua esta coluna do payload.',
      old.data_atendimento_real, old.id, old.adiantada_em, old.adiantada_por_nome
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protege_adiantamento on public.fila_autorizacoes;

create trigger trg_protege_adiantamento
  before update on public.fila_autorizacoes
  for each row
  when (old.data_atendimento_real is distinct from new.data_atendimento_real)
  execute function public.fn_protege_adiantamento();

comment on function public.fn_protege_adiantamento() is
  'Recusa UPDATE que zera data_atendimento_real deixando adiantada_em preenchido. Existe porque em 17/09 uma escrita externa apagou só essa coluna de uma sessão adiantada (fila 8979a1f4), preservando as outras três, e a sessão sumiu da Conferência sem virar falta. Não bloqueia desfazer_sessao_adiantada, que limpa os quatro campos no mesmo UPDATE.';


-- ── 3. A RESTAURAÇÃO ────────────────────────────────────────────────────────
-- Só depois da trigger existir: assim, se o autor voltar a apagar, ele falha em
-- vez de desfazer isto calado.
--
-- A data vem da justificativa da própria Luana ("A sessão foi adiantada um dia
-- antes") e do card de terça, que mostra a autorização 214400 às 08:26 de 15/09.
-- O vínculo da guia JÁ existe e aponta para o bloco de 16/09 -- restaurar a data
-- não o move nem o recria.

update public.fila_autorizacoes
set data_atendimento_real = '2026-09-15'
where id = '8979a1f4-9737-4588-b78e-f9bfdf217ba1'
  and data_atendimento_real is null    -- não atropela se algo já corrigiu
  and adiantada_em is not null;        -- e só se o adiantamento ainda consta

-- Esperado: UPDATE 1


-- ── 4. DEPOIS: prove os três efeitos ────────────────────────────────────────
-- (a) a linha voltou ao estado que a Luana gravou:
select id, data_atendimento, data_atendimento_real, adiantada_por_nome, adiantada_em
from public.fila_autorizacoes
where id = '8979a1f4-9737-4588-b78e-f9bfdf217ba1';
-- Esperado: data_atendimento_real = 2026-09-15

-- (b) a sessão REAPARECE na Conferência de quarta, que é o pedido da gestora:
select bloco_id, hora_inicial, codigo_tuss, situacao, guia, data_atendimento_real
from public.get_auditoria_assim('2026-09-16')
where bloco_id like '11579!_%' escape '!';
-- Esperado: 1 linha, bloco 11579_2026-09-16_22070435_08:00:00

-- (c) a trigger morde. Este UPDATE DEVE falhar com 23514 -- é o teste dela:
--     (rode solto para ver o erro; ele não altera nada ao falhar)
-- update public.fila_autorizacoes set data_atendimento_real = null
-- where id = '8979a1f4-9737-4588-b78e-f9bfdf217ba1';
