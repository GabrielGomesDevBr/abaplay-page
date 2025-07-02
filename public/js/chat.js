/**
 * chat.js
 * VERSÃO FINAL: Lógica para renderizar quebras de linha e links Markdown.
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
        // 1. Escapa HTML para evitar injeção de XSS, exceto o que vamos criar.
        const escapedText = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');

        // 2. Converte quebras de linha \n para <br>
        const withLineBreaks = escapedText.replace(/\n/g, '<br>');

        // 3. Converte links em formato Markdown para tags <a> HTML
        const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
        const htmlLink = '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-brand-accent font-bold hover:underline">$1</a>';
        
        return withLineBreaks.replace(markdownLinkRegex, htmlLink);
    };

    const addMessage = (text, sender) => {
        let messageHtml;
        if (sender === 'user') {
            messageHtml = `<div class="flex items-start gap-3 justify-end"><div class="bg-brand-accent text-white p-3 rounded-lg rounded-tr-none max-w-sm"><p class="text-sm">${text}</p></div></div>`;
        } else {
            // Converte o texto da IA (que pode ter formatação) para HTML.
            const parsedText = parseAssistantText(text);
            messageHtml = `<div class="flex items-start gap-3"><div class="bg-brand-dark text-white p-2 rounded-full flex-shrink-0"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" /></svg></div><div class="bg-gray-100 text-gray-800 p-3 rounded-lg rounded-tl-none max-w-sm"><p class="text-sm">${parsedText}</p></div></div>`;
        }
        messagesContainer.insertAdjacentHTML('beforeend', messageHtml);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
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
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ history: conversationHistory }),
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
            const data = JSON.stringify(conversationHistory);
            navigator.sendBeacon('/api/notify-abandoned', data);
        } else {
            console.log('[DEBUG] Unload event triggered, but no report sent (conversation was concluded or empty).');
        }
    });
});
