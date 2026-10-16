-- Backfill da tag "Não-paciente | Trabalhe conosco" (16/10/2026)
--
-- O código novo (frontend/modules/atendimento/agente/tipo-contato.ts) aplica a
-- tag nas mensagens que CHEGAREM a partir do deploy. Este snippet cuida das
-- conversas que já existem — a de 5521983978283 (a psicóloga que mandou o
-- currículo) e qualquer outra igual.
--
-- Mesma regra do código: só sinais fortes (currículo, CV, "trabalhe conosco",
-- "trabalhar com vocês", vaga/oportunidade de emprego ou estágio, processo
-- seletivo), só mensagem da PESSOA (inbound), e só conversa que ainda não tem
-- nenhuma tag de TIPO DE CONTATO.
--
-- Rode a PARTE 1, confira a lista, depois a PARTE 2.

-- ═══ PARTE 1 — quem vai receber a tag (só leitura) ═══
with sinal as (
  select distinct m.conversation_id
  from central.messages m
  cross join lateral (
    select regexp_replace(
             translate(lower(coalesce(m.body, '')),
                       'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'),
             '[^a-z0-9]+', ' ', 'g') as t
  ) n
  where m.direction = 'inbound'
    and m.message_type <> 'reaction'
    and n.t !~ '\ycurricul(o|um) (escolar|da escola|do colegio|pedagogico|adaptado)\y'
    and (
         n.t ~ '\ycurricul(o|um|os)\y'
      or n.t ~ '\y(meu|o|um|nosso) cv\y'
      or n.t ~ '\ytrabalhe conosco\y'
      or n.t ~ '\y(trabalhar|atuar|fazer parte) (com voces|com vcs|com vc|na clinica|na equipe|na universo|ai|de voces)\y'
      or n.t ~ '\y(vagas?|oportunidades?) (de|para) (emprego|trabalho|estagio|estagiari[oa])\y'
      or n.t ~ '\y(estagiar|vaga de estagio|estagio (em|na|no|para)|processo seletivo)\y'
    )
)
select c.id, ct.name, ct.display_phone, c.tags, c.created_at
from sinal s
join central.conversations c on c.id = s.conversation_id
left join central.contacts ct on ct.id = c.contact_id
where not (coalesce(c.tags, '{}') && array(
  select d.key from central.tag_definitions d
  where d.organization_id = c.organization_id and d.grupo_key = 'tipo_de_contato'
))
order by c.created_at desc;


-- ═══ PARTE 2 — aplicar ═══
begin;
set local lock_timeout = '5s';

with sinal as (
  select distinct m.conversation_id
  from central.messages m
  cross join lateral (
    select regexp_replace(
             translate(lower(coalesce(m.body, '')),
                       'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'),
             '[^a-z0-9]+', ' ', 'g') as t
  ) n
  where m.direction = 'inbound'
    and m.message_type <> 'reaction'
    and n.t !~ '\ycurricul(o|um) (escolar|da escola|do colegio|pedagogico|adaptado)\y'
    and (
         n.t ~ '\ycurricul(o|um|os)\y'
      or n.t ~ '\y(meu|o|um|nosso) cv\y'
      or n.t ~ '\ytrabalhe conosco\y'
      or n.t ~ '\y(trabalhar|atuar|fazer parte) (com voces|com vcs|com vc|na clinica|na equipe|na universo|ai|de voces)\y'
      or n.t ~ '\y(vagas?|oportunidades?) (de|para) (emprego|trabalho|estagio|estagiari[oa])\y'
      or n.t ~ '\y(estagiar|vaga de estagio|estagio (em|na|no|para)|processo seletivo)\y'
    )
)
update central.conversations c
   set tags = array_append(coalesce(c.tags, '{}'), 'nao_paciente_trabalhe_conosco')
  from sinal s
 where c.id = s.conversation_id
   and exists (
     select 1 from central.tag_definitions d
     where d.organization_id = c.organization_id
       and d.key = 'nao_paciente_trabalhe_conosco' and d.is_active
   )
   and not (coalesce(c.tags, '{}') && array(
     select d.key from central.tag_definitions d
     where d.organization_id = c.organization_id and d.grupo_key = 'tipo_de_contato'
   ))
returning c.id, c.tags;

commit;
