// Testes do vocabulário visual. O que se trava aqui não é "a cor é bonita", e
// sim as duas invariantes que a crítica pegou quebradas:
//
//   1. TODO estado tem entrada em TODO mapa — era a ausência disso que deixava
//      o `Record<string, Tone>` do drawer cair num `?? "slate"` calado.
//   2. UM TOM, UM SIGNIFICADO entre componentes, não só dentro de cada um.
//
// Sem esses testes a regra volta a ser uma alegação de comentário — que é
// exatamente como ela se perdeu da primeira vez.

import { describe, it, expect } from "vitest"
import {
  corDaUnidade, DIA_CLS, SITUACAO_DOT, SITUACAO_NOME_CLS, SITUACAO_TONE, SITUACOES_LEGENDA,
  SITUACAO_MARCA_CLS, TERAPIA_MARCA_CLS, UNIDADES_CONHECIDAS,
} from "./salasVocabulario"
import { NIVEL_DIA_LABEL, SITUACAO_LABEL, type NivelDia, type SituacaoCelula } from "@/lib/cronograma/salasView"

const SITUACOES = Object.keys(SITUACAO_LABEL) as SituacaoCelula[]
const NIVEIS = Object.keys(NIVEL_DIA_LABEL) as NivelDia[]

describe("cobertura dos mapas", () => {
  it("toda situação tem tom, dot e cor de nome", () => {
    for (const s of SITUACOES) {
      expect(SITUACAO_TONE[s], `tom de ${s}`).toBeTruthy()
      expect(SITUACAO_DOT[s], `dot de ${s}`).toBeTruthy()
      expect(SITUACAO_NOME_CLS[s], `nome de ${s}`).toBeTruthy()
    }
  })

  it("todo nível de dia tem classe", () => {
    for (const n of NIVEIS) expect(DIA_CLS[n], `classe de ${n}`).toBeTruthy()
  })

  it("a legenda só lista situações que existem, sem repetir", () => {
    expect(new Set(SITUACOES_LEGENDA).size).toBe(SITUACOES_LEGENDA.length)
    for (const s of SITUACOES_LEGENDA) expect(SITUACOES).toContain(s)
  })

  it("`indisponivel` não entra na legenda: é a célula que diz 'Não atende'", () => {
    expect(SITUACOES_LEGENDA).not.toContain("indisponivel")
  })
})

describe("um tom, um significado", () => {
  // Cada caso afirma as DUAS direções: que o estado usa aquela família E que
  // ninguém mais usa. Só a segunda metade deixava passar recolorir o próprio
  // estado (conflito virar âmbar não acusava nada).
  it("rosa é conflito, e só conflito", () => {
    expect(SITUACAO_DOT.conflito).toContain("rose")
    expect(SITUACAO_NOME_CLS.conflito).toContain("rose")
    expect(DIA_CLS.conflito).toContain("rose")
    expect(SITUACOES.filter(s => SITUACAO_DOT[s].includes("rose") || SITUACAO_NOME_CLS[s].includes("rose"))).toEqual(["conflito"])
    expect(NIVEIS.filter(n => DIA_CLS[n].includes("rose"))).toEqual(["conflito"])
  })

  it("verde é o estado saudável/cheio, e só ele", () => {
    expect(SITUACAO_DOT.confirmada).toContain("emerald")
    expect(DIA_CLS.cheio).toContain("emerald")
    expect(SITUACOES.filter(s => SITUACAO_DOT[s].includes("emerald"))).toEqual(["confirmada"])
    expect(NIVEIS.filter(n => DIA_CLS[n].includes("emerald"))).toEqual(["cheio"])
  })

  it("âmbar é 'precisa de atenção', e só isso", () => {
    expect(SITUACAO_DOT["sem-sessao"]).toContain("amber")
    expect(SITUACAO_NOME_CLS["sem-sessao"]).toContain("amber")
    expect(DIA_CLS.parcial).toContain("amber")
    expect(SITUACOES.filter(s => SITUACAO_DOT[s].includes("amber") || SITUACAO_NOME_CLS[s].includes("amber"))).toEqual(["sem-sessao"])
    expect(NIVEIS.filter(n => DIA_CLS[n].includes("amber"))).toEqual(["parcial"])
  })

  it("o tom do pill concorda com a cor do dot", () => {
    // Se um dia o pill disser "verde" e o dot da mesma situação for âmbar, a
    // mesma situação aparece com duas cores em dois cantos da tela.
    const PAR: Partial<Record<SituacaoCelula, string>> = {
      confirmada: "emerald", "sem-sessao": "amber", conflito: "rose", "agenda-aberta": "sky",
    }
    for (const [situacao, familia] of Object.entries(PAR)) {
      expect(SITUACAO_DOT[situacao as SituacaoCelula]).toContain(familia!)
    }
    expect(SITUACAO_TONE.confirmada).toBe("green")
    expect(SITUACAO_TONE["sem-sessao"]).toBe("amber")
    expect(SITUACAO_TONE.conflito).toBe("red")
    expect(SITUACAO_TONE["agenda-aberta"]).toBe("blue")
  })
})

