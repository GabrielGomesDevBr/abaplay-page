/**
 * api/index.js
 * VERSÃO FINAL: Prompt polido para remover vazamento de formatação e garantir naturalidade.
 */

// --- 1. Importações ---
import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { Resend } from 'resend';

// --- 2. Configuração Inicial ---
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- 3. Instanciação dos Clientes de API ---
if (!process.env.OPENAI_API_KEY || !process.env.RESEND_API_KEY || !process.env.SALES_TEAM_EMAIL) {
    console.error("ERRO: Verifique se OPENAI_API_KEY, RESEND_API_KEY, e SALES_TEAM_EMAIL estão no arquivo .env");
    process.exit(1);
}
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const resend = new Resend(process.env.RESEND_API_KEY);

// --- 4. Middlewares ---
app.use(express.json());
app.use(express.text({ type: 'text/plain' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// --- 5. Função de Análise e Envio de E-mail ---
async function processConversationAndNotify(conversationHistory, type) {
    console.log(`Iniciando processamento de notificação. Tipo: ${type}`);
    
    let analysisPrompt, subject, title, model;
    
    model = "gpt-4o-mini"; 

    if (type === 'TRANSFER') {
        subject = `[Lead para WhatsApp] Novo contato qualificado da ABAPlay!`;
        title = `Lead Quente para Atendimento no WhatsApp!`;
        analysisPrompt = `
            O SDR Virtual qualificou o lead abaixo e o transferiu para o WhatsApp.
            Histórico da conversa: ${JSON.stringify(conversationHistory)}
            
            Sua tarefa é gerar um objeto JSON com três chaves:
            1. "leadName": O nome do lead, se tiver sido informado.
            2. "summary": Um resumo de 1 linha da principal "dor" ou interesse do lead.
            3. "temperature": A temperatura do lead, que para este caso deve ser sempre "Quente".
            
            Responda APENAS com o objeto JSON.
        `;
    } else { // 'ANALYSIS'
        subject = `[Análise] Conversa Finalizada ou Abandonada`;
        title = `Análise de Conversa Não Convertida`;
        analysisPrompt = `
            Analise o seguinte histórico de conversa de um lead que ENCERROU ou ABANDONOU o chat.
            Histórico: ${JSON.stringify(conversationHistory)}
            
            Sua tarefa é gerar um objeto JSON com três chaves:
            1. "summary": Um resumo conciso da conversa.
            2. "temperature": A temperatura do lead, classificada como "Frio" ou "Morno".
            3. "reasonForNotConverting": Uma hipótese do motivo pelo qual o lead não avançou para o WhatsApp.
            
            Responda APENAS com o objeto JSON.
        `;
    }

    try {
        const analysisCompletion = await openai.chat.completions.create({
            model: model,
            messages: [{ role: "user", content: analysisPrompt }],
            response_format: { type: "json_object" },
        });

        const analysisResult = JSON.parse(analysisCompletion.choices[0].message.content);
        
        const historyHtml = conversationHistory.map(msg => 
            `<p><strong>${msg.role === 'user' ? 'Lead' : 'SDR Virtual'}:</strong> ${msg.content}</p>`
        ).join('');

        let emailBody = `<h1>${title}</h1>
            <p><strong>Temperatura:</strong> ${analysisResult.temperature}</p>
            <p><strong>Resumo da IA:</strong> ${analysisResult.summary}</p>`;

        if (type === 'TRANSFER') {
            emailBody += `<p><strong>Nome do Lead:</strong> ${analysisResult.leadName || 'Não informado'}</p>
                          <p><strong>Ação Imediata:</strong> Entrar em contato com este lead no WhatsApp.</p>`;
        } else {
            emailBody += `<p><strong>Hipótese para Não Conversão:</strong> ${analysisResult.reasonForNotConverting}</p>`;
        }

        emailBody += `<hr><h2>Histórico Completo da Conversa</h2>${historyHtml}`;
        
        await resend.emails.send({
            from: 'onboarding@resend.dev',
            to: process.env.SALES_TEAM_EMAIL,
            subject: subject,
            html: emailBody,
        });
        
        console.log(`E-mail de notificação (Tipo: ${type}) enviado com sucesso!`);

    } catch (error) {
        console.error(`Falha ao processar e-mail do tipo ${type}:`, error);
    }
}

// --- 6. Rota da API Principal (com Prompt Final Polido) ---

app.post('/api/chat', async (req, res) => {
    try {
        const { history } = req.body;
        if (!history || !Array.isArray(history)) {
            return res.status(400).json({ error: 'O histórico da conversa é obrigatório.' });
        }

        const systemPrompt = {
            role: 'system',
            content: `
              ### MISSÃO
              Você é um Especialista de Produto Virtual da ABAPlay. Seu objetivo é qualificar leads e transferi-los para um especialista humano no WhatsApp. Seu tom é consultivo, empático e profissional.

              ### BASE DE CONHECIMENTO
              - Nossos Pilares:
                - Serenidade Operacional: Organizamos a gestão e economizamos tempo com relatórios de 1 clique.
                - Excelência Clínica: Padronizamos o atendimento com mais de 400 programas de intervenção.
                - Aliança com os Pais: Aumentamos a confiança com um portal de acompanhamento.
              - Nosso Preço: R$ 29,90 por paciente/mês (mínimo de 10).

              ### DIRETRIZES DE CONVERSA
              1.  Conecte-se: Seja amigável, pergunte o nome e a clínica. NÃO seja repetitivo.
              2.  Entenda a Dor: Descubra o principal desafio do lead.
              3.  Apresente a Solução: Conecte a dor a um de nossos pilares de forma breve e clara.
              4.  Transfira para o Especialista: Após apresentar a solução, seu próximo passo é SEMPRE convidar para o WhatsApp.
                  - Se o lead aceitar, sua resposta DEVE conter, juntos, o link e a informação de horário. Exemplo: "Perfeito! Para continuar, por favor, clique no link abaixo. Nossa equipe atende de Seg a Sex em horário comercial, e sua mensagem será respondida com prioridade. [Clique aqui para falar com um especialista](https://wa.me/5511988543437?text=Olá!%20Vim%20do%20site%20da%20ABAPlay%20e%20gostaria%20de%20falar%20com%20um%20especialista.)"
                  - Ao fazer isso, adicione a flag [WHATSAPP_TRANSFER] no final da sua mensagem.

              ### REGRAS GERAIS
              - Objeção de Preço: Seja transparente sobre o valor e reforce que o especialista no WhatsApp pode detalhar.
              - Recusa: Se o lead não quiser continuar, seja educado e use a flag [CONVERSA_FINALIZADA].
            `
        };

        const messages = [systemPrompt, ...history];
        
        const chatCompletion = await openai.chat.completions.create({
            model: "gpt-4.1-nano",
            messages: messages,
        });

        let botReply = chatCompletion.choices[0].message.content;
        
        const finalHistory = [...history, { role: 'assistant', content: botReply }];

        if (botReply.includes('[WHATSAPP_TRANSFER]')) {
            console.log("Transferência para WhatsApp detectada! Disparando e-mail de alerta...");
            botReply = botReply.replace('[WHATSAPP_TRANSFER]', '').trim();
            processConversationAndNotify(finalHistory, 'TRANSFER');
        } 
        else if (botReply.includes('[CONVERSA_FINALIZADA]')) {
            console.log("Conversa finalizada detectada! Disparando e-mail de análise...");
            botReply = botReply.replace('[CONVERSA_FINALIZADA]', '').trim();
            processConversationAndNotify(finalHistory, 'ANALYSIS');
        }
        
        res.json({ reply: botReply });

    } catch (error) {
        console.error("Erro na rota /api/chat:", error);
        res.status(500).json({ error: "Ocorreu um erro ao processar sua mensagem. Tente novamente." });
    }
});

app.post('/api/notify-abandoned', (req, res) => {
    try {
        const history = JSON.parse(req.body);

        if (history && Array.isArray(history) && history.length > 1) {
            console.log("Conversa abandonada detectada! Disparando e-mail de análise...");
            processConversationAndNotify(history, 'ANALYSIS');
        } else {
            console.log("Recebida notificação de abandono, mas sem histórico de conversa válido para processar.");
        }
        
        res.status(204).send();
    } catch (error) {
        console.error("Erro na rota /api/notify-abandoned:", error);
        res.status(500).send("Erro ao processar a notificação de abandono.");
    }
});


// --- 7. Inicialização do Servidor ---
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta http://localhost:${PORT}`);
});
