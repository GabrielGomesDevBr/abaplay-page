/**
 * api/index.js
 * Versão final com fluxo de agendamento completo e notificação dupla.
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
app.use(express.static(path.join(__dirname, '..', 'public')));

// --- 5. Função de Análise e Envio de E-mail ---
/**
 * Analisa a conversa e envia um e-mail de resumo para a equipe de vendas.
 * @param {Array} conversationHistory - O histórico completo da conversa.
 * @param {'SCHEDULED' | 'ENDED'} type - O tipo de resultado da conversa.
 */
async function processConversationAndNotify(conversationHistory, type) {
    console.log(`Iniciando análise do lead. Tipo: ${type}`);
    let analysisPrompt, subject, title;

    if (type === 'SCHEDULED') {
        subject = `[Lead Quente] Novo Agendamento da ABAPlay!`;
        title = `Novo Lead Qualificado!`;
        analysisPrompt = `
            Analise o seguinte histórico de conversa de um lead que ACABOU DE AGENDAR uma demonstração.
            O histórico inclui nome, clínica, e-mail e a data/hora combinada.
            Histórico: ${JSON.stringify(conversationHistory)}
            
            Sua tarefa é gerar um objeto JSON com quatro chaves:
            1. "summary": Um resumo conciso da conversa, destacando a principal "dor" que levou ao agendamento.
            2. "temperature": A temperatura do lead, que para este caso deve ser "Quente".
            3. "meetingDetails": Extraia o e-mail, o dia e a hora combinados para a reunião.
            4. "salesTips": Uma lista de 2 a 3 dicas de abordagem para o vendedor.
            
            Responda APENAS com o objeto JSON.
        `;
    } else { // 'ENDED'
        subject = `[Análise] Conversa Finalizada sem Agendamento`;
        title = `Análise de Conversa Finalizada`;
        analysisPrompt = `
            Analise o seguinte histórico de conversa de um lead que ENCERROU A CONVERSA sem agendar.
            Histórico: ${JSON.stringify(conversationHistory)}
            
            Sua tarefa é gerar um objeto JSON com quatro chaves:
            1. "summary": Um resumo conciso da conversa.
            2. "temperature": A temperatura do lead, classificada como "Frio" ou "Morno".
            3. "reasonForNotScheduling": Uma hipótese do motivo pelo qual o lead não agendou.
            4. "remarketingTips": Uma lista de 1 a 2 ideias para um futuro contato de remarketing.

            Responda APENAS com o objeto JSON.
        `;
    }

    try {
        const analysisCompletion = await openai.chat.completions.create({
            model: "gpt-4.1-nano",
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

        if (type === 'SCHEDULED') {
            emailBody += `
                <h3>Detalhes do Agendamento:</h3>
                <p><strong>E-mail:</strong> ${analysisResult.meetingDetails?.email || 'Não informado'}</p>
                <p><strong>Data/Hora:</strong> ${analysisResult.meetingDetails?.datetime || 'Não informado'}</p>
                <h3>Dicas de Abordagem:</h3>
                <ul>${analysisResult.salesTips.map(tip => `<li>${tip}</li>`).join('')}</ul>`;
        } else {
            emailBody += `
                <p><strong>Hipótese para Não Agendamento:</strong> ${analysisResult.reasonForNotScheduling}</p>
                <h3>Ideias para Remarketing:</h3>
                <ul>${analysisResult.remarketingTips.map(tip => `<li>${tip}</li>`).join('')}</ul>`;
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

// --- 6. Rota da API Principal ---

app.post('/api/chat', async (req, res) => {
    try {
        const { history } = req.body;
        if (!history || !Array.isArray(history)) {
            return res.status(400).json({ error: 'O histórico da conversa é obrigatório.' });
        }

        const systemPrompt = {
            role: 'system',
            content: `
              ### FASE 1: IDENTIDADE E TOM
              Você é o Especialista de Produto Virtual da ABAPlay. Seu tom é consultivo, empático e profissional. Seu objetivo é qualificar o lead e agendar uma demonstração.

              ### FASE 2: BASE DE CONHECIMENTO ESSENCIAL
              Produto: ABAPlay, plataforma para clínicas de desenvolvimento infantil.
              Dores Comuns: Caos administrativo, perda de tempo com relatórios, falta de padronização.
              Soluções: Biblioteca de +400 Programas, Relatórios Instantâneos, Portal dos Pais.

              ### FASE 3: ROTEIRO DE AGENDAMENTO (FLUXO EM MÚLTIPLAS ETAPAS)
              Seu processo de agendamento DEVE seguir estas etapas, UMA DE CADA VEZ:
              1. **Qualificação:** Apresente-se, pergunte nome, clínica e o principal desafio.
              2. **Diagnóstico e Proposta:** Conecte a dor a uma solução e ofereça a demonstração.
              3. **Coleta do E-mail:** Se o cliente aceitar, diga: "Ótimo! Para qual e-mail posso enviar o convite?". NÃO peça a data ainda.
              4. **Coleta da Data/Hora:** APÓS receber o e-mail, diga: "E-mail recebido. Para finalizar, qual é um bom dia e horário para você na próxima semana? Também tenho horários na Terça às 10h ou na Quarta às 15h, se preferir."
              5. **Confirmação Final e SINALIZAÇÃO:** APÓS receber a preferência de data/hora, confirme TUDO na sua resposta. Ex: "Perfeito! Reunião pré-agendada para Terça às 10h. O convite será enviado para o e-mail [e-mail do cliente]. Obrigado!". E APENAS NESTA MENSAGEM FINAL, inclua a flag: [AGENDAMENTO_CONFIRMADO]

              **Sinalização de Encerramento:** Se em qualquer ponto o usuário quiser encerrar sem agendar (ex: "só queria saber o preço", "obrigado"), despeça-se cordialmente e adicione a flag: [CONVERSA_FINALIZADA]

              ### FASE 4: REGRAS DE OURO
              - Siga as etapas do ROTEIRO DE AGENDAMENTO rigorosamente. Não pule etapas.
              - Use apenas uma flag por resposta ([AGENDAMENTO_CONFIRMADO] ou [CONVERSA_FINALIZADA]).
              - Seja sempre conciso.
            `
        };

        const messages = [systemPrompt, ...history];
        
        const chatCompletion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: messages,
        });

        let botReply = chatCompletion.choices[0].message.content;
        
        const finalHistory = [...history, { role: 'assistant', content: botReply }];

        if (botReply.includes('[AGENDAMENTO_CONFIRMADO]')) {
            console.log("Agendamento confirmado detectado! Disparando e-mail...");
            botReply = botReply.replace('[AGENDAMENTO_CONFIRMADO]', '').trim();
            processConversationAndNotify(finalHistory, 'SCHEDULED');
        } 
        else if (botReply.includes('[CONVERSA_FINALIZADA]')) {
            console.log("Conversa finalizada detectada! Disparando e-mail de análise...");
            botReply = botReply.replace('[CONVERSA_FINALIZADA]', '').trim();
            processConversationAndNotify(finalHistory, 'ENDED');
        }
        
        res.json({ reply: botReply });

    } catch (error) {
        console.error("Erro na rota /api/chat:", error);
        res.status(500).json({ error: "Ocorreu um erro ao processar sua mensagem. Tente novamente." });
    }
});


// --- 7. Inicialização do Servidor ---
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta http://localhost:${PORT}`);
});
