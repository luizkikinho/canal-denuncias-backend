require("dotenv").config();
const crypto = require("crypto");
const supabase = require("./db");
const botMessages = require("./messages");
const { getBotTexts, t, DEFAULT_TEXTS } = require("./utils/botTexts");
const {
  buildLgpdPayload,
  buildMenuPayload,
  buildCategoryListPayload,
  buildConfirmarRelatoPayload,
  buildCopyTicketPayload,
  buildPosRelatoButtonsPayload,
} = require("./utils/messageBuilder");
const { clearScreenDown } = require("readline");

const userStates = {};
const userTimers = {};

const TIMEOUT_PADRAO = 5 * 60 * 1000;
const TIMEOUT_RELATO = 25 * 60 * 1000;

// const TIMEOUT_PADRAO = 10 * 1000;
// const TIMEOUT_RELATO = 20 * 1000;

const EVOLUTION_KEY = process.env.EVOLUTION_GLOBAL_API_KEY;

async function processWebhook(payload) {
  let empresaId_atual;
  try {
    const data = extractData(payload);
    if (!data) return null;

    const instanceName = payload.instance;
    const rawPhoneNumber = data.phoneNumber;
    const text = data.text.trim().toLowerCase();
    const anonId = anonymizeUser(rawPhoneNumber);

    if (userTimers[anonId]) {
      clearTimeout(userTimers[anonId]);
      delete userTimers[anonId];
      console.log(
        `[TIMER] Relógio cancelado para ${rawPhoneNumber} devido a nova interação.`,
      );
    }

    console.log(`\n======================================================`);
    console.log(
      `[WEBHOOK] 📩 Nova interação de ${rawPhoneNumber} na instância [${instanceName}]`,
    );
    console.log(`[EXTRAÇÃO] Comando recebido: ${text}`);

    const sessionExists = !!userStates[anonId];

    if (text !== "/start" && !sessionExists) {
      console.log(`[FILTRO] Mensagem ignorada: sem '/start' e sem sessão.`);
      return null;
    }

    if (sessionExists) {
      empresaId_atual = userStates[anonId].empresaId;
    } else {
      empresaId_atual = await getEmpresa(instanceName);
      if (!empresaId_atual) {
        console.log("[ERRO] Empresa não encontrada ou inativa. Abortando.");
        return null;
      }
    }

    // Carrega os textos (override + fallback) SEMPRE — garante frescor
    // mesmo se o master editar um texto no meio da conversa do usuário
    const botTexts = await getBotTexts(empresaId_atual);

    if (text === "/start" || !userStates[anonId]) {
      userStates[anonId] = {
        step: 0,
        categoryId: null,
        validIDs: [],
        rawPhone: rawPhoneNumber,
        erros: 0,
        empresaId: empresaId_atual,
        instanceName: instanceName,
        texts: botTexts,
      };
    }

    userStates[anonId].instanceName = instanceName;
    userStates[anonId].texts = botTexts;

    const respostas = await handleConversation(anonId, text);

    if (respostas) {
      const mensagens = Array.isArray(respostas) ? respostas : [respostas];
      for (const msg of mensagens) {
        if (typeof msg === "string") {
          await sendWhatsappMessage(rawPhoneNumber, msg, instanceName);
        } else if (typeof msg === "object") {
          if (msg.type === "buttons") {
            await sendWhatsappButtons(
              rawPhoneNumber,
              msg.payloadBuilder(rawPhoneNumber),
              instanceName,
            );
          } else if (msg.type === "list") {
            await sendWhatsappList(
              rawPhoneNumber,
              msg.payloadBuilder(rawPhoneNumber),
              instanceName,
            );
          }
        }
      }
    }

    if (userStates[anonId]) {
      defTimeout(anonId, rawPhoneNumber, userStates[anonId].step);
    }
  } catch (error) {
    console.error("[ERRO GRAVE NO WEBHOOK]:", error);
  }
}

