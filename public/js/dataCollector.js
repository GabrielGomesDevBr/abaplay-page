/**
 * dataCollector.js
 * * Responsável por coletar dados técnicos, contextuais, geográficos e
 * comportamentais do visitante para enriquecer o perfil do lead.
 * * O objeto final fica disponível globalmente em `window.visitorTracker.data`.
 */
document.addEventListener('DOMContentLoaded', () => {

    // Objeto principal que será exposto globalmente.
    const visitorTracker = {
        pageLoadTime: Date.now(),
        data: {
            technical: {
                os: 'Desconhecido',
                browser: 'Desconhecido',
                device: 'Desconhecido',
                screenResolution: 'Desconhecido',
                language: 'Desconhecido',
            },
            geographical: {
                timezone: 'Desconhecido',
                location: {
                    status: 'Não solicitado', // 'Permitido', 'Negado'
                    latitude: null,
                    longitude: null,
                },
            },
            context: {
                accessTimestamp: new Date().toISOString(),
                trafficSource: 'Direto ou indefinido',
                landingPage: window.location.href,
            },
            behavioral: {
                timeOnPageBeforeChat: null, // Será calculado no chat.js
                scrollDepth: 0,
            },
        },

        // --- Funções de Coleta ---

        getTechnicalData() {
            // Idioma
            this.data.technical.language = navigator.language || navigator.userLanguage;

            // Resolução da tela
            if (window.screen) {
                this.data.technical.screenResolution = `${window.screen.width}x${window.screen.height}`;
            }

            // User Agent para OS, Navegador e Dispositivo
            const ua = navigator.userAgent;
            
            // Sistema Operacional
            if (ua.includes('Win')) this.data.technical.os = 'Windows';
            else if (ua.includes('Mac')) this.data.technical.os = 'macOS';
            else if (ua.includes('Linux')) this.data.technical.os = 'Linux';
            else if (ua.includes('Android')) this.data.technical.os = 'Android';
            else if (ua.includes('like Mac')) this.data.technical.os = 'iOS'; // iPhone/iPad

            // Navegador
            if (ua.includes('Chrome') && !ua.includes('Edg')) this.data.technical.browser = 'Chrome';
            else if (ua.includes('Firefox')) this.data.technical.browser = 'Firefox';
            else if (ua.includes('Safari') && !ua.includes('Chrome')) this.data.technical.browser = 'Safari';
            else if (ua.includes('Edg')) this.data.technical.browser = 'Edge';
            
            // Dispositivo
            if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) {
                this.data.technical.device = 'Tablet';
            } else if (/Mobile|iP(hone|od)|Android|BlackBerry|IEMobile|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/.test(ua)) {
                this.data.technical.device = 'Mobile';
            } else {
                this.data.technical.device = 'Desktop';
            }
        },

        getContextData() {
            if (document.referrer) {
                try {
                    const referrerUrl = new URL(document.referrer);
                    if (referrerUrl.hostname !== window.location.hostname) {
                        this.data.context.trafficSource = referrerUrl.hostname;
                    }
                } catch (error) {
                    // Referrer pode não ser uma URL válida
                    this.data.context.trafficSource = document.referrer;
                }
            }
        },

        getGeographicalData() {
            // Fuso Horário
            try {
                this.data.geographical.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            } catch (e) { /* Mantém o padrão */ }

            // Geolocalização (requer permissão)
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        this.data.geographical.location.status = 'Permitido';
                        this.data.geographical.location.latitude = position.coords.latitude;
                        this.data.geographical.location.longitude = position.coords.longitude;
                        console.log('[Collector] Geolocalização obtida com sucesso.');
                    },
                    (error) => {
                        this.data.geographical.location.status = 'Negado';
                        console.warn('[Collector] Permissão de geolocalização negada.', error.message);
                    }
                );
            } else {
                this.data.geographical.location.status = 'Não suportado';
            }
        },

        setupBehavioralTracking() {
            window.addEventListener('scroll', () => {
                const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
                const docHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
                const scrolled = (scrollTop / docHeight) * 100;
                
                if (scrolled > this.data.behavioral.scrollDepth) {
                    this.data.behavioral.scrollDepth = Math.round(scrolled);
                }
            }, { passive: true });
        },

        // --- Função de Inicialização ---

        init() {
            console.log('[Collector] Iniciando coleta de dados do visitante.');
            this.getTechnicalData();
            this.getContextData();
            this.getGeographicalData(); // Solicita permissão de localização
            this.setupBehavioralTracking();
            
            // Expor o tracker globalmente
            window.visitorTracker = this;
            
            console.log('[Collector] Coleta inicial concluída. Dados disponíveis em window.visitorTracker.data');
            console.log(this.data);
        }
    };

    // Inicia todo o processo
    visitorTracker.init();
});
