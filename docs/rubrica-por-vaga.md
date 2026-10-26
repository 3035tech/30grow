# Rubrica por vaga (pesos T1–T9)

Este documento explica como funciona a **rubrica de aderência por vaga** no 30Grow.

---

## O que é

A rubrica por vaga é um conjunto de **pesos para os tipos T1–T9** que representa o “perfil desejado” para uma vaga/programa.

### Contexto do instrumento

O 30Grow usa uma **avaliação inspirada no modelo do Eneagrama** aplicada ao **contexto de trabalho**. O resultado inclui **pontuações T1 a T9**. **Não são diagnósticos clínicos**; são **heurísticas** para triagem e conversa.

- O **candidato responde o mesmo teste** para qualquer vaga.
- A rubrica **não muda o teste**; muda **como interpretamos o resultado** *para aquela vaga*.
- O sistema calcula uma **aderência 0–10** e permite **ranking** dentro da vaga.

### Onde aparece

- **Dashboard → Vagas → detalhe → Fit / rubrica**: editor de pesos, IA e ranking.
- **Dashboard (equipe)**: quando existir rubrica da vaga, a UI prioriza a aderência da vaga.

---

## Como os pesos funcionam

- **0 / vazio**: irrelevante (não entra no cálculo).
- **1**: bom ter · **2**: importante · **3**: muito importante.
- **4+**: use com moderação.

Prático: **2–4 tipos com peso > 0** já geram ranking útil. Pesos são **relativos**.

---

## Fluxo com IA (no painel)

1. (Opcional) **Sugerir contexto com IA** a partir do título/descrição da vaga.
2. **Revise** o texto do contexto.
3. **Gerar pesos e salvar** — a API chama o modelo, faz parse do JSON, grava `vacancy_fit_weights` (+ notas) e o ranking recarrega.

Não há mais copiar prompt / colar JSON na UI.

Contrato da resposta da IA (parse em `lib/recruiting/rubric-prompt.js`):

```json
{
  "weights": { "1": 0, "2": 0, "3": 2, "4": 0, "5": 3, "6": 1, "7": 0, "8": 0, "9": 0 },
  "notes": "Texto curto para o RH"
}
```

Chamada usa `response_format: json_object` quando há `OPENAI_API_KEY`.

Ajuste **manual** dos campos T1–T9 ainda usa o botão **Salvar rubrica**.

---

## Notas internas

Campo livre (HTML rico) para racional da rubrica. A IA pode preencher via `notes` no JSON; o RH pode editar depois.
