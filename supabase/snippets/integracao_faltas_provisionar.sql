-- ============================================================
-- Integracao de faltas: runbook do token do parceiro
--
-- Como robo_provisionar.sql, este NAO e um pacote para aplicar de
-- uma vez. E um receituario: cada bloco roda sozinho, quando a
-- situacao pedir.
--
-- REGRA DESTE ARQUIVO
-- O repositorio e PUBLICO. Nada aqui pode ser commitado preenchido.
-- O bloco 1 devolve o token em claro UMA vez: copie do resultado,
-- entregue ao parceiro por canal privado, e NAO salve o arquivo
-- com o valor dentro.
--
-- Depende de: 20260914170000_integracao_faltas_view_e_rpc.sql aplicado.
-- ============================================================


-- ============================================================
-- 1. GERAR O TOKEN DE UM PARCEIRO              [uma vez por parceiro]
-- ============================================================
-- Gera 256 bits aleatorios, guarda so o SHA-256 e devolve o valor em
-- claro uma unica vez. Nao ha como recupera-lo depois — se perder,
-- revogue (bloco 3) e gere outro.
--
-- `data_corte` recorta o historico que o parceiro enxerga. O padrao
-- 2026-09-01 existe porque a chave `tita_agendamento_id` so e confiavel
-- a partir de meados de 2026: em abril ela era nula em 100% das linhas,
-- contra 0,2% em setembro. Mandar o passivo antigo seria mandar linha
-- sem chave, que o parceiro nao tem como casar.

/*
with novo as (
  select 'nome-do-parceiro'::text                        as parceiro,
         encode(extensions.gen_random_bytes(32), 'hex')  as token
)
insert into public.integracao_tokens
       (parceiro, token_hash, escopo, data_corte, expira_em, criado_por_nome, observacao)
select parceiro,
       encode(sha256(convert_to(token, 'UTF8')), 'hex'),
       'faltas',
       date '2026-09-01',
       now() + interval '1 year',   -- null = sem prazo; prefira um prazo
       '<seu nome>',
       '<para que serve / com quem falar>'
  from novo
returning id,
          parceiro,
          data_corte,
          expira_em,
          (select token from novo) as token,
          'ANOTE AGORA - nao aparece de novo' as aviso;
*/

-- Sobre `expira_em`: um token sem prazo vazado vale para sempre ate alguem
-- notar. Com prazo, o pior caso tem fim. Renovar e o bloco 1 de novo (gera
-- token novo) ou um update do prazo:
--   update public.integracao_tokens set expira_em = now() + interval '1 year' where id = <id>;


-- ============================================================
-- 2. INVENTARIO DOS TOKENS                                [consulta]
-- ============================================================

select id,
       parceiro,
       escopo,
       case when revogado_em is not null
            then 'REVOGADO em ' || revogado_em::date
            else 'ativo' end                     as situacao,
       data_corte,
       criado_em::date                           as criado,
       criado_por_nome,
       coalesce(expira_em::text, 'sem prazo') as expira,
       coalesce(ultimo_uso_em::text, 'nunca usou') as ultimo_uso,
       observacao
  from public.integracao_tokens
 order by revogado_em nulls first, criado_em desc;


-- ============================================================
-- 3. REVOGAR                                        [operacao do dia]
-- ============================================================
-- Efeito imediato: a proxima chamada do parceiro e recusada.
-- Irreversivel — para religar, gere token novo no bloco 1.

-- update public.integracao_tokens set revogado_em = now() where id = <id>;


-- ============================================================
-- 4. MUDAR O RECORTE HISTORICO                      [sem migration]
-- ============================================================
-- Para liberar mais passado ao parceiro (ex.: recomecar em julho).
-- Confira antes, no bloco 5 de faltas_integracao_cobertura.sql, quantas
-- linhas daquele periodo estao SEM chave — elas nao serao entregues.

-- update public.integracao_tokens set data_corte = date '2026-07-01' where id = <id>;


-- ============================================================
-- 5. CONFERIR O QUE O PARCEIRO ESTA RECEBENDO          [consulta]
-- ============================================================
-- Le a mesma view que a RPC le, sem o token — para comparar com o que
-- o parceiro diz ter recebido, quando houver divergencia.

select v.*
  from public.vw_integracao_faltas v
 where v.data_atendimento >= (select data_corte
                                from public.integracao_tokens
                               where id = 1)   -- troque pelo id do parceiro
 order by v.atualizado_em desc, v.tita_agendamento_id
 limit 50;