function extractData(payload) {
  try {
    if (payload.data.key.fromMe) {
      return null;
    }

    const remoteJid = payload.data.remoteJidAlt || payload.data.key.remoteJid;

    let interactiveBtnId = null;
    try {
      const paramsJson =
        payload.data.message?.interactiveResponseMessage
          ?.nativeFlowResponseMessage?.paramsJson;
      if (paramsJson) {
        interactiveBtnId = JSON.parse(paramsJson).id;
      }
    } catch (e) {
      console.log("Erro ao tentar ler o paramsJson: ", e.message);
    }

    const buttonResponse =
      payload.data.message?.buttonsResponseMessage?.selectedButtonId ||
      payload.data.message?.templateButtonReplyMessage?.selectedId ||
      payload.data.message?.listResponseMessage?.singleSelectReply
        ?.selectedRowId ||
      interactiveBtnId;

    const textResponse =
      payload.data.message?.conversation ||
      payload.data.message?.extendedTextMessage?.text ||
      "";

    const finalInteraction = buttonResponse || textResponse;
    const phoneNumber = remoteJid.split("@")[0];

    console.log(
      `[EXTRAÇÃO] Comando recebido de ${phoneNumber}: ${finalInteraction}`,
    );

    return {
      phoneNumber: phoneNumber,
      text: finalInteraction,
    };
  } catch (error) {
    console.log("Erro ao extrair dados: ", error.message);
    return null;
  }
}

function anonymizeUser(phoneNumber) {
  try {
    const salt = process.env.SALT || "salt_emergencia";
    const fullHash = crypto
      .createHmac("sha256", salt)
      .update(phoneNumber)
      .digest("hex");
    return fullHash.substring(0, 8);
  } catch (error) {
    console.log("Erro na anonimização: ", error.message);
    return null;
  }
}

