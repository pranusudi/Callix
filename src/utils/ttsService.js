/**
 * CLEAN TTS SERVICE - AZURE ONLY
 * Fixes:
 * - stop() now revokes the object URL to prevent memory leaks
 * - stop() guards against calling pause() on an already-ended audio element
 * - playBlob resolves cleanly on stop() being called mid-play (no dangling promise)
 */

export const ttsService = {
    AZURE_KEY: import.meta.env.VITE_AZURE_SPEECH_KEY,
    AZURE_REGION: import.meta.env.VITE_AZURE_SPEECH_REGION || 'centralindia',
    currentAudio: null,
    _currentObjectUrl: null,
    // Resolve handle so stop() can cleanly resolve the speak() promise
    _resolveCurrentPlay: null,

    async speak(text, language) {
        if (!text) return;
        if (!this.AZURE_KEY) throw new Error('Azure Speech Key missing in .env');
        return await this.speakAzure(text, language);
    },

    async speakAzure(text, language) {
        const escapeXml = (unsafe) =>
            unsafe.replace(/[<>&"']/g, (c) => ({
                '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;'
            }[c] || c));

        const voiceMap = {
            'te-IN': 'te-IN-ShrutiNeural',
            'hi-IN': 'hi-IN-SwaraNeural',
            'en-IN': 'en-IN-NeerjaNeural',
            'en-US': 'en-US-EmmaNeural'
        };

        const langCode = language.includes('-')
            ? language
            : language === 'te' ? 'te-IN' : language === 'hi' ? 'hi-IN' : 'en-IN';
        const voiceName = voiceMap[langCode] || voiceMap['en-IN'];

        const url = `https://${this.AZURE_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`;
        const safeText = escapeXml(text);

        const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${langCode}'><voice name='${voiceName}'><prosody rate="1.0" pitch="0%" volume="100">${safeText}</prosody></voice></speak>`;

        console.log(`🔊 [TTS] Azure Neural: ${voiceName}`);

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Ocp-Apim-Subscription-Key': this.AZURE_KEY,
                'Content-Type': 'application/ssml+xml',
                'X-Microsoft-OutputFormat': 'audio-24khz-160kbitrate-mono-mp3',
                'User-Agent': 'CallixAI'
            },
            body: ssml
        });

        if (!response.ok) throw new Error(`Azure TTS Error: ${response.status}`);

        const blob = await response.blob();
        return this.playBlob(blob);
    },

    playBlob(blob) {
        // Stop and clean up anything currently playing
        this.stop();

        const objectUrl = URL.createObjectURL(blob);
        this._currentObjectUrl = objectUrl;
        this.currentAudio = new Audio(objectUrl);

        return new Promise((resolve) => {
            // Store resolve so stop() can trigger it cleanly
            this._resolveCurrentPlay = resolve;

            const cleanup = () => {
                // Revoke URL to free memory
                if (this._currentObjectUrl === objectUrl) {
                    URL.revokeObjectURL(objectUrl);
                    this._currentObjectUrl = null;
                }
                this._resolveCurrentPlay = null;
                resolve();
            };

            this.currentAudio.onended = () => {
                this.currentAudio = null;
                cleanup();
            };

            this.currentAudio.onerror = (e) => {
                console.error('🔊 [TTS] Audio playback error:', e);
                this.currentAudio = null;
                cleanup();
            };

            this.currentAudio.play().catch((e) => {
                console.error('🔊 [TTS] play() failed:', e);
                cleanup();
            });
        });
    },

    stop() {
        if (this.currentAudio) {
            try {
                // Guard: only pause if not already ended
                if (!this.currentAudio.ended) {
                    this.currentAudio.pause();
                }
            } catch { /* ignore if element is in a bad state */ }
            this.currentAudio = null;
        }

        // FIX: Always revoke the object URL on stop to prevent memory leaks
        if (this._currentObjectUrl) {
            URL.revokeObjectURL(this._currentObjectUrl);
            this._currentObjectUrl = null;
        }

        // FIX: Resolve the pending promise so callers (speak()) don't hang
        if (this._resolveCurrentPlay) {
            this._resolveCurrentPlay();
            this._resolveCurrentPlay = null;
        }
    }
};