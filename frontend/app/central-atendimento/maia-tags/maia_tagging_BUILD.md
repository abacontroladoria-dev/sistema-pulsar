# Build: camada de tagueamento da Maia

Brief para implementar no Claude Code. Sistema novo (greenfield) — nada de tags
existe ainda no backend.

## Objetivo

A Maia (LLM na API) classifica cada conversa e devolve um objeto de tags
**estruturado**. O backend valida contra o catálogo e grava. Tags orientam
relatório e ação; o resto (status, objeção, campanha) vai em campo/funil.

## Arquivos desta pasta (fonte de verdade)

| Arquivo | Papel |
|---|---|
| `maia_tags_catalog.json` | Dicionário das 144 tags: id, grupo, cardinalidade, quem aplica, quando usar, regra. **Fonte de verdade.** |
| `maia_tags_output.schema.json` | JSON Schema do que a Maia devolve por turno. Enums gerados do catálogo; já excluem tags humano-only e o grupo jurídico. Alvo de validação. |
| `maia_frases_campanha.json` | Regra 5: frases exatas → ORIGEM + campo Campanha, e o fallback da Maia. |
| `maia_secao19_tags_v2.md` | Bloco §19 do prompt da Maia (vocabulário + regras de tag, em PT). |
| `maia_system_prompt.md` | Instruções de classificação da Maia (contrato de saída, quem aplica, regra 12). Cole junto ao prompt v9 existente. |

## Arquitetura

```
mensagem recebida
      │
      ├─(A) matcher de campanha (SISTEMA, regra 5) ── casa frase exata? ──> aplica ORIGEM + grava campo Campanha
      │        └─ prioridade: UTM (Google) / referral|ctwa_clid (Meta) > frase
      │
      ├─(B) Maia (LLM) classifica ── devolve JSON conforme schema (function calling)
      │
      └─(C) backend valida o JSON ──> grava tags + campos
               ├─ IDs existem no catálogo?
               ├─ cardinalidade ok? (single = 1; multi = 1+)
               ├─ nenhum id humano-only nas tags? (schema já barra, revalidar no servidor)
               └─ escalar_humano.necessario == true ──> fila humana + tags_sugeridas
```

Pontos que decidem a arquitetura:

1. **Saída estruturada, não texto.** Use function calling / response_format com
   `maia_tags_output.schema.json`. Não faça parse de texto da conversa.
2. **Matcher de campanha é do sistema, não da Maia** (regra 5). Roda em (A), antes ou
   em paralelo à Maia. Só as frases `pronta_para_match: true` valem. Se houver
   identificador de anúncio (UTM / referral / ctwa_clid), ele manda sobre a frase.
   Se nada casar e o texto for pré-preenchido, a Maia aplica o fallback (seção
   `fallback_maia_regra5` do JSON).
3. **Filtro "quem aplica" em dois lugares** (defesa em profundidade): o schema já
   exclui humano-only dos enums; o backend revalida e rejeita se aparecer.
4. **Campos ≠ tags** (regras 5, 8): `campanha` (sistema), `objecao`, `data_nascimento`
   são campos. Status → funil. Prioridade → sinal de fila. Nunca gravar como tag.

## Modelo de dados (sugestão)

- `tag_catalog` — carregado do `maia_tags_catalog.json` (seed/migration). Colunas:
  `id, grupo, label, cardinalidade, obrigatorio, maia_pode_aplicar, requer_humano,
  automatico_sistema, quando_usar, regra`.
- `conversation_tags` — `conversation_id, grupo, tag_id, aplicado_por (sistema|maia|humano),
  criado_em`. Para grupos single, upsert por (conversation_id, grupo).
- `conversation_fields` — `conversation_id, campanha, objecao, data_nascimento, ...`.
- Status e trilha do funil ficam no seu modelo de funil (regra 14: um funil, coluna
  Trilha = Convênio/Particular/Ambas), **não** em tag.

## Validação (backend, a cada saída da Maia)

1. Valide o JSON contra `maia_tags_output.schema.json`.
2. Para cada grupo single: 0 ou 1 valor. Para multi: 0..n, sem repetição.
3. Confirme que todo `tag_id` existe no catálogo e tem `maia_pode_aplicar = true`.
4. Se `escalar_humano.necessario`: enfileire para humano com `motivo`, `prioridade`
   e `tags_sugeridas` (estas o humano confirma; a Maia não grava).
5. `campos.campanha` deve vir `null` da Maia — se vier preenchido, ignore (só o
   matcher (A) escreve esse campo).
6. Regra 1 (completude do lead): quando `tipo_de_contato = lead`, sinalize se faltar
   ORIGEM, SERVIÇO ou PAGAMENTO — não bloqueie, mas marque incompleto para a Maia
   seguir coletando.

## Integração no prompt da Maia (v9 → v10)

- Substitua o **§19** atual por `maia_secao19_tags_v2.md`.
- Cole o bloco de `maia_system_prompt.md` (contrato de saída + regra 12 + filtro quem
  aplica). O prompt v9 continua cuidando da conversa; este bloco cuida da classificação.
- Ajustes inline no v9 (uma linha cada):
  - §12.4: `STATUS = Encaminhado para humano` → posição de funil, não tag.
  - §12.7: remover `ETAPA CONVÊNIO = Decisão judicial recebida` (é humano); manter
    `ROTA = Rota E` + `CONVÊNIO`.
  - §12.1 / §12.5b: gravar `DIAGNÓSTICO INFORMADO` onde a cobertura é decidida por
    diagnóstico.
  - §9 e §11: alinhar "adolescente 13 a 17" para **12 a 17**.
  - §5: padronizar rótulo para `Não-paciente | X`.
  - §14 (objeção) e prioridade: viram campo, não tag.

## Testes que valem a pena escrever

- Frase exata cadastrada → ORIGEM correta + campo Campanha preenchido; frase não
  cadastrada mas pré-preenchida → fallback Meta Ads + Campanha vazia.
- "Meu advogado indicou" → Maia NÃO emite `indicacao_advogado`; `escalar_humano` com a
  sugestão. Backend rejeita se o id humano-only aparecer em `tags`.
- Convênio credenciado com laudo só de TDAH → PAGAMENTO + CONVÊNIO gravados, sem
  prometer autorização (regra do §12.1).
- Grupo single recebendo 2 valores → validação falha.
- Família muda de "só pesquisando" para "quero começar essa semana" → `urgencia`
  muda e entra em `mudou_neste_turno`.

## Decisões em aberto (confirmar com a equipe antes do go-live)

1. **Lógica de ROTA (A–E):** deduzida das descrições do grupo, não há tabela formal
   como a da URGÊNCIA (regra 12). Ver seção 8 de `maia_system_prompt.md` e validar.
2. **14 frases "(preencher)"** em `maia_frases_campanha.json`: enquanto vazias, o
   matcher não casa e a Maia cai no fallback. Marketing preenche a frase exata.
3. **Real Saúde** (regra 10) tem taxonomia própria, no outro número — fora deste
   catálogo. Definir se entra neste sistema ou fica separado.
