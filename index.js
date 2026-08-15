const express = require("express");
const { processWebhook } = require("./functions");
const { exec } = require("child_process");
const app = express(); // Ativa o servidor

const supabase = require("./db");
const evolution = require("./lib/evolution.js");

app.use(express.json());

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
