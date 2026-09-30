"use strict";
// Dados do jogo: construções, melhorias, conquistas e notícias.
const BUILDINGS_DATA = [
  { id: "cursor", name: "Ponteiro ASCII", cost: 15, cps: 0.1, icon: "->" },
  { id: "vovo", name: "Vovó do Bloco de Notas", cost: 100, cps: 1, icon: "(o.o)" },
  { id: "fazenda", name: "Fazenda .TXT", cost: 1100, cps: 8, icon: "[#]" },
  { id: "mina", name: "Mina de Caracteres", cost: 12000, cps: 47, icon: "/=\\" },
  { id: "fabrica", name: "Fábrica de ASCII", cost: 130000, cps: 260, icon: "|---|" },
  { id: "banco", name: "Banco de Dados ASCII", cost: 1400000, cps: 1400, icon: "[$]" },
  { id: "templo", name: "Templo Monospaced", cost: 20000000, cps: 7800, icon: "/\\" },
  { id: "mago", name: "Torre do Mago C++", cost: 330000000, cps: 44000, icon: "(*)" },
  { id: "nave", name: "Nave de Caracteres", cost: 5100000000, cps: 260000, icon: "<=>" },
  { id: "prisma", name: "Prisma ASCII 2006", cost: 75000000000, cps: 1600000, icon: "<*>" }
];

function makeBuildingUpgrade(id, bid, name, cost, minCount, text) {
  return {
    id, name, cost, icon: "[x2]", desc: text,
    req: () => getBCount(bid) >= minCount,
    apply: s => { s.buildings[bid].mult *= 2; }
  };
}

const UPGRADES_DATA = [
  { id: "reinforced_index", name: "Dedo Reforçado", cost: 100, icon: "[+1]", desc: "+1 para o poder de clique.",
    req: s => s.totalClicked >= 1, apply: s => { s.clickPowerBonus += 1; } },
  { id: "carpal_tunnel", name: "Teclado Mecânico 2006", cost: 500, icon: "[+5]", desc: "+5 para o poder de clique.",
    req: s => s.totalClicked >= 50, apply: s => { s.clickPowerBonus += 5; } },
  { id: "plastic_mouse", name: "Mouse de Esfera Limpo", cost: 10000, icon: "[+1%]", desc: "O clique ganha +1% do CPS.",
    req: s => s.totalClicked >= 200, apply: s => { s.clickPercentCps += 0.01; } },
  makeBuildingUpgrade("forged_cursor", "cursor", "Cursores de Aço", 500, 1, "Ponteiros ASCII produzem o dobro."),
  makeBuildingUpgrade("granny_glasses", "vovo", "Óculos de Grau da Vovó", 1000, 1, "Vovós produzem o dobro."),
  makeBuildingUpgrade("fertile_txt", "fazenda", "Formatador .TXT Rápido", 11000, 1, "Fazendas produzem o dobro."),
  makeBuildingUpgrade("deep_mining", "mina", "Picareta Monospace", 120000, 1, "Minas produzem o dobro.")
];

// Melhorias extras geradas para as demais construções (nível 1 e nível 2).
BUILDINGS_DATA.forEach(b => {
  if (!["cursor", "vovo", "fazenda", "mina"].includes(b.id)) {
    UPGRADES_DATA.push(makeBuildingUpgrade(b.id + "_t1", b.id, "Turbo " + b.name, b.cost * 10, 1, b.name + " produzem o dobro."));
  }
  UPGRADES_DATA.push(makeBuildingUpgrade(b.id + "_t2", b.id, "Super " + b.name, b.cost * 50, 10, b.name + " produzem o dobro (requer 10)."));
});

const ACHIEVEMENTS_DATA = [
  { id: "a_click1", name: "Primeira Migalha", desc: "Clique 1 vez.", req: s => s.totalClicked >= 1 },
  { id: "a_click100", name: "Dedo de Teclado", desc: "Clique 100 vezes.", req: s => s.totalClicked >= 100 },
  { id: "a_click1000", name: "Autoclicker Humano", desc: "Clique 1.000 vezes.", req: s => s.totalClicked >= 1000 },
  { id: "a_bake100", name: "Fornada Inicial", desc: "Asse 100 biscoitos.", req: s => s.totalBaked >= 100 },
  { id: "a_bake1k", name: "Padaria de Bairro", desc: "Asse 1.000 biscoitos.", req: s => s.totalBaked >= 1000 },
  { id: "a_bake1m", name: "Império ASCII", desc: "Asse 1.000.000 de biscoitos.", req: s => s.totalBaked >= 1e6 },
  { id: "a_bake1b", name: "Monopólio de Caracteres", desc: "Asse 1.000.000.000 de biscoitos.", req: s => s.totalBaked >= 1e9 },
  { id: "a_golden1", name: "Sorte do Bloco de Notas", desc: "Clique em 1 biscoito dourado.", req: s => s.goldenClicked >= 1 },
  { id: "a_golden10", name: "Caçador Celestial", desc: "Clique em 10 biscoitos dourados.", req: s => s.goldenClicked >= 10 },
  { id: "a_ascend1", name: "Nirvana de Código", desc: "Faça sua primeira ascensão.", req: s => s.prestigeResets >= 1 }
];

const NEWS_LIST = [
  "NOTÍCIA: Comunidade do Orkut 'Eu Amo Biscoitos ASCII' alcança 100 mil membros!",
  "MERCADO: Preço da farinha virtual sobe 12% no Mercado Livre.",
  "INTERNET: Usuários de MSN Messenger relatam tremores na tela ao assar biscoitos.",
  "TECNOLOGIA: Lançado o Firefox 1.5 com suporte total a biscoitos ASCII!",
  "CIÊNCIA: Digitar [CLIQUE AQUI] queima 0.5 calorias.",
  "BLOGSPOT: Biscoito ASCII é eleito o melhor jogo de 2006."
];
