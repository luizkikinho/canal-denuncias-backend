// lib/evolution.js
const crypto = require("node:crypto");

const EVO_URL = (process.env.EVOLUTION_API_URL || "").replace(/\/$/, "");
const EVO_KEY = process.env.EVOLUTION_GLOBAL_API_KEY;

if (!EVO_URL || !EVO_KEY) {
    throw new Error("[EVOLUTION LIB] EVOLUTION_API_URL ou EVOLUTION_API_KEY ausentes.");
}

async function evoFetch(path, options = {}) {
    const res = await fetch(`${EVO_URL}${path}`, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            apikey: EVO_KEY,
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
