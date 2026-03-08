import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, MicOff, PhoneOff, MessageSquare, VolumeX } from 'lucide-react';
import { chatWithGroq, cleanInternalCommands } from '../utils/groq.js';
import { ttsService } from '../utils/ttsService';
import { sttService } from '../utils/sttService';
import {
  HospitalPrompt, RestaurantPrompt, ECommercePrompt, BusinessPrompt, DefaultPrompt,
  HospitalPromptTe, RestaurantPromptTe, ECommercePromptTe, BusinessPromptTe, DefaultPromptTe,
  HospitalPromptHi, RestaurantPromptHi, ECommercePromptHi, BusinessPromptHi, DefaultPromptHi
} from '../prompts/agentPrompts';
import { database } from '../utils/database';

const VoiceOverlay = ({ isOpen, onClose, selectedCompany, user, addToast }) => {
  const [callState, setCallState] = useState('idle');
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [messages, setMessages] = useState([]);
  const [isMuted, setIsMuted] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [liveCatalogue, setLiveCatalogue] = useState('');
  const [pulseScale, setPulseScale] = useState(1);

  const getNameFromUser = (u) => {
    if (!u) return '';
    return u.profile?.full_name
      || u.user_metadata?.full_name
      || u.app_metadata?.full_name
      || u.full_name
      || u.name
      || (u.email
        ? u.email.split('@')[0].split(/[._]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
        : '');
  };

  const extractNameFromMessage = (message) => {
    const cleanMsg = message.replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, '').trim();
    const nameMatch = cleanMsg.match(/(?:name is|i am|i'm|call me|this is|my name is) ([a-zA-Z]+)/i);
    if (nameMatch) return nameMatch[1];
    const ignoreList = ['hi', 'hello', 'hey', 'my', 'name', 'is', 'the', 'a', 'an', 'yeah', 'yes', 'i', 'am', 'im',
      'నమస్కారం', 'పేరు', 'నా', 'నాకు', 'నేను', 'naa', 'na', 'naperu',
      'नमस्ते', 'नाम', 'मेरा', 'मै', 'हूँ', 'mera', 'naam', 'book', 'table', 'appointment'];
    const words = cleanMsg.split(/\s+/).filter(w => {
      const lowW = w.toLowerCase().replace(/[^a-zA-Z0-9\u0C00-\u0C7F\u0900-\u097F]/g, '');
      return lowW.length > 0 && !ignoreList.includes(lowW);
    });
    const capWords = words.filter(w => w[0] === w[0].toUpperCase() && /[a-zA-Z]/.test(w[0]) && w.length > 1);
    return capWords.length > 0 ? capWords[capWords.length - 1] : null;
  };

  const initialName = getNameFromUser(user);
  const [convoPhase, setConvoPhase] = useState(initialName ? 'chatting' : 'onboarding');
  const [userName, setUserName] = useState(initialName);
  const sessionGuestEmailRef = useRef(`guest_${Math.random().toString(36).substring(2, 7)}@callix.io`);
  const userEmail = user?.email || sessionGuestEmailRef.current;
  const [sessionId] = useState(`session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);
  const [selectedLanguage, setSelectedLanguage] = useState({ code: 'en-IN', name: 'English' });

  // Refs
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const ringingAudioRef = useRef(null);
  const chatEndRef = useRef(null);
  const sttCleanupRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const dataArrayRef = useRef(null);
  const flushIntervalRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const speechDetectedRef = useRef(false);
  const vadActiveRef = useRef(false);
  const isProcessingRef = useRef(false);
  const isSpeakingRef = useRef(false);
  // FIX: explicit flag so finally block knows not to resume VAD after hang up
  const isTerminatingRef = useRef(false);

  const languageLookup = { 'en-IN': 'en-IN', 'hi-IN': 'hi-IN', 'te-IN': 'te-IN' };

  const stateRef = useRef({
    callState, isListening, isSpeaking, isMuted, isOpen,
    convoPhase, userName, userEmail, selectedLanguage, messages
  });

  useEffect(() => {
    stateRef.current = {
      callState, isListening, isSpeaking, isMuted, isOpen,
      convoPhase, userName, userEmail, selectedLanguage, messages
    };
    isProcessingRef.current = isProcessing;
    isSpeakingRef.current = isSpeaking;
  }, [callState, isListening, isSpeaking, isMuted, isOpen, convoPhase,
    userName, userEmail, selectedLanguage, messages, isProcessing]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, transcript]);

  const agentAvatar = '/Female.png';
  const [availableVoices, setAvailableVoices] = useState([]);
  useEffect(() => {
    const load = () => setAvailableVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, []);

  useEffect(() => {
    if (user) {
      const name = getNameFromUser(user);
      setUserName(name);
      if (name) setConvoPhase('chatting');
    }
  }, [user]);

  // ─── VAD helpers ──────────────────────────────────────────────────────────

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  const pauseVAD = useCallback(() => {
    vadActiveRef.current = false;
    clearSilenceTimer();
    speechDetectedRef.current = false;
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    setIsListening(false);
  }, []);

  const resumeVAD = useCallback(() => {
    // FIX: never resume if call is terminating
    if (isTerminatingRef.current) return;
    const { callState, isMuted, isOpen } = stateRef.current;
    if (callState !== 'connected' || isMuted || !isOpen) return;
    if (isSpeakingRef.current || isProcessingRef.current) return;

    const mr = mediaRecorderRef.current;
    if (!mr) return;
    const streamActive = mr.stream?.getTracks().some(t => t.readyState === 'live');
    if (mr.state === 'inactive' && streamActive) {
      try {
        vadActiveRef.current = true;
        speechDetectedRef.current = false;
        mr.start();
        setIsListening(true);
        console.log('🎤 VAD resumed.');
      } catch (e) {
        console.warn('VAD resume failed:', e);
      }
    }
  }, []);

  // ─── Pro STT ──────────────────────────────────────────────────────────────

  const startProSTT = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });

      const mimeType = MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
        ? 'audio/ogg;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm';

      console.log(`🎙️ Audio format: ${mimeType}`);
      const mediaRecorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 128000 });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const chunks = [...audioChunksRef.current];
        audioChunksRef.current = [];
        const hadSpeech = speechDetectedRef.current;
        speechDetectedRef.current = false;

        const { selectedLanguage: curLang, isMuted, callState, isOpen } = stateRef.current;

        if (!hadSpeech || chunks.length === 0) {
          resumeVAD();
          return;
        }
        const audioBlob = new Blob(chunks, { type: mimeType });
        if (audioBlob.size < 4000) {
          console.log('🤏 Chunk too small, skipping.');
          resumeVAD();
          return;
        }
        if (isMuted || callState !== 'connected' || !isOpen) return;
        if (isTerminatingRef.current) return; // FIX: drop chunks after hang up
        if (isSpeakingRef.current) {
          console.log('🔇 TTS active, discarding.');
          // Do NOT resume here, speak/finishSpeech will handle it
          return;
        }
        if (isProcessingRef.current) {
          console.log('⏳ Still processing, skipping.');
          return;
        }

        console.log(`🎙️ Sending chunk (${audioBlob.size} bytes) to STT...`);
        try {
          setIsTranscribing(true);
          const text = await sttService.transcribe(audioBlob, curLang.code);
          setIsTranscribing(false);
          if ((text || '').trim().length > 0) {
            await handleUserMessage(text, true);
          } else {
            resumeVAD();
          }
        } catch (e) {
          if (e.name !== 'AbortError') console.error('❌ STT failed:', e);
          setIsTranscribing(false);
          resumeVAD();
        }
      };

      // Web Audio VAD
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      const source = audioContextRef.current.createMediaStreamSource(stream);
      const analyser = audioContextRef.current.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;
      dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);

      if (flushIntervalRef.current) clearInterval(flushIntervalRef.current);
      flushIntervalRef.current = setInterval(() => {
        const { isMuted, callState, isOpen } = stateRef.current;
        if (isTerminatingRef.current) { clearInterval(flushIntervalRef.current); return; }
        if (mediaRecorderRef.current?.state === 'recording'
          && !isSpeakingRef.current && !isMuted
          && callState === 'connected' && isOpen
          && speechDetectedRef.current) {
          console.log('⏹️ Hard-limit rotation (20s)...');
          mediaRecorderRef.current.stop();
        }
      }, 20000);

      vadActiveRef.current = true;
      mediaRecorder.start();
      setIsListening(true);
      console.log('⏺️ STT Listener Active');

      const checkVolume = () => {
        const { isOpen: curIsOpen, callState: curCallState } = stateRef.current;
        if (!curIsOpen || curCallState !== 'connected' || isTerminatingRef.current) return;
        if (isSpeakingRef.current || !vadActiveRef.current) {
          requestAnimationFrame(checkVolume);
          return;
        }
        if (mediaRecorder.state === 'recording' && analyserRef.current && dataArrayRef.current) {
          analyserRef.current.getByteFrequencyData(dataArrayRef.current);
          const volume = dataArrayRef.current.reduce((s, v) => s + v, 0) / dataArrayRef.current.length;
          setPulseScale(1 + (volume / 255) * 0.4);
          const isTalking = volume > 20;
          if (isTalking) {
            speechDetectedRef.current = true;
            clearSilenceTimer();
          } else if (speechDetectedRef.current && !silenceTimerRef.current) {
            silenceTimerRef.current = setTimeout(() => {
              silenceTimerRef.current = null;
              if (mediaRecorderRef.current?.state === 'recording' && !isSpeakingRef.current) {
                console.log('🤫 Silence detected. Processing chunk...');
                mediaRecorderRef.current.stop();
              }
            }, 1200);
          }
        }
        requestAnimationFrame(checkVolume);
      };
      requestAnimationFrame(checkVolume);

      sttCleanupRef.current = () => {
        try {
          vadActiveRef.current = false;
          clearSilenceTimer();
          if (flushIntervalRef.current) { clearInterval(flushIntervalRef.current); flushIntervalRef.current = null; }
          if (audioContextRef.current?.state !== 'closed') {
            audioContextRef.current.close();
            audioContextRef.current = null;
          }
          analyserRef.current = null;
          sttService.cancelPending();
          stream.getTracks().forEach(t => t.stop());
        } catch { }
      };

    } catch (e) {
      console.error('Failed to start Pro STT:', e);
    }
  };

  useEffect(() => {
    if (sttCleanupRef.current) { sttCleanupRef.current(); sttCleanupRef.current = null; }
    if (callState === 'connected' && isOpen) {
      console.log(`🚀 Activating STT for ${selectedLanguage.name}...`);
      startProSTT();
    }
    return () => {
      if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
      if (sttCleanupRef.current) { sttCleanupRef.current(); sttCleanupRef.current = null; }
    };
  }, [selectedLanguage.code, callState, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if ('speechSynthesis' in window) window.speechSynthesis.getVoices();
    setCallState('ringing');
    isTerminatingRef.current = false; // reset on each open

    const compName = selectedCompany?.name?.toLowerCase() || '';
    if (compName.includes('aarogya') || compName.includes('spice')) {
      const lang = { code: 'te-IN', name: 'Telugu' };
      setSelectedLanguage(lang);
      stateRef.current.selectedLanguage = lang;
    }

    ringingAudioRef.current = new Audio('/ringtone-027-376908.mp3');
    ringingAudioRef.current.loop = true;
    ringingAudioRef.current.play().catch(() => { });

    return () => {
      if (ringingAudioRef.current) ringingAudioRef.current.pause();
      window.speechSynthesis.cancel();
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && selectedCompany?.id) {
      database.getLiveCatalogue(selectedCompany.id, selectedCompany.name).then(setLiveCatalogue);
    }
  }, [isOpen, selectedCompany]);

  // ─── Core helpers ─────────────────────────────────────────────────────────

  const addMessage = (sender, text, rawText = null) => {
    setMessages(prev => [...prev, { sender, text, rawText: rawText || text, timestamp: new Date() }]);
  };

  // ─── endCall — tear down everything cleanly ───────────────────────────────

  const endCall = useCallback(() => {
    // FIX: set terminating flag FIRST so VAD/onstop callbacks bail immediately
    isTerminatingRef.current = true;
    vadActiveRef.current = false;
    clearSilenceTimer();

    setCallState('ended');
    setIsListening(false);
    setIsSpeaking(false);
    isSpeakingRef.current = false;
    isProcessingRef.current = false;
    setIsProcessing(false);

    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
    if (sttCleanupRef.current) { sttCleanupRef.current(); sttCleanupRef.current = null; }
    if (ringingAudioRef.current) ringingAudioRef.current.pause();
    window.speechSynthesis.cancel();
    ttsService.stop();
    sttService.cancelPending();

    setTimeout(() => {
      setMessages([]);
      setUserName(getNameFromUser(user));
      setConvoPhase(getNameFromUser(user) ? 'chatting' : 'onboarding');
      setTranscript('');
      setSelectedLanguage({ code: 'en-IN', name: 'English' });
      isTerminatingRef.current = false;
      onClose();
    }, 1500);
  }, [onClose, user]);

  // ─── handleUserMessage ────────────────────────────────────────────────────

  const handleUserMessage = async (message, fromSTT = false) => {
    const { convoPhase: curPhase, userName: curName, selectedLanguage: curLang, isSpeaking: curIsSpeaking } = stateRef.current;

    if (!message?.trim()) return;
    if (isProcessingRef.current) { console.log('⏳ Already processing, skipping.'); return; }
    if (isTerminatingRef.current) return;
    if (!fromSTT && curIsSpeaking) return;

    isProcessingRef.current = true;
    setIsProcessing(true);
    setIsThinking(true);

    // FIX: track whether this turn ends in hang up so finally knows not to resume VAD
    let shouldTerminate = false;

    try {
      const isInternal = message.startsWith('[') && message.endsWith(']');
      if (!isInternal) addMessage('user', message);
      setIsListening(false);
      setTranscript('');

      // Echo guard
      const currentMsgs = stateRef.current.messages;
      const lastAgent = [...currentMsgs].reverse().find(m => m.sender === 'agent');
      if (lastAgent?.text && calculateSimilarity(message, lastAgent.text) > 0.95) {
        console.log('🚫 Echo, ignoring.');
        return;
      }

      let processedMessage = message;
      if (curPhase === 'onboarding') {
        const extracted = extractNameFromMessage(message);
        const nextName = extracted || curName || 'Guest';
        setUserName(nextName);
        setConvoPhase('chatting');
        stateRef.current.userName = nextName;
        stateRef.current.convoPhase = 'chatting';
        processedMessage = `${message} [SYSTEM: User name is ${nextName}]`;
      }

      // Language switch
      const lowerMsg = message.toLowerCase();
      let newLang = null;
      if (lowerMsg.includes('switch to') || lowerMsg.includes('change to') || lowerMsg.includes('change language')) {
        if (lowerMsg.includes('hindi')) newLang = { code: 'hi-IN', name: 'Hindi' };
        else if (lowerMsg.includes('telugu')) newLang = { code: 'te-IN', name: 'Telugu' };
        else if (lowerMsg.includes('english')) newLang = { code: 'en-IN', name: 'English' };
      }
      if (newLang) {
        setSelectedLanguage(newLang);
        stateRef.current.selectedLanguage = newLang;
        const resp = newLang.code === 'en-IN' ? 'Continuing in English.'
          : newLang.code === 'te-IN' ? 'తెలుగులో కొనసాగిస్తాను.'
            : 'हिंदी में जारी रखूंगा।';
        addMessage('agent', resp);
        await speak(resp, newLang.code, false);
        return;
      }

      // Build specialized prompt
      const industry = selectedCompany?.industry?.toLowerCase() || '';
      const compName = selectedCompany?.name?.toLowerCase() || '';
      const isTe = curLang.code === 'te-IN';
      const isHi = curLang.code === 'hi-IN';

      let specializedPrompt = isTe ? DefaultPromptTe : isHi ? DefaultPromptHi : DefaultPrompt;
      if (industry.includes('health') || compName.includes('hospital') || compName.includes('aarogya')) {
        specializedPrompt = isTe ? HospitalPromptTe : isHi ? HospitalPromptHi : HospitalPrompt;
      } else if (industry.includes('restaur') || compName.includes('garden') || compName.includes('aroma')) {
        specializedPrompt = isTe ? RestaurantPromptTe : isHi ? RestaurantPromptHi : RestaurantPrompt;
      } else if (industry.includes('commerce') || compName.includes('kart')) {
        specializedPrompt = isTe ? ECommercePromptTe : isHi ? ECommercePromptHi : ECommercePrompt;
      } else if (industry.includes('business') || industry.includes('tech')) {
        specializedPrompt = isTe ? BusinessPromptTe : isHi ? BusinessPromptHi : BusinessPrompt;
      }

      const latestName = stateRef.current.userName || 'Guest';
      const currentMessages = stateRef.current.messages;
      const isFirstTurn = currentMessages.filter(m => m.sender === 'agent').length <= 1;
      const finalSpecializedPrompt = specializedPrompt.replace(/\[COMPANY_NAME\]/g, selectedCompany?.name || 'our business');

      const systemPrompt = buildSystemPrompt({
        companyName: selectedCompany?.name,
        nlpContext: selectedCompany?.nlp_context,
        langName: curLang.name,
        langCode: curLang.code,
        isTe, isHi,
        latestName,
        isFirstTurn,
        liveCatalogue,
        specializedPrompt: finalSpecializedPrompt
      });

      const rawResponse = await chatWithGroq(
        `User Message: ${processedMessage}`,
        currentMessages.slice(-6).map(m => ({ role: m.sender === 'user' ? 'user' : 'assistant', text: m.rawText || m.text })),
        { ...selectedCompany, userName: latestName, userEmail, sessionId, currLangCode: curLang.code, systemDate: new Date() },
        systemPrompt
      );

      setIsThinking(false);
      const finalDisplay = cleanInternalCommands(rawResponse) || '...';
      addMessage('agent', finalDisplay, rawResponse);

      // FIX: set flag BEFORE awaiting speak so finally block can read it
      shouldTerminate = rawResponse.toUpperCase().includes('HANG_UP');
      if (shouldTerminate) isTerminatingRef.current = true;

      await speak(finalDisplay, curLang.code, shouldTerminate);

    } catch (error) {
      console.error('Message Error:', error);
      const { selectedLanguage: curLang } = stateRef.current;
      const isTe = curLang?.code === 'te-IN';
      const isHi = curLang?.code === 'hi-IN';
      const errorMsg = isTe ? 'క్షమించండి, మళ్ళీ చెప్పండి.'
        : isHi ? 'क्षमा करें, दोबारा बोलें।'
          : 'Sorry, could you repeat that?';
      addMessage('agent', errorMsg);
      await speak(errorMsg, stateRef.current.selectedLanguage?.code || 'en-IN', false);
    } finally {
      setIsThinking(false);
      setIsProcessing(false);
      isProcessingRef.current = false;
      setIsTranscribing(false);

      if (shouldTerminate) {
        // FIX: call endCall from finally — never resume VAD after hang up
        endCall();
      } else {
        resumeVAD();
      }
    }
  };

  // ─── System prompt builder ────────────────────────────────────────────────

  const buildSystemPrompt = ({ companyName, nlpContext, langName, langCode, isTe, isHi, latestName, isFirstTurn, liveCatalogue, specializedPrompt }) => {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    // Language-specific greeting and standard phrases
    const greetingLine = isFirstTurn
      ? (isTe
        ? `మొదటి మాట: "నమస్కారం ${latestName}, నేను కాల్లిక్స్. మీకు ఎలా సహాయపడగలను?"`
        : isHi
          ? `पहला संदेश: "नमस्ते ${latestName}, मैं कॉलिक्स हूँ। आपकी कैसे सहायता करूं?"`
          : `First message: "Hello ${latestName}, I'm Callix. How may I assist you?"`)
      : (isTe ? `మీరు ఇప్పటికే పరిచయం చేసుకున్నారు. మళ్ళీ చేయకండి.`
        : isHi ? `परिचय मत दोहराएं।`
          : `Do NOT re-introduce yourself.`);

    const standardPhrases = isTe ? `
తెలుగు నిర్దిష్ట పదబంధాలు (ఇవే వాడండి, వేరే వాడకండి):
- అపాయింట్‌మెంట్ నిర్ధారణ: "మీ అపాయింట్‌మెంట్ నిర్ధారించబడింది."
- అదనపు సహాయం: "మరింకేమైనా కావాలా?"
- రేటింగ్ అడగడం: "1 నుండి 5 లో రేటింగ్ ఇవ్వండి."
- ముగింపు: "ధన్యవాదాలు. మళ్ళీ కలుద్దాం." (ముగింపు మాటలు ఎప్పుడూ రేటింగ్ అడిగిన తర్వాతే చెప్పాలి)

నిషేధించిన పదబంధాలు (ఎప్పుడూ వాడకండి):
- "సంప్రదించడం", "కలవడం" అని అపాయింట్‌మెంట్ కోసం వాడకండి
- "ఉండాలనుకుంటున్నారా", "ఉండాలనుకుంటున్నావా"
- అతిగా మొహమాటంగా వ్యాఖ్యలు
- ఇంగ్లీష్ పదాలు తెలుగు వాక్యంలో కలపడం (doctor, appointment, booking తప్ప)`
      : isHi ? `
हिंदी वाक्यांश (इन्हीं का उपयोग करें):
- बुकिंग पुष्टि: "आपकी अपॉइंटमेंट कन्फर्म हो गई।"
- अतिरिक्त सहायता: "और कोई सहायता चाहिए?"
- रेटिंग: "1 से 5 में रेटिंग दें।"
- समाप्ति: "धन्यवाद। फिर मिलेंगे।" (समाप्ति रेटिंग के बाद ही बोलें)
`
        : `
English phrases:
- Booking confirmed: "Your appointment is confirmed."
- Further help: "Is there anything else?"
- Rating: "Please rate from 1 to 5."
- Closing: "Thank you. Goodbye."`;

    return `आप Callix हैं — ${companyName} के वर्चुअल रिसेप्शनिस्ट। / You are Callix — Virtual Receptionist for ${companyName}.
DATE: ${dateStr} | TIME: ${timeStr}

भाषा / LANGUAGE: ${langName} ONLY. ${isTe ? 'తెలుగులో మాత్రమే జవాబివ్వండి.' : isHi ? 'केवल हिंदी में उत्तर दें।' : 'Respond in English only.'}
USER: ${latestName}

${greetingLine}

నడవడిక / BEHAVIOUR:
- గరిష్టంగా 2 వాక్యాలు. / Max 2 sentences per reply.
- ${isTe ? 'అనవసరమైన మొహమాటం వద్దు. నేరుగా చెప్పండి.' : isHi ? 'अनावश्यक विनम्रता नहीं। सीधे बोलें।' : 'No filler phrases. Be direct.'}
- NO MARKDOWN. No asterisks (*).
- బుకింగ్ చేయడానికి తేదీ మరియు సమయం రెండూ కావాలి. / Need date AND time to book.
- [BOOK_...] వాడే ముందు వినియోగదారు నిర్ధారించాలి. / User must confirm before [BOOK_...].
- వినియోగదారు పని అయిన తర్వాత రేటింగ్ అడగాలి. [HANG_UP] రేటింగ్ తర్వాతే. / Ask for rating when done. [HANG_UP] only after rating.
- డేటాబేస్‌లో లేని సమాచారాన్ని కల్పించవద్దు. / Never invent data.

${standardPhrases}

LIVE KNOWLEDGE:
${liveCatalogue || 'DATA_NOT_FOUND'}

BUSINESS CONTEXT: ${nlpContext || 'Premium service provider.'}
${specializedPrompt}`.trim();
  };

  // ─── TTS ─────────────────────────────────────────────────────────────────

  const speak = (text, languageCode, shouldTerminate = false) => {
    return new Promise((resolve) => {
      if (isTerminatingRef.current && !shouldTerminate) { resolve(); return; }

      const targetLangCode = languageCode || selectedLanguage.code;
      const ttsLang = languageLookup[targetLangCode] || 'en-IN';
      console.log(`🗣️ TTS: lang="${ttsLang}", terminate=${shouldTerminate}`);

      pauseVAD();
      isSpeakingRef.current = true;
      setIsSpeaking(true);

      const finishSpeech = () => {
        isSpeakingRef.current = false;
        setIsSpeaking(false);
        resolve();
        // resumeVAD is NOT called here — handled exclusively by handleUserMessage's finally
      };

      ttsService.speak(text, ttsLang)
        .then(finishSpeech)
        .catch(() => {
          const voices = window.speechSynthesis.getVoices();
          const isMale = (v) => /male|guy|man|boy|mohan|kannan|ravi|david|mark|deepak|stefan/i.test(v.name.toLowerCase());
          const isFemale = (v) => !isMale(v);
          const getBestVoice = () => {
            if (!voices.length) return null;
            const t = targetLangCode.toLowerCase();
            if (t.includes('te')) return voices.find(v => v.lang.toLowerCase().includes('te') && isFemale(v)) || voices.find(v => v.lang.toLowerCase().includes('hi') && isFemale(v)) || voices[0];
            if (t.includes('hi')) return voices.find(v => v.lang.toLowerCase().includes('hi') && isFemale(v)) || voices[0];
            return voices.find(v => v.lang.toLowerCase().includes('en-in') && isFemale(v)) || voices.find(v => v.lang.toLowerCase().includes('en') && isFemale(v)) || voices[0];
          };
          window.speechSynthesis.cancel();
          setTimeout(() => {
            const voice = getBestVoice();
            if (voice || voices.length) {
              const utt = new SpeechSynthesisUtterance(text);
              utt.voice = voice || voices[0]; utt.lang = utt.voice.lang;
              utt.pitch = 1.1; utt.rate = 1.0;
              utt.onend = finishSpeech;
              utt.onerror = () => finishSpeech();
              window.speechSynthesis.speak(utt);
            } else { finishSpeech(); }
          }, 100);
        });
    });
  };

  const stopAudio = () => {
    ttsService.stop();
    window.speechSynthesis.cancel();
    isSpeakingRef.current = false;
    setIsSpeaking(false);
    setTimeout(resumeVAD, 300);
  };

  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    if (next) { pauseVAD(); } else { resumeVAD(); }
  };

  const handleStartCall = () => {
    if (ringingAudioRef.current) ringingAudioRef.current.pause();
    setCallState('connected');
    const name = getNameFromUser(user);
    const phase = name ? 'chatting' : 'onboarding';
    setConvoPhase(phase);
    stateRef.current.convoPhase = phase;
    console.log('📞 Call Connected. Waiting for user...');
  };

  if (!isOpen) return null;

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <AnimatePresence>
      <motion.div className="fixed inset-0 z-50 bg-white" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>

        {callState === 'ringing' && (
          <div className="absolute inset-0 overflow-hidden">
            <video autoPlay loop muted playsInline className="absolute inset-0 w-full h-full object-cover">
              <source src="/callbg.mp4" type="video/mp4" />
            </video>
            <div className="absolute inset-0 bg-gradient-to-br from-slate-900/60 to-blue-900/60" />
            <div className="absolute inset-0 flex flex-col items-center justify-center overflow-y-auto py-4">
              <div className="relative mb-6 w-48 h-48 mx-auto">
                <div className="absolute inset-0 flex items-center justify-center"><div className="w-48 h-48 rounded-full bg-blue-200/30 animate-ping" /></div>
                <div className="absolute inset-0 flex items-center justify-center"><div className="w-40 h-40 rounded-full bg-blue-300/40 animate-pulse" /></div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-[#000080] shadow-2xl">
                    <img src={agentAvatar} className="w-full h-full object-cover" alt="Agent" />
                  </div>
                </div>
              </div>
              <h2 className="text-3xl font-black text-white mb-1">Callix Connecting...</h2>
              <p className="text-blue-300 font-bold uppercase tracking-widest text-xs mb-6">{selectedCompany?.name}</p>
              <div className="bg-white/10 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/20 p-6 w-full max-w-4xl mx-4">
                <h3 className="text-xl font-black text-white mb-2 text-center">Select Your Language</h3>
                <p className="text-blue-200 text-sm text-center mb-5">Choose your preferred language</p>
                <div className="flex justify-center gap-2 mb-6">
                  {[{ code: 'en-IN', name: 'English' }, { code: 'hi-IN', name: 'Hindi' }, { code: 'te-IN', name: 'Telugu' }].map(lang => (
                    <button key={lang.code}
                      onClick={() => { setSelectedLanguage(lang); stateRef.current.selectedLanguage = lang; }}
                      className={`px-4 py-2 rounded-full border-2 font-semibold text-sm transition-all duration-200 ${selectedLanguage.code === lang.code
                        ? 'border-blue-400 bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-lg scale-105'
                        : 'border-white/30 bg-white/10 text-white hover:border-blue-300 hover:scale-105'
                        }`}>{lang.name}
                    </button>
                  ))}
                </div>
                <div className="flex items-center justify-center gap-4">
                  <button onClick={handleStartCall} className="px-8 py-3 bg-[#000080] text-white rounded-full font-bold text-lg shadow-lg hover:bg-blue-700 transition-all hover:scale-105">Continue Call</button>
                  <button onClick={endCall} className="p-3 bg-red-500 text-white rounded-full shadow-lg hover:bg-red-600 hover:scale-110"><PhoneOff size={20} /></button>
                </div>
              </div>
            </div>
          </div>
        )}

        {callState === 'connected' && (
          <div className="h-full flex flex-col md:flex-row bg-white">
            <div className="md:w-1/2 flex flex-col items-center justify-center p-4 md:p-8 bg-slate-50 border-b md:border-b-0 md:border-r border-slate-200 shrink-0">
              <motion.div
                animate={{
                  scale: isSpeaking ? [1, 1.03, 1] : 1,
                  boxShadow: isSpeaking
                    ? ['0 15px 35px rgba(74,222,128,0.2)', '0 25px 50px rgba(74,222,128,0.4)', '0 15px 35px rgba(74,222,128,0.2)']
                    : isListening ? '0 15px 35px rgba(59,130,246,0.2)' : '0 15px 35px rgba(0,0,0,0.1)'
                }}
                transition={{ duration: 1.5, repeat: Infinity }}
                className={`w-32 h-32 md:w-56 md:h-56 rounded-full overflow-hidden border-[4px] md:border-[6px] bg-white p-1.5 transition-all duration-500 ${isSpeaking ? 'border-green-400' : isListening ? 'border-blue-600' : 'border-slate-100'
                  }`}
              >
                <img src={agentAvatar} className="w-full h-full object-cover rounded-full" alt="Callix" />
              </motion.div>
              <div className="mt-6 text-center flex flex-col items-center">
                <h3 className="text-2xl md:text-4xl font-black text-slate-900">Callix</h3>
                <p className="text-blue-700 font-extrabold uppercase tracking-widest text-[9px] mt-2 bg-blue-50 px-4 py-1 rounded-full border border-blue-100">
                  {selectedCompany?.name || 'VIRTUAL ASSISTANT'}
                </p>
                {isListening && !isSpeaking && (
                  <div className="flex items-center gap-1 h-8 mt-4">
                    {[1, 2, 3, 4, 5].map(i => (
                      <motion.div key={i} animate={{ height: [4, Math.random() * 16 + 4, 4] }}
                        transition={{ duration: 0.5, repeat: Infinity, delay: i * 0.1 }}
                        className="w-1 bg-blue-500 rounded-full" />
                    ))}
                  </div>
                )}
                <div className={`mt-3 px-4 py-1.5 rounded-full text-[9px] font-black tracking-widest uppercase flex items-center gap-2 border transition-all duration-300 ${isSpeaking ? 'bg-green-100 text-green-700 border-green-200'
                  : isThinking ? 'bg-purple-100 text-purple-700 border-purple-200'
                    : isTranscribing ? 'bg-orange-100 text-orange-700 border-orange-200'
                      : isListening ? 'bg-blue-100 text-blue-700 border-blue-200'
                        : 'bg-slate-100 text-slate-500 border-slate-200'
                  }`} style={{ transform: `scale(${isListening && !isSpeaking ? pulseScale : 1})` }}>
                  <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${isSpeaking ? 'bg-green-500' : isThinking ? 'bg-purple-500'
                    : isTranscribing ? 'bg-orange-500' : isListening ? 'bg-blue-500' : 'bg-slate-400'
                    }`} />
                  {isSpeaking ? 'Speaking' : isThinking ? 'Thinking' : isTranscribing ? 'Transcribing' : isListening ? 'Listening' : 'Ready'}
                </div>
                <div className="mt-6 flex items-center gap-3">
                  <button onClick={toggleMute} className={`p-3 md:p-4 rounded-full shadow-lg transition-all ${isMuted ? 'bg-red-500 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}`}>
                    {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
                  </button>
                  {isSpeaking && (
                    <button onClick={stopAudio} className="p-3 md:p-4 bg-orange-500 text-white rounded-full shadow-lg hover:bg-orange-600 animate-bounce">
                      <VolumeX size={20} />
                    </button>
                  )}
                  <button onClick={endCall} className="p-3 md:p-4 bg-red-600 text-white rounded-full shadow-lg hover:bg-red-700 hover:scale-110"><PhoneOff size={20} /></button>
                </div>
              </div>
            </div>

            <div className="md:w-1/2 flex flex-col h-full bg-white">
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h4 className="font-black text-slate-900">Conversation Stream</h4>
                  <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">Active Session</p>
                </div>
                <MessageSquare className="text-slate-200" size={24} />
              </div>
              <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-50/50">
                {messages.map((m, i) => (
                  <motion.div key={i} initial={{ opacity: 0, x: m.sender === 'user' ? 20 : -20 }} animate={{ opacity: 1, x: 0 }}
                    className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] p-4 rounded-2xl shadow-sm border ${m.sender === 'user' ? 'bg-[#000080] text-white border-[#000080]' : 'bg-white text-slate-800 border-slate-200'
                      }`}>
                      <p className="text-sm font-medium leading-relaxed">{m.text}</p>
                      <p className={`text-[10px] mt-2 font-bold uppercase opacity-50 ${m.sender === 'user' ? 'text-white' : 'text-slate-400'}`}>
                        {m.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </motion.div>
                ))}
                {transcript && (
                  <div className="flex justify-end">
                    <div className="bg-slate-200/50 p-4 rounded-2xl text-slate-500 text-sm italic animate-pulse">{transcript}...</div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
              <div className="p-6 bg-white border-t border-slate-100">
                <div className="flex items-center gap-3 text-slate-400">
                  <div className={`w-2 h-2 rounded-full ${isListening ? 'bg-blue-500 animate-ping' : 'bg-slate-300'}`} />
                  <span className="text-xs font-black uppercase tracking-widest">{isListening ? 'Voice capture active' : 'Waiting for system'}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {callState === 'ended' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white">
            <div className="w-24 h-24 bg-red-50 rounded-full flex items-center justify-center mb-6"><PhoneOff size={48} className="text-red-500" /></div>
            <h2 className="text-3xl font-black text-slate-900">Call Ended</h2>
            <p className="text-slate-500 font-bold mt-2">Thank you for speaking with Callix.</p>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
};

const calculateSimilarity = (s1, s2) => {
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;
  if (longer.length === 0) return 1.0;
  const editDist = (a, b) => {
    a = a.toLowerCase(); b = b.toLowerCase();
    const costs = [];
    for (let i = 0; i <= a.length; i++) {
      let last = i;
      for (let j = 0; j <= b.length; j++) {
        if (i === 0) { costs[j] = j; }
        else if (j > 0) {
          let nv = costs[j - 1];
          if (a[i - 1] !== b[j - 1]) nv = Math.min(nv, last, costs[j]) + 1;
          costs[j - 1] = last; last = nv;
        }
      }
      if (i > 0) costs[b.length] = last;
    }
    return costs[b.length];
  };
  return (longer.length - editDist(longer, shorter)) / longer.length;
};

export default VoiceOverlay;