describe("zero não tem cor", () => {
  it("`livre` é anel, nunca preenchimento — nem como dia, nem como situação", () => {
    for (const cls of [DIA_CLS.livre, SITUACAO_DOT.livre]) {
      expect(cls).toContain("bg-transparent")
      expect(cls).toContain("ring")
    }
  })

  it("estado saudável e ausência ficam na cor normal de texto", () => {
    // Se todo estado tivesse cor, nenhum chamaria atenção.
    expect(SITUACAO_NOME_CLS.confirmada).toBe("text-foreground")
    expect(SITUACAO_NOME_CLS.livre).toBe("text-foreground")
  })

  it("dia sem atendimento não vira bolinha colorida", () => {
    expect(DIA_CLS["sem-atendimento"]).toContain("bg-transparent")
  })
})

describe("cor de unidade não colide com cor de estado", () => {
  const FAMILIAS_DE_ESTADO = ["rose", "amber", "emerald", "sky", "red", "green"]

  it("nenhuma unidade usa família reservada a estado", () => {
    // Uma unidade em âmbar leria como "precisa de atenção"; em rosa, como
    // conflito. É o mesmo erro que a crítica pegou, num eixo novo.
    for (const u of [...UNIDADES_CONHECIDAS, "Unidade Que Não Existe"]) {
      const { chip } = corDaUnidade(u)
      for (const familia of FAMILIAS_DE_ESTADO) {
        expect(chip, `chip de ${u}`).not.toContain(familia)
      }
    }
  })

  it("cada unidade conhecida tem cor própria", () => {
    const chips = UNIDADES_CONHECIDAS.map(u => corDaUnidade(u).chip)
    expect(new Set(chips).size).toBe(UNIDADES_CONHECIDAS.length)
  })

  it("unidade desconhecida cai no neutro, não numa cor emprestada", () => {
    const desconhecida = corDaUnidade("Filial Nova")
    expect(desconhecida.chip).toContain("muted")
    // Não pode reusar a cor de uma unidade conhecida: duas unidades com o
    // mesmo tom desfazem o agrupamento que a faixa existe para dar.
    for (const u of UNIDADES_CONHECIDAS) {
      expect(desconhecida.chip).not.toBe(corDaUnidade(u).chip)
    }
  })

  it("nulo não quebra", () => {
    expect(corDaUnidade(null).chip).toBeTruthy()
    expect(corDaUnidade(undefined).chip).toBeTruthy()
  })

  it("toda cor de unidade tem contraparte dark", () => {
    for (const u of [...UNIDADES_CONHECIDAS, "Outra"]) {
      const { chip } = corDaUnidade(u)
      // Tokens semânticos (`bg-muted`) já viram no tema; só as escalas fixas
      // de paleta precisam do par explícito.
      if (chip.includes("-100")) expect(chip, `chip de ${u}`).toContain("dark:")
    }
  })
})

describe("forma distingue o eixo semântico", () => {
  it("terapia é quadrado e situação é círculo", () => {
    // Os dois marcadores convivem na MESMA célula: só a forma separa "que
    // terapia é" de "como está".
    expect(TERAPIA_MARCA_CLS).toContain("rounded-[3px]")
    expect(TERAPIA_MARCA_CLS).not.toContain("rounded-full")
    expect(SITUACAO_MARCA_CLS).toContain("rounded-full")
  })
})

describe("dark mode", () => {
  it("toda cor de TEXTO tem contraparte dark", () => {
    // Fundo sólido -400/-500 lê nos dois temas; texto -700 não.
    for (const s of SITUACOES) {
      const cls = SITUACAO_NOME_CLS[s]
      if (cls.includes("-700")) expect(cls, `${s} sem dark:`).toContain("dark:")
    }
  })
})
