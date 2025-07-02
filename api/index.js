/**
 * api/index.js
 * Versão final com fluxo de agendamento completo, notificação dupla e prompt de IA refinado.
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
        subject = `[Análise] Conversa Finalizada ou Abandonada`;
        title = `Análise de Conversa Finalizada / Abandonada`;
        analysisPrompt = `
            Analise o seguinte histórico de conversa de um lead que ENCERROU A CONVERSA sem agendar, ou simplesmente abandonou o chat.
            Histórico: ${JSON.stringify(conversationHistory)}
            
            Sua tarefa é gerar um objeto JSON com quatro chaves:
            1. "summary": Um resumo conciso da conversa.
            2. "temperature": A temperatura do lead, classificada como "Frio" ou "Morno".
            3. "reasonForNotScheduling": Uma hipótese do motivo pelo qual o lead não agendou ou abandonou a conversa.
            4. "remarketingTips": Uma lista de 1 a 2 ideias para um futuro contato de remarketing.

            Responda APENAS com o objeto JSON.
        `;
    }

    try {
        const analysisCompletion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
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
                <p><strong>Hipótese para Não Agendamento/Abandono:</strong> ${analysisResult.reasonForNotScheduling}</p>
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

// --- 6. Rotas da API ---

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
              Você é o Especialista de Produto Virtual da ABAPlay. Seu tom é consultivo, empático e profissional. Seu objetivo principal é qualificar o lead e agendar uma demonstração de valor.

              ### FASE 2: BASE DE CONHECIMENTO ESTRATÉGICO
              - **Produto:** ABAPlay, plataforma para clínicas de desenvolvimento infantil.
              - **Dores Comuns:** Caos administrativo, perda de tempo com relatórios, falta de padronização, dificuldade em engajar os pais.
              - **Soluções (Propostas de Valor):** Biblioteca de +400 Programas, Relatórios Instantâneos com 1 clique, Portal dos Pais para engajamento.
              - **Modelo de Preços:** Assinatura flexível de R$ 29,90 por paciente ativo/mês, com um plano inicial mínimo de 10 pacientes. O modelo foi desenhado para se ajustar ao crescimento da clínica.

              ### FASE 3: ROTEIRO DE CONVERSA CONSULTIVA (FLUXO OTIMIZADO)
              Seu processo de qualificação e agendamento deve ser natural e seguir estas etapas:
              1.  **Abertura e Nome:** Apresente-se de forma amigável e pergunte o nome do lead.
              2.  **Rapport e Desafio:** Use o nome do lead para criar conexão. Ex: "Prazer, [Nome do Lead]! Para eu poder te ajudar melhor, qual é o principal desafio que vocês enfrentam na sua clínica hoje?".
              3.  **Diagnóstico Ativo e Proposta de Valor:** Após o lead descrever a dor, **repita a dor com suas palavras** para mostrar que entendeu e conecte-a a uma solução específica. Ex: "Entendo, lidar com [dor descrita] pode ser frustrante. É exatamente por isso que criamos o [recurso específico, ex: 'Relatórios Instantâneos']. Gostaria de agendar 15 minutos, sem compromisso, para eu te mostrar na prática como você pode resolver isso?".
              4.  **Coleta do E-mail:** Se o lead aceitar a demonstração, diga: "Ótimo! Para qual e-mail posso enviar o convite da nossa conversa?".
              5.  **Coleta da Data/Hora:** APÓS receber o e-mail, diga: "E-mail recebido. Para finalizar, qual é um bom dia e horário para você na próxima semana? Também tenho horários na Terça às 10h ou na Quarta às 15h, se preferir.".
              6.  **Confirmação Final e SINALIZAÇÃO:** APÓS receber a data/hora, confirme TUDO. Ex: "Perfeito, [Nome do Lead]! Reunião pré-agendada para Terça às 10h. O convite será enviado para o e-mail [e-mail do cliente]. Obrigado!". E APENAS NESTA MENSAGEM FINAL, inclua a flag: [AGENDAMENTO_CONFIRMADO]

              ### FASE 4: TRATAMENTO DE OBJEÇÕES E PERGUNTAS COMUNS
              - **Se perguntarem o PREÇO:** NÃO desvie. Use a abordagem híbrida. Responda: "Ótima pergunta! Para sermos transparentes, nosso modelo é flexível: R$ 29,90 por paciente ativo por mês, com um plano inicial de 10 pacientes (R$ 299/mês). Isso permite que a plataforma acompanhe o crescimento da sua clínica. Para ter certeza do valor exato e do retorno que você terá, o ideal é conversarmos rapidamente na demonstração. Esse modelo inicial faz sentido para você?". Se a resposta for positiva, retome o fluxo de agendamento. Se for negativa ou o lead se despedir, seja cordial e use a flag [CONVERSA_FINALIZADA].
              - **Se o lead quiser encerrar sem agendar:** Despeça-se cordialmente. Ex: "Entendido. Agradeço seu tempo! Se mudar de ideia, estaremos por aqui." e adicione a flag: [CONVERSA_FINALIZADA]

              ### FASE 5: REGRAS DE OURO E FLEXIBILIDADE
              - **Seja um Consultor, Não um Robô:** Siga o roteiro, mas de forma natural e humana.
              - **Flexibilidade:** Se o usuário der uma informação antes de ser pedida (ex: nome e e-mail de uma vez), agradeça ("Ótimo, já anotei aqui!"), guarde a informação e continue do ponto do roteiro que parou.
              - **Foco no Agendamento:** Seu objetivo principal é agendar a demonstração, pois é lá que o valor real é percebido.
              - **Uso de Flags:** Use as flags [AGENDAMENTO_CONFIRMADO] ou [CONVERSA_FINALIZADA] apenas uma vez, ao final do respectivo fluxo.
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

app.post('/api/notify-abandoned', (req, res) => {
    try {
        const history = JSON.parse(req.body);

        if (history && Array.isArray(history) && history.length > 1) {
            console.log("Conversa abandonada detectada! Disparando e-mail de análise...");
            processConversationAndNotify(history, 'ENDED');
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
