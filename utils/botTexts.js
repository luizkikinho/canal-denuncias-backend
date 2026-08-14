const supabase = require("../db"); // ajuste ao export do seu db.js

// Fonte única de verdade: todo texto que o usuário final lê
const DEFAULT_TEXTS = {
  lgpd_title: "📋 Antes de continuar, leia os Termos de Uso!",
  lgpd_description:
    "Para garantir o seu anonimato e cumprir com a LGPD, precisamos que você confirme nossos termos de uso antes de prosseguir.",
  lgpd_footer: "Nenhum dado pessoal será armazenado!",

  menu_title: "MENU PRINCIPAL",
  menu_description: "Como podemos ajudar?",
  menu_footer: "Selecione uma opção para continuar.",

  categoria_title: "📂 Categorias de Denúncia",
  categoria_description:
    "Por favor, selecione o tema que melhor descreve o seu relato.",
  categoria_button: "Ver Categorias",
  categoria_footer: "Seu anonimato é garantido.",

  confirmar_title: "✅ Confirme se está tudo certo",
  confirmar_description:
    "Confira se o relato está tudo certo e clique em `Confirmar` para salvar sua denúncia.",
  confirmar_footer: "Ou clique em 'Cancelar' para reescrever seu relato",

  ticket_title: "🎟️ Guarde seu ticket!",
  ticket_description:
    "Seu número de protocolo é {protocolo}. Guarde esse código em um local seguro. Ele será a única forma de consultar o andamento da sua denúncia no futuro",
  ticket_footer: "Canal de Denúncias Seguro",

  pos_relato_title: "O que fazer agora?",
  pos_relato_footer: "Canal de Denúncias Seguro",
};

// "Tem texto próprio? Usa. Não tem? Usa o padrão."
function t(texts, chave) {
  return (texts && texts[chave]) ?? DEFAULT_TEXTS[chave];
}

async function getBotTexts(empresaId) {
  const { data, error } = await supabase
    .from("mensagens_bot")
    .select("chave, texto")
    .eq("empresa_id", empresaId);
  if (error) {
    console.error("[TEXTOS] Erro ao buscar overrides:", error.message);
    return {};
  }
  const map = {};
  (data || []).forEach((r) => (map[r.chave] = r.texto));
  return map;
}

module.exports = { DEFAULT_TEXTS, t, getBotTexts };
