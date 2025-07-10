/**
 * api/index.js
 * VERSÃO FINAL CORRIGIDA: Link do WhatsApp restaurado no prompt da IA.
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
app.use(express.text({ type: 'text/plain', limit: '50kb' })); 
app.use(express.static(path.join(__dirname, '..', 'public')));


// --- 5. Funções Auxiliares ---

function createVisitorDataTable(visitorData) {
    if (!visitorData) {
        return '<p>Nenhum dado adicional do visitante foi coletado.</p>';
    }

    const data = {
        'Informações Técnicas': {
            'Dispositivo': visitorData.technical?.device,
            'Sistema Operacional': visitorData.technical?.os,
            'Navegador': visitorData.technical?.browser,
            'Resolução da Tela': visitorData.technical?.screenResolution,
            'Idioma': visitorData.technical?.language,
        },
        'Informações Geográficas': {
            'Fuso Horário': visitorData.geographical?.timezone,
            'Status da Localização': visitorData.geographical?.location?.status,
            'Latitude': visitorData.geographical?.location?.latitude,
            'Longitude': visitorData.geographical?.location?.longitude,
        },
        'Contexto e Comportamento': {
            'Origem do Tráfego': visitorData.context?.trafficSource,
            'Página de Acesso': visitorData.context?.landingPage,
            'Data de Acesso (UTC)': visitorData.context?.accessTimestamp,
            'Tempo na Página antes do Chat': `${visitorData.behavioral?.timeOnPageBeforeChat || 'N/A'} segundos`,
            'Profundidade de Rolagem': `${visitorData.behavioral?.scrollDepth || 0}%`,
        }
    };

    let html = '<h2>Contexto do Visitante</h2><table border="1" cellpadding="8" cellspacing="0" style="border-collapse: collapse; width: 100%; font-family: sans-serif; border-color: #dee2e6;">';

    for (const category in data) {
        html += `<tr style="background-color: #f8f9fa;"><th colspan="2" style="text-align: left; padding: 10px;">${category}</th></tr>`;
        for (const [key, value] of Object.entries(data[category])) {
            html += `<tr><td style="width: 40%; font-weight: bold;">${key}</td><td>${value || 'Não disponível'}</td></tr>`;
        }
    }

    html += '</table>';
    return html;
}

async function processConversationAndNotify(conversationHistory, visitorData, type) {
    console.log(`Iniciando processamento de notificação. Tipo: ${type}`);
    
    let analysisPrompt, subject, title;
    const model = "gpt-4o-mini"; 
    const visitorDataContext = JSON.stringify(visitorData, null, 2);

    if (type === 'TRANSFER') {
        subject = `[Lead para WhatsApp] Novo contato qualificado da ABAPlay!`;
        title = `Lead Quente para Atendimento no WhatsApp!`;
        analysisPrompt = `
            Você é um analista de vendas sênior. Um SDR Virtual qualificou o lead abaixo e o transferiu para o WhatsApp.
            
            HISTÓRICO DA CONVERSA:
            ${JSON.stringify(conversationHistory)}

            DADOS DO VISITANTE:
            ${visitorDataContext}
            
            Sua tarefa é gerar um objeto JSON com quatro chaves:
            1. "leadName": O nome do lead, se tiver sido informado.
            2. "summary": Um resumo de 1 linha da principal "dor" ou interesse do lead.
            3. "temperature": A temperatura do lead, que para este caso deve ser sempre "Quente".
            4. "salesInsight": Uma dica de abordagem curta e acionável para o vendedor, baseada em TODOS os dados (conversa e contexto do visitante). Ex: "Lead veio do Instagram no celular, sugere urgência. Foque no Portal dos Pais."
            
            Responda APENAS com o objeto JSON.
        `;
    } else { // 'ANALYSIS'
        subject = `[Análise] Conversa Finalizada ou Abandonada`;
        title = `Análise de Conversa Não Convertida`;
        analysisPrompt = `
            Você é um analista de vendas sênior. Analise o seguinte histórico de conversa de um lead que ENCERROU ou ABANDONOU o chat.
            
            HISTÓRICO DA CONVERSA:
            ${JSON.stringify(conversationHistory)}

            DADOS DO VISITANTE:
            ${visitorDataContext}
            
            Sua tarefa é gerar um objeto JSON com quatro chaves:
            1. "summary": Um resumo conciso da conversa.
            2. "temperature": A temperatura do lead, classificada como "Frio" ou "Morno".
            3. "reasonForNotConverting": Uma hipótese do motivo pelo qual o lead não avançou, baseada na conversa.
            4. "salesInsight": Uma dica para uma futura abordagem ou uma observação relevante baseada em TODOS os dados (conversa e contexto do visitante).
            
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
            `<p style="margin: 5px 0;"><strong>${msg.role === 'user' ? 'Lead' : 'SDR Virtual'}:</strong> ${msg.content}</p>`
        ).join('');
        
        const visitorDataHtml = createVisitorDataTable(visitorData);

        let emailBody = `
            <div style="font-family: Arial, sans-serif; color: #333;">
                <h1 style="color: #0d1117;">${title}</h1>
                
                <h2>Análise da IA</h2>
                <p><strong>Temperatura:</strong> ${analysisResult.temperature || 'N/A'}</p>
                <p><strong>Resumo:</strong> ${analysisResult.summary || 'N/A'}</p>`;

        if (type === 'TRANSFER') {
            emailBody += `<p><strong>Nome do Lead:</strong> ${analysisResult.leadName || 'Não informado'}</p>
                          <p><strong>Insight para Vendas:</strong> ${analysisResult.salesInsight || 'Nenhum insight gerado.'}</p>
                          <p><strong>Ação Imediata:</strong> Entrar em contato com este lead no WhatsApp.</p>`;
        } else {
            emailBody += `<p><strong>Hipótese para Não Conversão:</strong> ${analysisResult.reasonForNotConverting || 'N/A'}</p>
                          <p><strong>Observação da IA:</strong> ${analysisResult.salesInsight || 'Nenhuma observação gerada.'}</p>`;
        }

        emailBody += `<hr style="margin: 20px 0;">
                      ${visitorDataHtml}
                      <hr style="margin: 20px 0;">
                      <h2>Histórico Completo da Conversa</h2>
                      <div style="background-color: #f1f1f1; padding: 15px; border-radius: 8px;">${historyHtml}</div>
            </div>`;
        
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

// --- 6. Rotas da API ---

app.post('/api/chat', async (req, res) => {
    try {
        const { history, visitorData } = req.body;
        if (!history || !Array.isArray(history)) {
            return res.status(400).json({ error: 'O histórico da conversa é obrigatório.' });
        }

        const systemPrompt = {
            role: 'system',
            content: `
              ### MISSÃO
              Você é um Especialista de Produto Virtual da ABAPlay. Seu objetivo é qualificar leads (entendendo a dor principal) e transferi-los para um especialista humano no WhatsApp. Seu tom é sempre consultivo, empático e profissional.

              ### BASE DE CONHECIMENTO
              - Nossos Pilares: Serenidade Operacional, Excelência Clínica, Aliança com os Pais.
              - Nosso Preço: R$ 34,90 por paciente/mês (mínimo de 10).

              ### REGRAS CRÍTICAS DE AÇÃO
              1.  SEJA NATURAL: Converse como um humano. Faça uma pergunta de cada vez.
              2.  QUALIFIQUE: Entenda o nome do lead, a clínica e o principal desafio.
              3.  CONECTE E CONVIDE: Após entender o desafio, conecte-o a um pilar e IMEDIATAMENTE convide para o WhatsApp.
              
              4.  EXECUTE A TRANSFERÊNCIA: Se o lead ACEITAR o convite para o WhatsApp (dizendo "sim", "claro", "aceito", etc.), sua resposta DEVE ser esta e SOMENTE esta, com a formatação exata:
                  "Perfeito! Para continuar, por favor, clique no link abaixo. Nossa equipe atende de Seg a Sex em horário comercial, e sua mensagem será respondida com prioridade.

                  [Clique aqui para falar com um especialista](https://wa.me/5511988543437?text=Olá!%20Vim%20do%20site%20da%20ABAPlay%20e%20gostaria%20de%20falar%20com%20um%20especialista.)"
                  E então, adicione a flag [WHATSAPP_TRANSFER] no final.

              5.  ENCERRAMENTO: Se o lead RECUSAR o convite ou indicar que não quer mais conversar (ex: "só queria o preço", "obrigado", "não agora"), seja educado, agradeça e finalize. Sua resposta DEVE terminar com a flag [CONVERSA_FINALIZADA].
            `
        };

        const messages = [systemPrompt, ...history];
        
        const chatCompletion = await openai.chat.completions.create({
            model: "gpt-4.1-nano",
            messages: messages,
        });

        let botReply = chatCompletion.choices[0].message.content;
        
        let conclusionStatus = null;
        let finalHistory = [...history];

        if (botReply.includes('[WHATSAPP_TRANSFER]')) {
            console.log("Transferência para WhatsApp detectada! Disparando e-mail de alerta...");
            botReply = botReply.replace('[WHATSAPP_TRANSFER]', '').trim();
            conclusionStatus = 'TRANSFER';
            finalHistory.push({ role: 'assistant', content: botReply });
            processConversationAndNotify(finalHistory, visitorData, 'TRANSFER');
        } 
        else if (botReply.includes('[CONVERSA_FINALIZADA]')) {
            console.log("Conversa finalizada detectada! Disparando e-mail de análise...");
            botReply = botReply.replace('[CONVERSA_FINALIZADA]', '').trim();
            conclusionStatus = 'FINALIZED';
            finalHistory.push({ role: 'assistant', content: botReply });
            processConversationAndNotify(finalHistory, visitorData, 'ANALYSIS');
        } else {
            finalHistory.push({ role: 'assistant', content: botReply });
        }
        
        res.json({ reply: botReply, conclusion: conclusionStatus });

    } catch (error) {
        console.error("Erro na rota /api/chat:", error);
        res.status(500).json({ error: "Ocorreu um erro ao processar sua mensagem. Tente novamente." });
    }
});

app.post('/api/notify-abandoned', (req, res) => {
    try {
        const { history, visitorData } = JSON.parse(req.body);

        if (history && Array.isArray(history) && history.length > 1) {
            console.log("Conversa abandonada detectada! Disparando e-mail de análise...");
            processConversationAndNotify(history, visitorData, 'ANALYSIS');
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
