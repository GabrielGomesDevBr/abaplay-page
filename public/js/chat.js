/**
 * chat.js
 * Versão final e corrigida. Usa classes CSS para controlar o estado do botão,
 * garantindo que o evento de clique nunca seja perdido.
 */
document.addEventListener('DOMContentLoaded', () => {

    console.log('[DEBUG] Chat script loaded and DOM is ready.');

    const messagesContainer = document.querySelector('.chat-messages-container');
    const chatInput = document.querySelector('.p-4 input[type="text"]');
    const sendButton = document.querySelector('.chat-send-btn'); // Seletor mais específico

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
             // Impede envios múltiplos se já estiver carregando
            return;
        }

        addMessage(messageText, 'user');
        conversationHistory.push({ role: 'user', content: messageText });
        
        chatInput.value = '';
        chatInput.focus();

        // Ativa o estado de 'carregando' usando classes CSS
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
            const botReply = data.reply;
            
            addMessage(botReply, 'assistant');
            conversationHistory.push({ role: 'assistant', content: botReply });

        } catch (error) {
            console.error("[DEBUG] CRITICAL: An error occurred during the fetch.", error);
            addMessage("Desculpe, ocorreu um erro de comunicação. Nossa equipe foi notificada.", 'assistant');
        } finally {
            // Restaura o botão ao seu estado original usando classes CSS
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
});
