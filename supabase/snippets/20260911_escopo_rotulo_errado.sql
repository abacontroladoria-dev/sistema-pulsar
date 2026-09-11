-- =============================================================================
-- Quantos rótulos a correção conserta — o alcance real, medido
-- =============================================================================
-- Só LÊ.
--
-- O bloco 7 do diagnóstico revelou que o `8-` era a ponta do problema: em
-- 01/09/2026, 7 das 264 linhas exibiam um rótulo que a ASSIM desmente, e 4 delas
-- eram `9-FACIAL` lidas como 'QR Code' — nada a ver com o bug original, a mesma
-- precedência invertida mentindo em outro código.
--
-- Estas consultas dimensionam isso no mês inteiro, para você saber o tamanho
-- ANTES de aplicar (e para avisar a operação, que vê esses rótulos todo dia).

-- ---------------------------------------------------------------------------
-- 1. De-para: o que a tela diz HOJE vs. o que a ASSIM respondeu (mês)
-- ---------------------------------------------------------------------------
-- Lê a fila (intenção da recepção, que é o que a tela mostra hoje) contra o
-- relatório (resposta da ASSIM, que é o que ela vai passar a mostrar).
select
  f.forma_autorizacao                                              as rotulo_hoje,
  public.forma_validacao_do_biofacial(aa.biofacial, aa.teve_token) as rotulo_novo,
  count(*)                                                         as linhas
from public.autorizacoes_assim aa
join public.fila_autorizacoes f
  on  f.numero_autorizacao = aa.guia
  and f.data_atendimento   = date(aa.data_execucao)
where date(aa.data_execucao) >= date_trunc('month', current_date)
  and public.forma_validacao_do_biofacial(aa.biofacial, aa.teve_token) is not null
  and public.forma_validacao_do_biofacial(aa.biofacial, aa.teve_token)
      is distinct from f.forma_autorizacao
group by 1, 2
order by 3 desc;

-- ---------------------------------------------------------------------------
-- 2. Proporção: de todas as linhas com resposta da ASSIM, quantas mentem?
-- ---------------------------------------------------------------------------
-- Dá o denominador que o bloco 1 não dá. Se `pct_erradas` for alto, a tela vem
-- mentindo há tempo e vale avisar a operação com antecedência.
select
  count(*)                                                          as com_resposta_da_assim,
  count(*) filter (
    where public.forma_validacao_do_biofacial(aa.biofacial, aa.teve_token)
          is distinct from f.forma_autorizacao
  )                                                                 as rotulo_errado_hoje,
  round(100.0 * count(*) filter (
    where public.forma_validacao_do_biofacial(aa.biofacial, aa.teve_token)
          is distinct from f.forma_autorizacao
  ) / nullif(count(*), 0), 1)                                       as pct_erradas
from public.autorizacoes_assim aa
join public.fila_autorizacoes f
  on  f.numero_autorizacao = aa.guia
  and f.data_atendimento   = date(aa.data_execucao)
where date(aa.data_execucao) >= date_trunc('month', current_date)
  and public.forma_validacao_do_biofacial(aa.biofacial, aa.teve_token) is not null;

-- ---------------------------------------------------------------------------
-- 3. Vocabulário do biofacial no mês — o que existe de fato
-- ---------------------------------------------------------------------------
-- O vocabulário NÃO é fechado (reference_biofacial_no_extrato_assim). Se
-- aparecer prefixo que `forma_validacao_do_biofacial` não conhece (4, 5, 6, 7 ou
-- novo), ele devolve NULL e o rótulo CAI PARA A FILA — o comportamento de hoje,
-- preservado de propósito. Vale saber quais são.
select
  split_part(btrim(coalesce(biofacial, '')), '-', 1)                as prefixo,
  min(biofacial)                                                    as exemplo,
  count(*)                                                          as linhas,
  count(*) filter (where teve_token)                                as com_token,
  public.forma_validacao_do_biofacial(min(biofacial), false)        as rotulo_sem_token
from public.autorizacoes_assim
where date(data_execucao) >= date_trunc('month', current_date)
group by 1
order by 3 desc;