async function handleConversation(anonymizedId, text) {
  try {
    const session = userStates[anonymizedId];
    const t_ = (chave) => t(session.texts, chave); // helper local

    // ESTADO 0: Envio do Menu Dinâmico
    if (session.step === 0) {
      session.step = "AGUARDANDO_LGPD";
      return [
        t_("welcome"),
        {
          type: "buttons",
          payloadBuilder: (numero) => buildLgpdPayload(numero, session.texts),
        },
      ];
    }

    // ESTADO 1
    if (session.step === "AGUARDANDO_LGPD") {
      if (text === "btn_aceitar_termos") {
        session.step = "MENU_PRINCIPAL";
        return {
          type: "buttons",
          payloadBuilder: (numero) => buildMenuPayload(numero, session.texts),
        };
      } else if (text === "btn_ler_termos") {
        return [
          t_("termos_completos"),
          {
            type: "buttons",
            payloadBuilder: (numero) => buildLgpdPayload(numero, session.texts),
          },
        ];
      } else {
        session.erros += 1;
        if (session.erros >= 3) {
          delete userStates[anonymizedId];
          return t_("limite_erros");
        }
        return t_("use_os_botoes");
      }
    }

    // ESTADO 2
    if (session.step === "MENU_PRINCIPAL") {
      if (text === "btn_nova_denuncia") {
        const categoryData = await getCategories(session.empresaId);
        if (!categoryData) return t_("erro_banco");

        session.validIDs = categoryData.validIDs;
        session.step = "SELECIONANDO_CATEGORIA";

        return {
          type: "list",
          payloadBuilder: (numero) =>
            buildCategoryListPayload(
              numero,
              categoryData.rawCategories,
              session.texts,
            ),
        };
      } else if (text === "btn_consultar_ticket") {
        session.step = "DIGITANDO_PROTOCOLO";
        return t_("pedir_protocolo");
      } else if (text === "btn_encerrar") {
        delete userStates[anonymizedId];
        return t_("despedida");
      } else {
        session.erros += 1;
        if (session.erros >= 3) {
          delete userStates[anonymizedId];
          return t_("limite_erros");
        }
        return t_("use_os_botoes");
      }
    }

    // AO CLICAR NO BOTÃO "NOVA DENÚNCIA"
    if (session.step === "SELECIONANDO_CATEGORIA") {
      if (text === "btn_cancelar") {
        delete userStates[anonymizedId];
        return t_("cancelada");
      }

      if (text.startsWith("cat_")) {
        const idEscolhido = text.split("_")[1];
        if (session.validIDs.includes(idEscolhido)) {
          session.categoryId = idEscolhido;
          session.step = "ESCREVENDO_RELATO";
          return t_("pedir_relato");
        }
      }
      session.erros += 1;
      if (session.erros >= 3) {
        delete userStates[anonymizedId];
        return t_("limite_erros");
      }
      return t_("use_a_lista");
    }

    if (session.step === "DIGITANDO_PROTOCOLO") {
      const userTicket = text.trim().toUpperCase();
      const registros = await getTicket(userTicket);
      if (!registros) return t_("erro_banco");

      if (registros.length === 0) {
        session.erros += 1;
        if (session.erros >= 3) {
          delete userStates[anonymizedId];
          return t_("limite_erros");
        }
        return t_("ticket_nao_encontrado");
      }

      let mensagemRetorno = `🔎 *Consulta do Protocolo: ${userTicket}*\n\n`;
      registros.forEach((registro, index) => {
        const dataFormatada = new Date(
          registro.data_registro,
        ).toLocaleDateString("pt-BR");
        mensagemRetorno += `*Atualização ${index + 1} (${dataFormatada}):*\n`;
        mensagemRetorno += `${registro.texto}\n\n`;
      });

      session.step = "POS_RELATO";

      return [
        mensagemRetorno,
        {
          type: "buttons",
          payloadBuilder: (numero) =>
            buildPosRelatoButtonsPayload(numero, session.texts),
        },
      ];
    }

    // ESTADO 3
    if (session.step === "ESCREVENDO_RELATO") {
      if (text.length < 10) {
        return t_("relato_curto");
      }

      session.relatoProvisorio = text;
      session.step = "CONFIRMANDO_RELATO";

      return {
        type: "buttons",
        payloadBuilder: (numero) =>
          buildConfirmarRelatoPayload(numero, session.texts),
      };
    }

    // ESTADO 4
    if (session.step === "CONFIRMANDO_RELATO") {
      if (text === "btn_confirmar_relato") {
        const hashCurto = crypto.randomBytes(2).toString("hex").toUpperCase();
        const numeroAleatorio = Math.floor(1000 + Math.random() * 9000);
        const ticketProtocolo = `DEN-${numeroAleatorio}-${hashCurto}`;

        const success = await createTicket(
          session.empresaId,
          session.categoryId,
          session.relatoProvisorio,
          ticketProtocolo,
        );

        if (success) {
          session.relatoProvisorio = null;
          session.categoryId = null;
          session.step = "POS_RELATO";

          return [
            {
              type: "buttons",
              payloadBuilder: (numero) =>
                buildCopyTicketPayload(numero, ticketProtocolo, session.texts),
            },
            {
              type: "buttons",
              payloadBuilder: (numero) =>
                buildPosRelatoButtonsPayload(numero, session.texts),
            },
          ];
        } else {
          return t_("erro_sistema");
        }
      } else if (text === "btn_reescrever_relato") {
        session.relatoProvisorio = null;
        session.step = "ESCREVENDO_RELATO";
        return t_("pedir_relato_novamente");
      } else {
        session.erros += 1;
        if (session.erros >= 3) {
          delete userStates[anonymizedId];
          return t_("limite_erros");
        }
        return t_("use_os_botoes");
      }
    }

    // ESTADO 5
    if (session.step === "POS_RELATO") {
      if (text === "btn_nova_denuncia") {
        const categoryData = await getCategories(session.empresaId);
        if (!categoryData) return t_("erro_banco");
        session.step = "SELECIONANDO_CATEGORIA";

        return {
          type: "list",
          payloadBuilder: (numero) =>
            buildCategoryListPayload(
              numero,
              categoryData.rawCategories,
              session.texts,
            ),
        };
      } else if (text === "btn_consultar_ticket") {
        session.step = "DIGITANDO_PROTOCOLO";
        return t_("pedir_protocolo");
      } else if (text === "btn_encerrar") {
        delete userStates[anonymizedId];
        return t_("despedida");
      } else {
        session.erros += 1;
        if (session.erros >= 3) {
          delete userStates[anonymizedId];
          return t_("limite_erros");
        }
        return t_("use_os_botoes");
      }
    }
  } catch (error) {
    console.log("Erro na Máquina de Estados:", error.message);
    return "Ocorreu um erro no sistema. Por favor, tente novamente.";
  }
}

