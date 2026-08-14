const { t } = require("./botTexts");

function buildLgpdPayload(phoneNumber, texts = {}) {
  return {
    number: phoneNumber,
    title: t(texts, "lgpd_title"),
    description: t(texts, "lgpd_description"),
    footer: t(texts, "lgpd_footer"),
    buttons: [
      { type: "reply", displayText: "✔️ Aceitar", id: "btn_aceitar_termos" },
      {
        type: "reply",
        displayText: "📄 Ler Termos Completos",
        id: "btn_ler_termos",
      },
    ],
  };
}

function buildMenuPayload(phoneNumber, texts = {}) {
  return {
    number: phoneNumber,
    title: t(texts, "menu_title"),
    description: t(texts, "menu_description"),
    footer: t(texts, "menu_footer"),
    buttons: [
      {
        type: "reply",
        displayText: "➕ Nova Denúncia",
        id: "btn_nova_denuncia",
      },
      {
        type: "reply",
        displayText: "🔎 Consultar Ticket",
        id: "btn_consultar_ticket",
      },
      { type: "reply", displayText: "❌ Encerrar", id: "btn_encerrar" },
    ],
  };
}

function buildCategoryListPayload(phoneNumber, categorias, texts = {}) {
  const rows = categorias.map((cat) => ({
    title: cat.nome,
    rowId: `cat_${cat.id}`,
  }));
  rows.push({
    title: "❌ Cancelar",
    rowId: "btn_cancelar",
  });

  return {
    number: phoneNumber,
    title: t(texts, "categoria_title"),
    description: t(texts, "categoria_description"),
    buttonText: t(texts, "categoria_button"),
    footerText: t(texts, "categoria_footer"),
    sections: [
      {
        title: "Opções Disponíveis",
        rows: rows,
      },
    ],
  };
}

function buildConfirmarRelatoPayload(phoneNumber, texts = {}) {
  return {
    number: phoneNumber,
    title: t(texts, "confirmar_title"),
    description: t(texts, "confirmar_description"),
    footer: t(texts, "confirmar_footer"),
    buttons: [
      {
        type: "reply",
        displayText: "✅ Confirmar",
        id: "btn_confirmar_relato",
      },
      {
        type: "reply",
        displayText: "✏️ Reescrever Relato",
        id: "btn_reescrever_relato",
      },
    ],
  };
}

function buildCopyTicketPayload(phoneNumber, protocolo, texts = {}) {
  return {
    number: phoneNumber,
    options: { delay: 1200, presence: "composing" },
    title: t(texts, "ticket_title"),
    description: t(texts, "ticket_description").replaceAll(
      "{protocolo}",
      protocolo,
    ),
    footer: t(texts, "ticket_footer"),
    buttons: [
      { type: "copy", displayText: "Copiar Protocolo", copyCode: protocolo },
    ],
  };
}

function buildPosRelatoButtonsPayload(phoneNumber, texts = {}) {
  return {
    number: phoneNumber,
    options: { delay: 1500, presence: "composing" },
    title: t(texts, "pos_relato_title"),
    footer: t(texts, "pos_relato_footer"),
    buttons: [
      {
        type: "reply",
        displayText: "➕ Nova Denúncia",
        id: "btn_nova_denuncia",
      },
      {
        type: "reply",
        displayText: "🔎 Consultar Ticket",
        id: "btn_consultar_ticket",
      },
      { type: "reply", displayText: "❌ Encerrar", id: "btn_encerrar" },
    ],
  };
}

module.exports = {
  buildLgpdPayload,
  buildMenuPayload,
  buildCategoryListPayload,
  buildConfirmarRelatoPayload,
  buildCopyTicketPayload,
  buildPosRelatoButtonsPayload,
};
