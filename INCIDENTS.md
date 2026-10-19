# Registro de Incidentes Resolvidos

## 2026-06-10: Sessões remanejadas não apareciam em agenda_tita após substituição de terapeutas

**Status:** ✅ Resolvido

**Severidade:** Alta (impactava Central de Autorizações, fluxo de faturamento)

**Duração:** ~2h de investigação + implementação

---

### Sintoma

Após remanejamento de pacientes de terapeutas removidos:
- 4 pacientes desapareciam da Central de Autorizações (`/solicitar`)
- Sessões existiam no TiTa mas não em `agenda_tita`
- Afetados: Isabella Maria (Gabrielly), Anny Karoline, Phettrus, Heitor Lemos

### Causa Raiz (2 camadas)

#### Camada 1: API TiTa omite sessões com status "Realizado"

O endpoint `/api/integracao/agendamento` não retorna sessões cujo status no TiTa é `"Realizado"` (já foram atendidas). 

Ciclo do bug:
1. Terapeuta removido → novo agendamento criado com `status = "Em Conflito"` → JSON não retorna
2. Paciente comparece → `status` muda para `"Realizado"` → JSON continua não retornando
3. Sessão nunca foi inserida em `agenda_tita` em nenhum dos dois momentos

**Evidência:** Comparação direta dos dois endpoints para 2026-06-10:
- JSON: retorna 4 hits dos pacientes, todos com status "Em Conflito" pendentes (não atendidos hoje)
- CSV (`csv_grade_profissionais`): retorna 17 hits, incluindo Isabella (3344121, Realizado) e Heitor (3348264, Realizado)

#### Camada 2: Índice UNIQUE `agenda_tita_unico` bloqueava inserts (secundária)

A migração `20260530000000_versioning_agenda_tita.sql` removeu apenas a constraint pelo nome, não o índice físico. Isso bloqueava qualquer insert com `tita_agendamento_id` já existente, mesmo com `ativo=false`.

---

### Correções Implementadas

#### Fix 1: Índice UNIQUE Parcial (migração)

**Arquivo:** `supabase/migrations/20260610_fix_unique_index_agenda_tita.sql`

```sql
DROP INDEX IF EXISTS public.agenda_tita_unico;
CREATE UNIQUE INDEX agenda_tita_unico_active
  ON public.agenda_tita (tita_agendamento_id)
  WHERE ativo = true;
```

**Resultado:** Versionamento funciona, sync processa 619+ registros sem erros.

#### Fix 2: Enriquecimento CSV em `sync_tita_agenda` (funcionalidade)

**Arquivo:** `supabase/functions/sync_tita_agenda/index.ts`

**O quê:** Após construir o mapa `incoming` do endpoint JSON, a função agora:
1. Chama `csv_grade_profissionais` para a mesma data (somente `data <= hoje`)
2. Identifica sessões com `status = "Realizado"` ou `"Em Conflito"` ausentes do JSON
3. Adiciona-as ao mapa com todos os IDs disponíveis (paciente, profissional, terapia, sala)
4. Processa normalmente

Sessões inseridas via CSV recebem `origem = "tita_csv"`.

**Resultado:** 619 → 658 registros para 2026-06-10.

---

### Verificação

Isabella Maria com Gabrielly:
```
tita_agendamento_id: 3344121
hora_inicial: 08:00:00
profissional_nome: Gabrielly De Souza Silveira Dos Reis
terapia_nome: Fonoaudiologia
ativo: true
origem: tita_csv
```

Heitor Lemos com Nathalia:
```
tita_agendamento_id: 3348264
hora_inicial: 09:20:00
profissional_nome: Nathalia de Lyra Silva Rezende Freitas Inacio
terapia_nome: Aplicador ABA (PS)
ativo: true
origem: tita_csv
```

✅ Ambos aparecem em `agenda_tita` e voltarão à Central de Autorizações na próxima sincronização.

---

### Impacto Resolvido

- ✅ Central de Autorizações (`/solicitar`)
- ✅ Fluxo de autorização ASSIM
- ✅ CCO (Central de Conciliação Operacional)
- ✅ Monitoramento operacional
- ✅ Preparação para faturamento

---

### Commits

- `f7fa4d3` — fix: enriquecer sync_tita_agenda com sessões Realizado do csv_grade_profissionais
- Migração `20260610_fix_unique_index_agenda_tita.sql` (aplicada via `supabase db push`)

---

### Ferramenta de Diagnóstico

Criada Edge Function `tita-compare-endpoints` para diagnósticos futuros:
- `POST /functions/v1/tita-compare-endpoints`
- Compara os dois endpoints lado a lado
- Útil para detectar divergências entre JSON e CSV
- **Removida em 19/10/2026** (segurança): devolvia agendas com nome de paciente a quem tivesse a chave pública. Ver `docs/SEGURANCA_DADOS_AGENDA.md`, P0

---

### Lições Aprendidas

1. O endpoint JSON da API TiTa é "otimista" — omite sessões já atendidas para reduzir payload
2. O CSV (`csv_grade_profissionais`) é "completo" — traz todas as sessões da unidade/data
3. Para sessões "Realizado" do dia, a única fonte confiável é o CSV
4. Índices UNIQUE absolutos podem ser sutil armadilha em cenários de versionamento — usar índices parciais

---

### Próximos Passos (se necessário)

- Monitorar se novos remanejamentos carecem de enriquecimento CSV
- Considerar sincronização periódica de CSV como fonte complementar de auditoria
- Documentar a diferença entre os dois endpoints para a equipe de integração