async function getCategories(empresaId) {
  try {
    const { data, error } = await supabase
      .from("categorias")
      .select("id, name")
      .eq("empresa_id", empresaId)
      .eq("active", true);

    if (error) {
      console.error(error);
      return null;
    }

    const validIDs = data.map((cat) => String(cat.id));

    const rawCategories = data.map((cat) => ({
      id: cat.id,
      nome: cat.name,
    }));

    return {
      rawCategories: rawCategories,
      validIDs: validIDs,
    };
  } catch (error) {
    console.log("Erro ao capturar categorias:", error.message);
    return null;
  }
}

async function getEmpresa(instanceName) {
  try {
    const { data, error } = await supabase
      .from("empresas")
      .select("id, status")
      .eq("instance_name", instanceName)
      .maybeSingle();
    if (error) {
      console.error(error.message);
      return null;
    }

    if (!data) {
      console.log(
        `[ROTEAMENTO] Nenhuma empresa encontrada para a instância: ${instanceName}`,
      );
      return null;
    }

    if (data.status === false) {
      console.log(
        `[ROTEAMENTO] Instância ${instanceName} pertence a uma empresa inativa.`,
      );
      return null;
    }

    return data.id;
  } catch (error) {
    console.log("Erro ao buscar empresa: ", error.message);
    return null;
  }
}

async function getTicket(protocol) {
  try {
    const { data, error } = await supabase
      .from("registro_chamados")
      .select(
        `
                *,
                chamados!inner(protocol)
            `,
      )
      .eq(`chamados.protocol`, protocol);
    if (error) {
      console.error(
        "[ERRO TICKET DB] Erro ao buscar registros: ",
        error.message,
      );
      return null;
    }
    return data;
  } catch (e) {
    console.error("[ERRO EXCEÇÃO TICKET] ", e.message);
    return null;
  }
}

async function sendWhatsappMessage(phoneNumber, messageText, instanceName) {
  if (process.env.DRY_RUN === "true") {
    console.log(`[DRY] 📤 TEXTO p/ ${phoneNumber}:\n${messageText}\n`);
    return { dryRun: true };
  }

  try {
    const instancia = instanceName || process.env.EVOLUTION_INSTANCE_NAME;
    const endpoint = `${process.env.EVOLUTION_API_URL}/message/sendText/${instancia}`;
    console.log(`[EVOLUTION] Disparo via instância: ${instancia}`);

    const payloadEvolution = {
      number: phoneNumber,
      options: { delay: 800, presence: "composing" },
      text: messageText,
    };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: EVOLUTION_KEY,
      },
      body: JSON.stringify(payloadEvolution),
    });

    return response.ok;
  } catch (error) {
    console.log("Erro ao disparar mensagem:", error.message);
    return false;
  }
}

async function sendWhatsappButtons(phoneNumber, payload, instanceName) {
  if (process.env.DRY_RUN === "true") {
    console.log(
      `[DRY] 📤 BOTÕES p/ ${phoneNumber}:`,
      JSON.stringify(payload, null, 2),
    );
    return { dryRun: true };
  }

  try {
    const instancia = instanceName || process.env.EVOLUTION_INSTANCE_NAME;
    const endpoint = `${process.env.EVOLUTION_API_URL}/message/sendButtons/${instanceName}`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: EVOLUTION_KEY,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error(
        `[EVOLUTION API] Falha ao enviar botões: Status ${response.status} - ${errorData}`,
      );
    }
    return response.ok;
  } catch (error) {
    console.error("Erro ao disparar botões:", error.message);
    return false;
  }
}

