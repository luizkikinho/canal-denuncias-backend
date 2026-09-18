const express = require("express");
const {
  processWebhook,
  processSimulatorMessage,
  listarConversasSimuladas,
  obterTranscricaoSimulada,
} = require("./functions");
const { exec } = require("child_process");
const app = express(); // Ativa o servidor

const supabase = require("./db");
const evolution = require("./lib/evolution.js");

// Simulador local: exige Bearer PROVISION_SECRET apenas quando a env está
// definida. Assim rodar 100% local fica possível sem segredos; em produção
// (Koyeb) o token continua obrigatório.
const autorizadoSimulador = (req) =>
  !process.env.PROVISION_SECRET ||
  req.headers.authorization === `Bearer ${process.env.PROVISION_SECRET}`;

app.use(express.json());

// CORS: permite o painel (Vite: localhost:5173) falar com este backend local.
app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization"
    );
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
});

app.get("/health", (req, res) => {
    res.status(200).json({status: "ok", uptime: process.uptime()})
})

app.post("/provisionar/:empresaId", async (req, res) => {
    if (req.headers.authorization !== `Bearer ${process.env.PROVISION_SECRET}`) {
        return res.status(401).json({ error: "Não autorizado" });
    }

    const empresaId = req.params.empresaId;

    const { data: empresa, error: errEmpresa } = await supabase
        .from("empresas")
        .select("id, instance_name")
        .eq("id", empresaId)
        .maybeSingle();

    if (errEmpresa || !empresa) return res.status(404).json({ error: "Empresa não encontrada" });
    if (empresa.instance_name) {
        return res.status(409).json({ error: "Empresa já possui instância", instance_name: empresa.instance_name });
    }

    const { instanceName } = await evolution.createInstance({ companyId: empresaId });

    const { error: errUpdate } = await supabase
        .from("empresas")
        .update({ instance_name: instanceName, whatsapp_status: "awaiting_qr" })
        .eq("id", empresaId);

    if (errUpdate) {
        await evolution.deleteInstance(instanceName);
        return res.status(500).json({ error: "Falha ao vincular instância à empresa :(" });
    }

    const qrBase64 = await evolution.getQrCode(instanceName);
    res.json({ instanceName, qrBase64 });
});

app.post("/webhook", async (req, res) => {
    const payload = req.body;

    const evento = payload?.event;
    if (evento === "connection.update" || evento === "CONNECTION_UPDATE") {
        const instanceName = payload?.instance ?? payload?.data?.instance;
        const state = payload?.data?.state;

        if (instanceName && state) {
            const novoStatus = state === "open" ? "connected" : state === "close" ? "awaiting_qr" : null;
            if (novoStatus) {
                const { error } = await supabase
                    .from("empresas")
                    .update({ whatsapp_status: novoStatus })
                    .eq("instance_name", instanceName);
                console.log(`[WEBHOOK] 📶 ${instanceName} → ${novoStatus}${error ? " | ERRO: " + error.message : ""}`);
            }
        }
        return res.status(200).json({ ok: true }); // ← early return
    }

    const result = await processWebhook(payload);
    res.status(200).json(result);
});

// ===== Simulador de WhatsApp (mock) =====
// O painel envia aqui a mensagem digitada pelo "cidadão" e recebe a
// saída do bot (texto/botões/listas) para renderizar na tela.
app.post("/simular", async (req, res) => {
    if (!autorizadoSimulador(req)) {
        return res.status(401).json({ error: "Não autorizado" });
    }

    const { empresaId, numero, texto } = req.body || {};
    const resultado = await processSimulatorMessage({ empresaId, numero, texto });
    if (resultado.erro) return res.status(400).json({ error: resultado.erro });
    return res.status(200).json(resultado);
});

app.get("/simular/:empresaId", async (req, res) => {
    if (!autorizadoSimulador(req)) {
        return res.status(401).json({ error: "Não autorizado" });
    }

    const numero = req.query.numero;
    if (numero) {
        const mensagens = obterTranscricaoSimulada(req.params.empresaId, String(numero));
        return res.status(200).json({ numero, mensagens });
    }

    const conversas = listarConversasSimuladas(req.params.empresaId);
    return res.status(200).json({ conversas });
});

app.post("/deploy-hook", (req, res) => {
    console.log("[DEPLOY] Recebido sinal do GitHub. Baixando atualizações...");
    res.status(200).send("Deploy iniciado.");
    exec("git pull origin main && pm2 restart whatsapp-bot", (err, stdout) => {
        if (err) {
            console.error(`[DEPLOY ERRO] ${err}`);
            return;
        }
        console.log(`[DEPLOY SUCESSO] Sistema atualizado e reiniciado!`);
        if (stdout) console.log(`[OUTPUT] ${stdout}`);
    });
});

app.get("/qr/:empresaId", async (req, res) => {
    if (req.headers.authorization !== `Bearer ${process.env.PROVISION_SECRET}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    try {
        const { data: empresa, error } = await supabase
            .from("empresas")
            .select("instance_name, status")
            .eq("id", req.params.empresaId)
            .single();
        if (error || !empresa?.instance_name)
            return res.status(404).json({ error: "Empresa ou instância não encontrada..." });
        if (empresa.status === false)
            return res.status(409).json({ error: "Empresa desativada. Reative antes de conectar." });

        const qrBase64 = await evolution.getQrCode(empresa.instance_name);
        if (!qrBase64) return res.status(409).json({ error: "Instância já conectada." });

        return res.status(200).json({ qrBase64 });
    } catch (error) {
        console.error("[QR]", error.message);
        return res.status(500).json({ error: "Falha ao obter QR" });
    }
});

const PORT = 8000;
app.listen(PORT, () => {
    console.log(`Servidor de triagem iniciado na porta ${PORT}...\n`);
});
