/**
 * chat.js
 * VERSÃO FASE 2: Integração com o dataCollector.js para enviar dados do visitante.
 */
document.addEventListener('DOMContentLoaded', () => {

    console.log('[DEBUG] Chat script loaded and DOM is ready.');

    const messagesContainer = document.querySelector('.chat-messages-container');
    const chatInput = document.querySelector('.p-4 input[type="text"]');
    const sendButton = document.querySelector('.chat-send-btn');

    if (!messagesContainer || !chatInput || !sendButton) {
        console.error("[DEBUG] Um ou mais elementos do chat não foram encontrados.");
        return;
    }
    console.log('[DEBUG] Chat elements selected successfully.');

    let conversationHistory = [
        {
            role: 'assistant',
            content: 'Olá! Sou o assistente virtual da ABAPlay, pronto para ajudar. Para começarmos, qual o seu nome e o da sua clínica?'
        }
    ];

    let isConversationConcluded = false;

    /**
     * Função auxiliar para converter o texto da IA em HTML formatado.
     * @param {string} text - O texto que pode conter quebras de linha e links Markdown.
     * @returns {string} - O texto com a formatação convertida para HTML.
     */
    const parseAssistantText = (text) => {
        const escapedText = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const withLineBreaks = escapedText.replace(/\n/g, '<br>');
        const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
        const htmlLink = '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-brand-accent font-bold hover:underline">$1</a>';
        return withLineBreaks.replace(markdownLinkRegex, htmlLink);
    };

    const addMessage = (text, sender) => {
        let messageHtml;
        if (sender === 'user') {
            messageHtml = `<div class="flex items-start gap-3 justify-end"><div class="bg-brand-accent text-white p-3 rounded-lg rounded-tr-none max-w-sm"><p class="text-sm">${text}</p></div></div>`;
        } else {
            const parsedText = parseAssistantText(text);
            messageHtml = `<div class="flex items-start gap-3"><div class="bg-brand-dark text-white p-2 rounded-full flex-shrink-0"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" /></svg></div><div class="bg-gray-100 text-gray-800 p-3 rounded-lg rounded-tl-none max-w-sm"><p class="text-sm">${parsedText}</p></div></div>`;
        }
        messagesContainer.insertAdjacentHTML('beforeend', messageHtml);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    };
    
    /**
     * NOVO: Função para obter os dados do visitante, incluindo o cálculo do tempo antes do chat.
     */
    const getVisitorDataPayload = () => {
        if (window.visitorTracker && window.visitorTracker.data) {
            // Calcula o tempo em segundos desde o carregamento da página até este momento.
            // Isso só é feito uma vez.
            if (window.visitorTracker.data.behavioral.timeOnPageBeforeChat === null) {
                const timeNow = Date.now();
                const timeDiffSeconds = Math.round((timeNow - window.visitorTracker.pageLoadTime) / 1000);
                window.visitorTracker.data.behavioral.timeOnPageBeforeChat = timeDiffSeconds;
            }
            return window.visitorTracker.data;
        }
        // Retorna null se o tracker não for encontrado.
        return null; 
    };

    const handleSendMessage = async () => {
        const messageText = chatInput.value.trim();
        if (!messageText || sendButton.classList.contains('is-loading')) {
            return;
        }

        addMessage(messageText, 'user');
        conversationHistory.push({ role: 'user', content: messageText });
        
        chatInput.value = '';
        chatInput.focus();

        sendButton.disabled = true;
        sendButton.classList.add('is-loading');

        try {
            // ATUALIZADO: Coleta os dados do visitante para enviar no payload.
            const visitorData = getVisitorDataPayload();
            
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // ATUALIZADO: O corpo da requisição agora inclui o histórico e os dados do visitante.
                body: JSON.stringify({ 
                    history: conversationHistory,
                    visitorData: visitorData 
                }),
            });

            if (!response.ok) {
                throw new Error(`API Error ${response.status}`);
            }

            const data = await response.json();
            let botReply = data.reply;

            if (botReply.includes('[WHATSAPP_TRANSFER]') || botReply.includes('[CONVERSA_FINALIZADA]')) {
                isConversationConcluded = true;
                console.log('[DEBUG] Conversation marked as concluded. Abandonment report will be disabled.');
            }
            
            addMessage(botReply, 'assistant');
            conversationHistory.push({ role: 'assistant', content: botReply });

        } catch (error) {
            console.error("[DEBUG] CRITICAL: An error occurred during the fetch.", error);
            addMessage("Desculpe, ocorreu um erro de comunicação. Nossa equipe foi notificada.", 'assistant');
        } finally {
            sendButton.disabled = false;
            sendButton.classList.remove('is-loading');
        }
    };

    sendButton.addEventListener('click', handleSendMessage);
    chatInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            handleSendMessage();
        }
    });

    window.addEventListener('beforeunload', () => {
        if (!isConversationConcluded && conversationHistory.length > 1) {
            console.log('[DEBUG] Unload event triggered. Sending abandonment report.');
            
            // ATUALIZADO: Inclui os dados do visitante no relatório de abandono.
            const visitorData = getVisitorDataPayload();
            const payload = {
                history: conversationHistory,
                visitorData: visitorData
            };
            
            navigator.sendBeacon('/api/notify-abandoned', JSON.stringify(payload));
        } else {
            console.log('[DEBUG] Unload event triggered, but no report sent (conversation was concluded or empty).');
        }
    });
});
