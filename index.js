const express = require("express");
const {processWebhook} = require("./functions");
const {exec} = require("child_process");
const app = express(); // Ativa o servidor

const evolution = require('./lib/evolution.js')

app.use(express.json());

app.post("/webhook", async (req, res) => {
    const result = await processWebhook(req.body);
    res.status(200).json(result);
});

app.post("/deploy-hook", (req, res) => {
    console.log("[DEPLOY] Recebido sinal do GitHub. Baixando atualizações...");
    res.status(200).send("Deploy iniciado.");
    exec(
        "git pull origin main && pm2 restart whatsapp-bot",
        (err, stdout) => {
            if (err) {
                console.error(`[DEPLOY ERRO] ${err}`);
                return;
            }
            console.log(`[DEPLOY SUCESSO] Sistema atualizado e reiniciado!`);
            if (stdout) console.log(`[OUTPUT] ${stdout}`);
        },
    );
});

const PORT = 8000;
app.listen(PORT, () => {
    console.log(`Servidor de triagem iniciado na porta ${PORT}...\n`);
});
