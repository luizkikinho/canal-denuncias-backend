// lib/evolution.js
const crypto = require("node:crypto");

function configuracaoEvo() {
  const url = (process.env.EVOLUTION_API_URL || "").replace(/\/$/, "");
  const key = process.env.EVOLUTION_GLOBAL_API_KEY;
  return { url, key };
}

async function evoFetch(path, options = {}) {
  const { url, key } = configuracaoEvo();
  if (!url || !key) {
    throw new Error(
      "[EVOLUTION LIB] Evolution não configurada (EVOLUTION_API_URL/EVOLUTION_GLOBAL_API_KEY ausentes).",
    );
  }
  const res = await fetch(`${url}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      ...(options.headers || {}),
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Evolution API ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

function generateInstanceName(companyId) {
    return `emp-${companyId.replace(/-/g, "").slice(0, 8)}`;
}

// ÚNICO lugar do sistema que define o webhook das instâncias
async function setWebhook(instanceName) {
    return evoFetch(`/webhook/set/${instanceName}`, {
        method: "POST",
        body: JSON.stringify({
            webhook: {
                enabled: true,
                url: `${process.env.BACKEND_PUBLIC_URL}/webhook`,
                base64: true,
                events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE", "QRCODE_UPDATED"],
            },
        }),
    });
}

async function createInstance({ companyId }) {
    const instanceName = generateInstanceName(companyId);
    const instanceToken = crypto.randomBytes(24).toString("hex");

    const payload = {
        instanceName,
        token: instanceToken,
        qrcode: false,
        integration: "WHATSAPP-BAILEYS",
        settings: {
            groupsIgnore: true,
            rejectCall: true,
            readMessages: true,
        },
    };

    await evoFetch("/instance/create", {
        method: "POST",
        body: JSON.stringify(payload),
    });

    // Compensação: webhook falhou? desfaz o create (sem instância órfã)
    try {
        await setWebhook(instanceName);
    } catch (err) {
        await deleteInstance(instanceName).catch(() => {});
        throw err;
    }

    return { instanceName, instanceToken };
}

async function getQrCode(instanceName) {
    const data = await evoFetch(`/instance/connect/${instanceName}`);
    return (data && (data.qrcode?.base64 || data.base64)) || null;
}

async function deleteInstance(instanceName) {
    return evoFetch(`/instance/delete/${instanceName}`, { method: "DELETE" });
}

module.exports = {
    createInstance,
    getQrCode,
    deleteInstance,
    generateInstanceName,
    setWebhook,
};
