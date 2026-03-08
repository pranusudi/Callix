/**
 * CLEAN STT SERVICE - DEEPGRAM ONLY
 * Fixes:
 * - Content-Type now matches actual blob mime type instead of hardcoded value
 * - Added abort controller so in-flight requests can be cancelled when a new chunk arrives
 */

class STTService {
    constructor() {
        this.deepgramKey = import.meta.env.VITE_DEEPGRAM_API_KEY;
        this._currentAbortController = null;
    }

    /**
     * Cancel any in-flight transcription request.
     * Call this before starting a new one to avoid race conditions.
     */
    cancelPending() {
        if (this._currentAbortController) {
            this._currentAbortController.abort();
            this._currentAbortController = null;
        }
    }

    async transcribe(audioBlob, languageCode = 'en-IN') {
        if (!this.deepgramKey) throw new Error('Deepgram API Key missing in .env');

        // Cancel any previous in-flight request
        this.cancelPending();
        this._currentAbortController = new AbortController();

        const lang = languageCode.split('-')[0];
        const url = `https://api.deepgram.com/v1/listen?model=nova-3&language=${lang}&smart_format=true&punctuate=true&diarize=false`;

        console.log(`🎙️ [STT] Deepgram Nova-3 Request (${lang})...`);

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Token ${this.deepgramKey}`,
                    // FIX: Use actual blob mime type instead of hardcoded value.
                    // Browser may record as audio/ogg or audio/webm depending on support.
                    'Content-Type': audioBlob.type || 'audio/webm;codecs=opus'
                },
                body: audioBlob,
                signal: this._currentAbortController.signal
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(`Deepgram Error: ${err.err_msg || response.statusText}`);
            }

            const data = await response.json();
            const transcript = data.results?.channels[0]?.alternatives[0]?.transcript;

            if (transcript && transcript.trim()) {
                console.log(`✅ [STT] Transcript found: "${transcript}"`);
                return transcript;
            }

            console.log('⚠️ [STT] Empty transcript returned.');
            return '';
        } catch (e) {
            if (e.name === 'AbortError') {
                console.log('🚫 [STT] Request cancelled (new chunk incoming).');
                return '';
            }
            console.error('❌ [STT] Service Error:', e);
            throw e;
        } finally {
            this._currentAbortController = null;
        }
    }
}

export const sttService = new STTService();