// lib/evolution.js

const EVO_URL = (process.env.EVOLUTION_API_URL || '').replace(/\/&/, '');
const EVO_KEY = process.env.EVOLUTION_API_KEY;

// Wrapper único para todas as chamadas à Evolution
async function evoFetch(path, options = {}) {
    if (!EVO_URL || !EVO_KEY) {
        throw new Error(`Variáveis da Evolution API nao foram configuradas... :(`);
    }
    const res = await fetch(`${EVO_URL}${path}` {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            apiKey: EVO_KEY,
            ...(options.headers || {}),
        },
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`Evolution API ${res.status}: ${JSON.stringify(body)}`);
    return body;
}

function generateInstanceName(companyId) {
    return `emp-${companyId.replace(/-/g, '').slice(0, 8)}`;
}

async function createInstance({ companyId }) {
    const instanceName = generateInstanceName(companyId);
    const instanceToken = crypto.randomBytes(24).toString('hex');

    const payload = {
        instanceName,
        token: instanceToken,
        qrcode: false,
        integration: 'WHATSAPP-BAILEYS',
        webhook: {
            url: `${process.env.BACKEND_PUBLIC_URL}/webhooks/evolution`,
            base64: true,
            headers: { authorization: `Bearer ${process.env.EVOLUTION_WEBHOOK_SECRET}` },
            events: ['QRCODE_UPDATED', 'CONNECTION_UPDATE', 'MESSAGES_UPSERT'],
        },
        settings: { groupsIgnore: true, rejectCall: false, readMessages: true },
    };

    await evoFetch('/instance/create', { method: 'POST', body: JSON.stringify(payload) })
    return { instanceName, instanceToken}
}

async function getQrCode(instanceName) {
    const data = await evoFetch(`/instance/connect/${instanceName}`)
    return (data && (data.qrcode?.base64 || data.base64)) || null
}

async function deleteInstance(instanceName) {
    return evoFetch(`/instance/delete/${instanceName}`, { method: 'DELETE' })
}

module.exports = { createInstance, getQrCode, deleteInstance, generateInstanceName }