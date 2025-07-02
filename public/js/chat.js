/**
 * chat.js
 * Versão final e corrigida. Usa classes CSS para controlar o estado do botão.
 * ADICIONADO: Lógica para detectar o abandono da página e notificar o backend.
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

    // Histórico inicial da conversa
    let conversationHistory = [
        {
            role: 'assistant',
            content: 'Olá! Sou o assistente virtual da ABAPlay, pronto para ajudar. Para começarmos, qual o seu nome e o da sua clínica?'
        }
    ];

    // --- NOVA VARIÁVEL ---
    // Flag para controlar se a conversa já foi concluída (com sucesso ou não).
    // Isso evita que o evento 'beforeunload' envie um relatório desnecessário.
    let isConversationConcluded = false;

    const addMessage = (text, sender) => {
        let messageElement;
        if (sender === 'user') {
            messageElement = `<div class="flex items-start gap-3 justify-end"><div class="bg-brand-accent text-white p-3 rounded-lg rounded-tr-none max-w-sm"><p class="text-sm">${text}</p></div></div>`;
        } else {
            messageElement = `<div class="flex items-start gap-3"><div class="bg-brand-dark text-white p-2 rounded-full flex-shrink-0"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" /></svg></div><div class="bg-gray-100 text-gray-800 p-3 rounded-lg rounded-tl-none max-w-sm"><p class="text-sm">${text}</p></div></div>`;
        }
        messagesContainer.insertAdjacentHTML('beforeend', messageElement);
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
        console.log('[DEBUG] Button state set to LOADING.');

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ history: conversationHistory }),
            });

            console.log(`[DEBUG] API response received. Status: ${response.status}`);

            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`API Error ${response.status}: ${response.statusText}. Body: ${errorBody}`);
            }

            const data = await response.json();
            let botReply = data.reply;

            // --- LÓGICA DA FLAG DE CONCLUSÃO ---
            // Verifica se a resposta contém as flags de conclusão.
            if (botReply.includes('[AGENDAMENTO_CONFIRMADO]') || botReply.includes('[CONVERSA_FINALIZADA]')) {
                isConversationConcluded = true;
                console.log('[DEBUG] Conversation marked as concluded. Abandonment report will be disabled.');
                // Remove as flags da resposta antes de exibir (já feito no backend, mas garantimos aqui também)
                botReply = botReply.replace('[AGENDAMENTO_CONFIRMADO]', '').replace('[CONVERSA_FINALIZADA]', '').trim();
            }
            
            addMessage(botReply, 'assistant');
            conversationHistory.push({ role: 'assistant', content: botReply });

        } catch (error) {
            console.error("[DEBUG] CRITICAL: An error occurred during the fetch.", error);
            addMessage("Desculpe, ocorreu um erro de comunicação. Nossa equipe foi notificada.", 'assistant');
        } finally {
            sendButton.disabled = false;
            sendButton.classList.remove('is-loading');
            console.log('[DEBUG] Button state restored to original in finally block.');
        }
    };

    sendButton.addEventListener('click', handleSendMessage);
    chatInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            handleSendMessage();
        }
    });

    // --- NOVA LÓGICA DE DETECÇÃO DE ABANDONO ---
    window.addEventListener('beforeunload', (event) => {
        // Condições para enviar o relatório:
        // 1. A conversa NÃO pode ter sido marcada como concluída.
        // 2. O histórico deve ter mais de uma mensagem (a inicial do bot).
        if (!isConversationConcluded && conversationHistory.length > 1) {
            console.log('[DEBUG] Unload event triggered. Sending abandonment report.');
            
            // Usamos navigator.sendBeacon para garantir o envio dos dados.
            // Ele é projetado para funcionar mesmo quando a página está sendo descarregada.
            const data = JSON.stringify(conversationHistory);
            navigator.sendBeacon('/api/notify-abandoned', data);
        } else {
            console.log('[DEBUG] Unload event triggered, but no report sent (conversation was concluded or empty).');
        }
    });
});