async function sendWhatsappList(phoneNumber, payload, instanceName) {
  if (process.env.DRY_RUN === "true") {
    console.log(
      `[DRY] 📤 LISTA p/ ${phoneNumber}:`,
      JSON.stringify(payload, null, 2),
    );
    return { dryRun: true };
  }

  try {
    const instancia = instanceName || process.env.EVOLUTION_INSTANCE_NAME;
    const endpoint = `${process.env.EVOLUTION_API_URL}/message/sendList/${instancia}`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: EVOLUTION_KEY,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error(
        `[EVOLUTION API] Falha ao enviar lista: Status ${response.status} - ${errorData}`,
      );
    }
    return response.ok;
  } catch (error) {
    console.error("Erro ao disparar lista:", error.message);
    return false;
  }
}

async function createTicket(empresaId, categoryId, text, ticketProtocolo) {
  try {
    console.log(`[DB] Gravando chamado ${ticketProtocolo}.`);

    const { data: chamado, error: supabaseError1 } = await supabase
      .from("chamados")
      .insert([
        {
          empresa_id: empresaId,
          categoria_id: categoryId,
          texto: text,
          protocol: ticketProtocolo,
          status: "NOVO",
        },
      ])
      .select("id")
      .single();

    if (supabaseError1) {
      console.error("[ERRO SUPABASE - CHAMADOS] ", supabaseError1);
      return false;
    }

    const { error: supabaseError2 } = await supabase
      .from("registro_chamados")
      .insert([
        {
          id_chamado: chamado.id,
          texto: "Denúncia registrada via Whatsapp",
          tipo_acao: "ABERTURA_SISTEMA",
        },
      ]);

    if (supabaseError2) {
      console.error("[ERRO SUPABASE - REGISTROS] ", supabaseError2);
      return false;
    }

    console.log(`[SUCESSO] Chamado gravado e histórico gerado.`);
    return true;
  } catch (error) {
    console.error("Erro inesperado no createTicket:", error.message);
    return false;
  }
}

async function execTimeout(anonId, rawPhoneNumber) {
  try {
    const instanceName =
      userStates[anonId]?.instanceName || process.env.EVOLUTION_INSTANCE_NAME;

    delete userTimers[anonId];
    const stepAnterior = userStates[anonId]?.step;
    delete userStates[anonId];

    console.log(`[TIMEOUT] Tempo esgotado: ${rawPhoneNumber}`);

    let mensagemChave =
      "Olá! Como não tive retorno por alguns minutos, encerrei este atendimento por segurança. Se precisar de algo, é só mandar uma nova mensagem!";

    if (stepAnterior === "ESCREVENDO_RELATO") {
      mensagemChave =
        "Oi! Percebi que você pausou a digitação do seu relato. Para sua privacidade e segurança, encerrei a sessão por inatividade. Não se preocupe, quando estiver pronto para continuar, basta me chamar aqui de novo.";
    }

    const textoFinal = botMessages[mensagemChave] || mensagemChave;
    await sendWhatsappMessage(rawPhoneNumber, textoFinal, instanceName);
  } catch (error) {
    console.error(
      `[ERRO TIMEOUT] Falha na inatividade de ${rawPhoneNumber}:`,
      error.message,
    );
  }
}

function defTimeout(anonId, rawPhoneNumber, stepAtual) {
  if (!userStates[anonId]) {
    if (userTimers[anonId]) {
      clearTimeout(userTimers[anonId]);
      delete userTimers[anonId];
    }
    return;
  }

  const tempoLimite =
    stepAtual === "ESCREVENDO_RELATO" ? TIMEOUT_RELATO : TIMEOUT_PADRAO;

  if (userTimers[anonId]) {
    clearTimeout(userTimers[anonId]);
  }

  userTimers[anonId] = setTimeout(() => {
    execTimeout(anonId, rawPhoneNumber).catch((err) => {
      console.error(
        `[ERRO TIMEOUT] Falha ao executar limpeza para ${rawPhoneNumber}: `,
        err.message,
      );
    });
  }, tempoLimite);
}

module.exports = { processWebhook };
