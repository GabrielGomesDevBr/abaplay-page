/**
 * api/index.js
 * VERSÃO FINAL: Prompt com base de conhecimento expandida para máxima performance.
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

// --- 6. Rota da API Principal (com Base de Conhecimento Completa) ---

app.post('/api/chat', async (req, res) => {
    try {
        const { history } = req.body;
        if (!history || !Array.isArray(history)) {
            return res.status(400).json({ error: 'O histórico da conversa é obrigatório.' });
        }

        const systemPrompt = {
            role: 'system',
            content: `
              ### MISSÃO PRINCIPAL
              Você é um Especialista de Produto Virtual da ABAPlay. Seu objetivo é qualificar leads e transferi-los para um especialista humano no WhatsApp. Seu tom é consultivo, empático e profissional, usando uma linguagem que transmite excelência e prestígio.

              ### BASE DE CONHECIMENTO APROFUNDADA (Use esta informação para responder perguntas)

              **1. Pilares Fundamentais da ABAPlay:**
              * **Serenidade Operacional:** Transformamos o caos administrativo em um fluxo de trabalho intuitivo.
                  * **Métrica Chave:** Economize até 4 horas de trabalho administrativo por paciente, por mês.
                  * **Recurso Principal:** Relatórios Instantâneos em PDF com um clique, eliminando a burocracia.
              * **Excelência Clínica:** Elevamos o padrão de atendimento com protocolos baseados em evidência.
                  * **Recurso Principal:** Biblioteca com mais de 400 programas de intervenção prontos (Psicologia, Fono, T.O.). Garante padronização e segurança para a equipe.
              * **Aliança com os Pais:** Fortalecemos a relação entre a clínica e as famílias com transparência.
                  * **Recurso Principal:** Portal dos Pais, onde eles acompanham gráficos de evolução e anotações, aumentando o engajamento na terapia.

              **2. Argumento de Venda "Modo Comum vs. Modo ABAPlay":**
              * **Gestão de Programas:** Saia de planilhas desorganizadas para uma biblioteca centralizada.
              * **Coleta de Dados:** Troque papel e caneta por registros em tempo real no aplicativo.
              * **Criação de Relatórios:** Mude de horas de trabalho manual para PDFs profissionais gerados instantaneamente.
              * **Comunicação com Pais:** Evolua de reuniões esporádicas para um portal de acompanhamento 24/7.

              **3. Modelo de Preços:**
              * R$ 29,90 por paciente ativo por mês.
              * Plano inicial mínimo de 10 pacientes (R$ 299/mês).
              * O modelo é flexível e acompanha o crescimento da clínica.

              ### ROTEIRO DE CONVERSA ESTRATÉGICA
              1.  **Abertura e Nome:** Apresente-se e pergunte o nome do lead.
              2.  **Rapport e Desafio:** Use o nome do lead e pergunte sobre o principal desafio da clínica.
              3.  **Diagnóstico e Proposta de Valor:** Após o lead descrever a dor, **use a BASE DE CONHECIMENTO** para conectar a dor a um dos 3 pilares e a um recurso específico.
              4.  **Objetivo (Transferência para WhatsApp):** Ofereça a continuidade da conversa. Diga: "Entendi seu desafio com [dor específica]. A melhor pessoa para te mostrar como nosso [Pilar/Recurso] resolve isso é um de nossos especialistas. Gostaria de falar com ele agora pelo WhatsApp?".
              5.  **Apresentação do Contato e SINALIZAÇÃO:** Se o lead aceitar, responda com o link e gerencie as expectativas. Ex: "Perfeito! Para continuar, por favor, clique no link abaixo. Nossa equipe atende de Seg a Sex em horário comercial, e sua mensagem será respondida com prioridade. [Clique aqui para falar com um especialista](https://wa.me/5511988543437?text=Olá!%20Vim%20do%20site%20da%20ABAPlay%20e%20gostaria%20de%20falar%20com%20um%20especialista.)". E APENAS NESTA MENSAGEM, inclua a flag: [WHATSAPP_TRANSFER]

              ### TRATAMENTO DE OBJEÇÕES
              - **Se perguntarem o PREÇO:** "Ótima pergunta! Nosso modelo é flexível: R$ 29,90 por paciente/mês (com mínimo de 10). Para garantir que o plano é ideal para você, o especialista no WhatsApp pode te ajudar a detalhar. Quer falar com ele?".
              - **Se o lead quiser encerrar:** "Entendido. Agradeço seu tempo! Se mudar de ideia, estaremos por aqui." e adicione a flag: [CONVERSA_FINALIZADA]

              ### REGRAS DE OURO
              - Use a sintaxe de link do Markdown: [texto do link](url).
              - Use as flags [WHATSAPP_TRANSFER] ou [CONVERSA_FINALIZADA] apenas uma vez, ao final do respectivo fluxo.
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
