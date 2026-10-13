// Forma do JSON que a tarefa da Carol grava no Doc (painel.json, versao_fluxo 4).
// Sem import nenhum, de propósito: o teste do frontend
// (frontend/lib/indicadores/entradaConvenio.test.ts) importa este arquivo.

const ETAPAS = ["E0", "E1", "E2", "E3", "E4", "E5", "E6", "E7"];
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

// O conteúdo vem em Markdown. O contrato é um único bloco ```json; sem cerca,
// aceita a página inteira sendo o JSON. Se o editor do ClickUp escapar `_` ou
// `*` fora da cerca, a segunda tentativa desfaz só esses escapes.
export function extrairJson(conteudo: string): unknown {
  const cerca = conteudo.match(/```(?:json)?[^\n]*\n([\s\S]*?)\n?```/);
  const bruto = (cerca ? cerca[1] : conteudo).trim();
  try {
    return JSON.parse(bruto);
  } catch {
    const inicio = bruto.indexOf("{");
    const fim = bruto.lastIndexOf("}");
    if (inicio < 0 || fim <= inicio) throw new Error("a página não tem um bloco JSON");
    return JSON.parse(bruto.slice(inicio, fim + 1).replace(/\\([_*\[\]])/g, "$1"));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Validação da forma (painel.json, versao_fluxo 4)
// ─────────────────────────────────────────────────────────────────────────────
const ehObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function validarDados(raiz: unknown): Record<string, unknown> {
  const dados = ehObjeto(raiz) && ehObjeto(raiz.dados) ? raiz.dados : raiz;
  if (!ehObjeto(dados)) throw new Error("JSON não é um objeto");

  if (typeof dados.gerado_em !== "string" || !DATA_ISO.test(dados.gerado_em)) {
    throw new Error("gerado_em ausente ou fora do formato AAAA-MM-DD");
  }
  if (dados.versao_fluxo !== 4) {
    throw new Error(`versao_fluxo ${JSON.stringify(dados.versao_fluxo)} — o Pulsar lê a versão 4; mudança de formato precisa ser combinada`);
  }
  if (!ehObjeto(dados.resumo)) throw new Error("resumo ausente");
  if (!ehObjeto(dados.setores)) throw new Error("setores ausente");

  const etapas = dados.etapas;
  if (!Array.isArray(etapas) || etapas.length !== ETAPAS.length) {
    throw new Error(`etapas precisa ter ${ETAPAS.length} itens`);
  }
  etapas.forEach((e, i) => {
    if (!ehObjeto(e) || e.etapa !== ETAPAS[i] || typeof e.prazo !== "number") {
      throw new Error(`etapa ${i} fora da forma (esperado ${ETAPAS[i]})`);
    }
  });

  const pacientes = dados.pacientes;
  if (!Array.isArray(pacientes)) throw new Error("pacientes ausente");
  pacientes.forEach((p, i) => {
    if (!ehObjeto(p) || typeof p.paciente !== "string" || !p.paciente.trim()) {
      throw new Error(`paciente ${i} sem nome`);
    }
    if (!["em andamento", "concluído", "encerrado"].includes(String(p.situacao))) {
      throw new Error(`paciente ${i} com situação desconhecida: ${String(p.situacao)}`);
    }
    if (p.situacao === "em andamento" && !ehObjeto(p.atual)) {
      throw new Error(`paciente ${i} em andamento sem etapa atual`);
    }
    if (!Array.isArray(p.historico)) throw new Error(`paciente ${i} sem historico`);
  });

  return dados;
}

