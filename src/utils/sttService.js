/**
 * CLEAN STT SERVICE - DEEPGRAM ONLY
 */

class STTService {
    constructor() {
        this.deepgramKey = import.meta.env.VITE_DEEPGRAM_API_KEY;
    }

    async transcribe(audioBlob, languageCode = 'en-IN') {
        if (!this.deepgramKey) throw new Error("Deepgram API Key missing in .env");

        // Convert language codes for Deepgram
        const lang = languageCode.split('-')[0];
        // Using nova-3 for speed, adding filler_words to capture natural speech
        const url = `https://api.deepgram.com/v1/listen?model=nova-3&language=${lang}&smart_format=true&punctuate=true&filler_words=true&diarize=false`;

        console.log(`🎙️ [STT] Deepgram Nova-3 Request (${lang})...`);

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Token ${this.deepgramKey}`,
                    'Content-Type': 'audio/webm;codecs=opus'
                },
                body: audioBlob
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(`Deepgram Error: ${err.err_msg || response.statusText}`);
            }

            const data = await response.json();
            const transcript = data.results?.channels[0]?.alternatives[0]?.transcript;

            if (transcript && transcript.trim()) {
                console.log(`✅ [STT] Transcript found: "${transcript}"`);
                return transcript;
            }

            // Fallback for very short audio or silence detection
            console.log("⚠️ [STT] Empty transcript returned.");
            return "";
        } catch (e) {
            console.error("❌ [STT] Service Error:", e);
            throw e;
        }
    }
}

export const sttService = new STTService();
