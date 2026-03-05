import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Mic, MicOff, Phone, PhoneOff, Globe, User, MessageSquare, VolumeX } from 'lucide-react';
import { chatWithGroq, transcribeAudio, isGroqInitialized, cleanInternalCommands } from '../utils/groq.js';
import { detectLanguage } from '../utils/languageDetection';
import { ttsService } from '../utils/ttsService';
import { sttService } from '../utils/sttService';
import { HospitalPrompt, RestaurantPrompt, ECommercePrompt, BusinessPrompt, DefaultPrompt } from '../prompts/agentPrompts';
import { database } from '../utils/database';

const VoiceOverlay = ({ isOpen, onClose, selectedCompany, user, addToast }) => {
  const [callState, setCallState] = useState('idle'); // idle, ringing, connected, ended
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
  const [isUserTalking, setIsUserTalking] = useState(false);

  // Helper to get name from user object or email
  const getNameFromUser = (u) => {
    if (!u) return '';
    if (u.profile?.full_name) return u.profile.full_name;
    if (u.user_metadata?.full_name) return u.user_metadata.full_name;
    if (u.app_metadata?.full_name) return u.app_metadata.full_name;
    if (u.full_name) return u.full_name;
    if (u.name) return u.name;

    if (u.email) {
      const namePart = u.email.split('@')[0];
      return namePart
        .split(/[._]/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    }
    return '';
  };

  const extractNameFromMessage = (message) => {
    let extractedName = null;
    const cleanMsg = message.replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, "").trim();
    const nameMatch = cleanMsg.match(/(?:name is|i am|i'm|call me|this is|my name is) ([a-zA-Z]+)/i);

    if (nameMatch) {
      extractedName = nameMatch[1];
    } else {
      const ignoreList = [
        'hi', 'hello', 'hey', 'my', 'name', 'is', 'the', 'a', 'an', 'yeah', 'yes', 'i', 'am', 'im',
        'నమస్కారం', 'పేరు', 'నా', 'నాకు', 'నేను', 'naa', 'na', 'naperu',
        'नमस्ते', 'नाम', 'मेरा', 'मै', 'हूँ', 'mera', 'naam', 'book', 'table', 'appointment'
      ];

      const words = cleanMsg.split(/\s+/).filter(w => {
        const lowW = w.toLowerCase().replace(/[^a-zA-Z0-9\u0C00-\u0C7F\u0900-\u097F]/g, '');
        return lowW.length > 0 && !ignoreList.includes(lowW);
      });

      if (words.length > 0) {
        const capWords = words.filter(w => w[0] === w[0].toUpperCase() && /[a-zA-Z]/.test(w[0]) && w.length > 1);
        if (capWords.length > 0) extractedName = capWords[capWords.length - 1];
      }
    }
    return extractedName;
  };

  // Advanced conversation state
  const [convoPhase, setConvoPhase] = useState(getNameFromUser(user) ? 'chatting' : 'intro');
  const [userName, setUserName] = useState(getNameFromUser(user));
  const [userEmail, setUserEmail] = useState(user?.email || `guest_${Math.random().toString(36).substring(2, 7)}@callix.io`);
  const [sessionId] = useState(`session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);
  const [selectedLanguage, setSelectedLanguage] = useState({ code: 'en-IN', name: 'English' });
  const [useProSTT, setUseProSTT] = useState(true); // Default to Pro STT for better results

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const ringingAudioRef = useRef(null);
  const chatEndRef = useRef(null);
  const sttCleanupRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const dataArrayRef = useRef(null);
  const flushIntervalRef = useRef(null);
  const restartFlushRef = useRef(null);
  const speechDetectedRef = useRef(false);
  const silenceTimerRef = useRef(null);

  const languageLookup = {
    'en-IN': 'en-IN',
    'hi-IN': 'hi-IN',
    'te-IN': 'te-IN'
  };

  const languageNameMap = {
    'en': 'English', 'en-IN': 'English',
    'hi': 'Hindi', 'hi-IN': 'Hindi',
    'te': 'Telugu', 'te-IN': 'Telugu',
    'ta': '', 'ta-IN': 'Tamil',
    'kn': 'Kannada', 'kn-IN': 'Kannada'
  };

  // Refs for state to avoid stale closures in event listeners
  const stateRef = useRef({
    callState,
    isListening,
    isSpeaking,
    isMuted,
    isOpen,
    convoPhase,
    userName,
    userEmail,
    selectedLanguage,
    messages
  });

  // Sync refs with state
  useEffect(() => {
    stateRef.current = {
      callState,
      isListening,
      isSpeaking,
      isMuted,
      isOpen,
      convoPhase,
      userName,
      userEmail,
      selectedLanguage,
      messages
    };
  }, [callState, isListening, isSpeaking, isMuted, isOpen, convoPhase, userName, userEmail, selectedLanguage, messages]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, transcript]);

  // Determine agent gender and avatar - LOCKED TO FEMALE
  const agentGender = 'female';
  const agentAvatar = '/Female.png';

  // Pre-load voices for browser TTS Fallback
  const [availableVoices, setAvailableVoices] = useState([]);

  useEffect(() => {
    const loadVoices = () => {
      setAvailableVoices(window.speechSynthesis.getVoices());
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, []);

  // Sync with user prop if logged in
  useEffect(() => {
    if (user) {
      const derivedName = getNameFromUser(user);
      setUserName(derivedName);
      setUserEmail(user.email || '');
      if (derivedName) setConvoPhase('chatting');
    }
  }, [user]);

  // Pro STT Logic (MediaRecorder + Azure AI Speech) - STOP-WAIT-RESTART PATTERN
  const startProSTT = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true // Enabled for better sensitivity on mobile/remote
        }
      });

      const mimeType = MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
        ? 'audio/ogg;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio';

      console.log(`🎙️ Using Audio Format: ${mimeType}`);

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 128000
      });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        const hadSpeech = speechDetectedRef.current;

        audioChunksRef.current = []; // Clear immediately
        speechDetectedRef.current = false; // Reset for next session

        const { selectedLanguage: curLang, isSpeaking, isMuted, callState, isOpen } = stateRef.current;

        // Skip if no speech detected or too small or call ended
        if (!hadSpeech || audioBlob.size < 2000 || isMuted || callState !== 'connected' || !isOpen) {
          if (hadSpeech && audioBlob.size < 2000) console.log("🤏 Audio too short, skipping.");
          setIsProcessing(false);
          return;
        }

        console.log(`🎙️ Sending Speech Chunk (${audioBlob.size} bytes) to Cloud STT...`);
        setIsProcessing(true);
        try {
          setIsTranscribing(true);
          // Try to transcribe with current language
          let text = await sttService.transcribe(audioBlob, curLang.code);
          console.log(`🎤 STT Result: "${text}"`);

          setIsTranscribing(false);

          // Only process if it's more than a single short word or noise
          const cleanText = (text || "").trim().toLowerCase();
          if (cleanText.length > 2 && !['hi', 'hello', 'hey', 'yes', 'no'].includes(cleanText)) {
            await handleUserMessage(text, true);
          } else if (cleanText.length > 0) {
            // Short greeting/affirmation - process normally
            await handleUserMessage(text, true);
          } else {
            setIsProcessing(false);
          }
        } catch (e) {
          console.error('❌ STT Pipeline failed:', e);
        } finally {
          setIsTranscribing(false);
          setIsProcessing(false);

          // Restart recording if we're still in a state to listen
          const { isSpeaking: finalIsSpeaking, isMuted: finalIsMuted, callState: finalCallState, isOpen: finalIsOpen } = stateRef.current;
          if (finalCallState === 'connected' && finalIsOpen && !finalIsSpeaking && !finalIsMuted) {
            if (mediaRecorderRef.current?.state === 'inactive') {
              mediaRecorderRef.current.start();
              setIsListening(true);
            }
          }
        }
      };

      // Setup Web Audio API for volume detection
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }

      const audioContext = audioContextRef.current;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      dataArrayRef.current = dataArray;

      // SAFETY ROTATION: Only used as a hard limit for very long monologues
      restartFlushRef.current = () => {
        if (flushIntervalRef.current) clearInterval(flushIntervalRef.current);
        flushIntervalRef.current = setInterval(() => {
          const { isSpeaking, isMuted, callState, isOpen } = stateRef.current;
          if (mediaRecorderRef.current?.state === 'recording' && !isSpeaking && !isMuted && callState === 'connected' && isOpen) {
            // Only rotate if we've actually been talking for a long time
            if (speechDetectedRef.current) {
              console.log("⏹️ Hard-limit rotation (20s monologue)...");
              mediaRecorderRef.current.stop();
            }
          }
        }, 20000);
      };

      mediaRecorder.start();
      restartFlushRef.current();
      setIsListening(true);
      console.log("⏺️ STT Listener Active");

      const checkVolume = () => {
        const { isOpen: curIsOpen, callState: curCallState, isSpeaking: curIsSpeaking } = stateRef.current;
        if (!curIsOpen || curCallState !== 'connected' || !analyserRef.current) return;

        if (mediaRecorder.state === 'recording' && !curIsSpeaking) {
          const currentAnalyser = analyserRef.current;
          const currentDataArray = dataArrayRef.current;
          if (currentAnalyser && currentDataArray) {
            currentAnalyser.getByteFrequencyData(currentDataArray);
            const volume = currentDataArray.reduce((num, i) => num + i) / currentDataArray.length;
            setPulseScale(1 + (volume / 255) * 0.4);

            const isTalking = volume > 15; // Reverted to 15
            setIsUserTalking(isTalking);

            if (isTalking) {
              speechDetectedRef.current = true;
              // Clear silence timer if user starts talking again
              if (silenceTimerRef.current) {
                clearTimeout(silenceTimerRef.current);
                silenceTimerRef.current = null;
              }
            } else if (speechDetectedRef.current) {
              // User was talking but stopped. Start 1.5s silence timer to cut the chunk.
              if (!silenceTimerRef.current) {
                silenceTimerRef.current = setTimeout(() => {
                  console.log("🤫 Silence detected. Processing...");
                  if (mediaRecorderRef.current?.state === 'recording') {
                    mediaRecorderRef.current.stop();
                  }
                  silenceTimerRef.current = null;
                }, 1200); // Reverted to 1200ms
              }
            }
          }
        }
        requestAnimationFrame(checkVolume);
      };
      requestAnimationFrame(checkVolume);

      sttCleanupRef.current = () => {
        try {
          if (flushIntervalRef.current) clearInterval(flushIntervalRef.current);
          if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
          if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
            audioContextRef.current.close();
            audioContextRef.current = null;
          }
          analyserRef.current = null;
          stream.getTracks().forEach(track => track.stop());
        } catch (e) { }
      };

    } catch (e) {
      console.error('Failed to start Pro STT:', e);
      setUseProSTT(false);
    }
  };

  useEffect(() => {
    // Cleanup old STT before starting new one
    if (sttCleanupRef.current) {
      sttCleanupRef.current();
      sttCleanupRef.current = null;
    }

    if (callState === 'connected' && isOpen) {
      console.log(`🚀 [STT] Activating Azure AI Speech for ${selectedLanguage.name}...`);
      startProSTT();
    }

    return () => {
      if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
      if (sttCleanupRef.current) {
        sttCleanupRef.current();
        sttCleanupRef.current = null;
      }
    };
  }, [selectedLanguage.code, callState, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    // Prime the voices list (some browsers load them async)
    if ('speechSynthesis' in window) {
      window.speechSynthesis.getVoices();
    }

    // Play ringing sound
    setCallState('ringing');

    // AUTO-SELECT Telugu for Indian companies to prevent transliteration issues
    const compName = selectedCompany?.name?.toLowerCase() || '';
    if (compName.includes('aarogya') || compName.includes('spice')) {
      setSelectedLanguage({ code: 'te-IN', name: 'Telugu' });
      stateRef.current.selectedLanguage = { code: 'te-IN', name: 'Telugu' };
      console.log("🇮🇳 Indian Company detected: Defaulting to Telugu (Native Script).");
    }

    ringingAudioRef.current = new Audio('/ringtone-027-376908.mp3');
    ringingAudioRef.current.loop = true;
    ringingAudioRef.current.play().catch(e => console.log('Audio play failed:', e));

    // Don't auto-connect - wait for user to select language and click continue

    return () => {
      if (ringingAudioRef.current) {
        ringingAudioRef.current.pause();
      }
      window.speechSynthesis.cancel();
    };
  }, [isOpen]);

  // Fetch Live Knowledge (Catalogue) for the selected company
  useEffect(() => {
    const fetchLiveContext = async () => {
      if (selectedCompany?.id && selectedCompany?.industry) {
        console.log(`🧠 Fetching live catalogue for ${selectedCompany.name}...`);
        const catalogue = await database.getLiveCatalogue(selectedCompany.id, selectedCompany.name);
        setLiveCatalogue(catalogue);
      }
    };
    if (isOpen && selectedCompany) fetchLiveContext();
  }, [isOpen, selectedCompany]);


  const getServiceInfo = (langCode = 'en-IN') => {
    const name = selectedCompany?.name?.toLowerCase() || '';
    const sMap = {
      'en-IN': {
        hospital: "I am specialized in managing clinical appointments, scheduling consultations with our expert doctors, and providing information about our medical departments.",
        restaurant: "I can assist you with our gourmet menu, chef's specials, and securing your table reservations for a premium dining experience.",
        ecommerce: "I am here to help you explore our product catalog, provide detailed pricing, and assist with tracking your specialized orders.",
        tech_mahindra: "I can guide you through our professional career opportunities, global job openings, and schedule your technical interview sessions.",
        voxsphere: "I can provide comprehensive details about our AI-driven software solutions and facilitate a direct demo booking with our specialists.",
        agile_it: "I am prepared to assist with your technical career inquiries, project details, and the scheduling of your recruitment interviews.",
        default: "I am here to assist you with all your professional inquiries and service requirements today."
      },
      'te-IN': {
        hospital: "నేను డాక్టర్ అపాయింట్‌మెంట్‌లను నిర్వహించడంలో, మా నిపుణులైన వైద్యులతో సంప్రదింపులను షెడ్యూల్ చేయడంలో మరియు మా ఇతర వైద్య విభాగాల గురించి సమాచారాన్ని అందించడంలో ప్రత్యేకత కలిగి ఉన్నాను.",
        restaurant: "నేను మా రుచికరమైన మెనూ, ఈరోజు ప్రత్యేక వంటకాలు మరియు మీ కోసం ప్రీమియం టేబుల్ రిజర్వేషన్‌లను బుక్ చేయడంలో సహాయపడతాను.",
        ecommerce: "నేను మా ఉత్పత్తుల వివరాలను చూడటంలో, ఇతర ధరల సమాచారాన్ని అందించడంలో మరియు మీ ఆర్డర్‌లను ట్రాక్ చేయడంలో మీకు సహాయం చేయడానికి ఇక్కడ ఉన్నాను.",
        tech_mahindra: "నేను మా వృత్తిపరమైన కెరీర్ అవకాశాలు, గ్లోబల్ ఉద్యోగ ఖాళీలు మరియు మీ టెక్నికల్ ఇంటర్వ్యూలను షెడ్యూల్ చేయడం ద్వారా మీకు మార్గనిర్దేశం చేయగలను.",
        voxsphere: "నేను మా AI సాఫ్ట్‌వేర్ పరిష్కారాల గురించి సమగ్ర వివరాలను అందించగలను మరియు మా నిపుణులతో నేరుగా డెమో బుకింగ్‌ను ఏర్పాటు చేయగలను.",
        agile_it: "నేను మీ టెక్నికల్ కెరీర్ విచారణలు, ప్రాజెక్ట్ వివరాలు మరియు రిక్రూట్‌మెంట్ ఇంటర్వ్యూలను షెడ్యూల్ చేయడంలో సహాయం చేయడానికి సిద్ధంగా ఉన్నాను.",
        default: "నేను ఈరోజు మీ విచారణలు మరియు సేవా అవసరాలలో మీకు సహాయం చేయడానికి ఇక్కడ ఉన్నాను."
      },
      'hi-IN': {
        hospital: "मैं क्लिनिकल अपॉइंटमेंट प्रबंधित करने, हमारे विशेषज्ञ डॉक्टरों के साथ परामर्श निर्धारित करने और हमारे चिकित्सा विभागों के बारे में जानकारी प्रदान करने में विशेषज्ञ हूँ।",
        restaurant: "मैं हमारे स्वादिष्ट मेनू, शेफ की विशेषताओं और आपके लिए प्रीमियम टेबल रिजर्वेशन बुक करने में आपकी सहायता कर सकता हूँ।",
        ecommerce: "मैं हमारे उत्पाद कैटलॉग को एक्सप्लोर करने, विस्तृत मूल्य निर्धारण प्रदान करने और आपके ऑर्डर को ट्रैक करने में आपकी मदद करने के लिए यहाँ हूँ।",
        tech_mahindra: "मैं आपको हमारे पेशेवर करियर के अवसरों, वैश्विक नौकरी रिक्तियों के माध्यम से मार्गदर्शन कर सकता हूँ और आपके तकनीकी इंटरव्यू सत्र निर्धारित कर सकता हूँ।",
        voxsphere: "मैं हमारे एआई-संचालित सॉफ़्टवेअर समाधानों के बारे में व्यापक विवरण प्रदान कर सकता हूँ और हमारे विशेषज्ञों के साथ सीधे डेमो बुकिंग की सुविधा प्रदान कर सकता हूँ।",
        agile_it: "मैं आपके तकनीकी करियर पूछताछ, प्रोजेक्ट विवरण और भर्ती इंटरव्यू को निर्धारित करने में सहायता के लिए तैयार हूँ।",
        default: "मैं आज आपकी सभी पेशेवर पूछताछ और सेवा आवश्यकताओं में आपकी सहायता करने के लिए यहाँ हूँ।"
      }
    };

    const strings = sMap[langCode] || sMap['en-IN'];
    let compKey = 'default';

    if (name.includes('hospital') || name.includes('aarogya')) compKey = 'hospital';
    else if (name.includes('restaurant') || name.includes('garden') || name.includes('aroma')) compKey = 'restaurant';
    else if (name.includes('kart') || name.includes('commerce')) compKey = 'ecommerce';
    else if (name.includes('mahindra')) compKey = 'tech_mahindra';
    else if (name.includes('voxsphere')) compKey = 'voxsphere';
    else if (name.includes('agile')) compKey = 'agile_it';

    return strings[compKey];
  };

  const handleUserMessage = async (message, fromSTT = false) => {
    const {
      convoPhase: curPhase,
      userName: curName,
      selectedLanguage: curLang,
      isSpeaking: curIsSpeaking
    } = stateRef.current;

    if (!message.trim() || (isProcessing && !fromSTT)) return;
    if (!fromSTT && curIsSpeaking) return;

    if (!fromSTT) setIsProcessing(true);
    setIsThinking(true);

    try {
      const isInternal = message.startsWith('[') && message.endsWith(']');
      if (!isInternal) {
        addMessage('user', message);
      }
      setIsListening(false);
      setTranscript('');

      const currentMsgs = stateRef.current.messages;
      if (currentMsgs.length > 0) {
        const lastAgentMsg = currentMsgs.filter(m => m.sender === 'agent').pop();
        if (lastAgentMsg && lastAgentMsg.text && calculateSimilarity(message, lastAgentMsg.text) > 0.95) {
          console.log(`🚫 Echo detected, ignoring.`);
          setIsProcessing(false);
          setIsThinking(false);
          return;
        }
      }

      if (curPhase === 'onboarding') {
        const extractedName = extractNameFromMessage(message);
        const nextName = extractedName || curName || 'Guest';
        setUserName(nextName);
        setConvoPhase('chatting');
        stateRef.current.userName = nextName;
        stateRef.current.convoPhase = 'chatting';
        message = `${message} [SYSTEM: User name discovered as ${nextName}]`;
      }

      // Main AI Flow starts here
      const lowerMsg = message.toLowerCase();
      let languageChangeDetected = false;
      let newLang = null;

      if (lowerMsg.includes('switch to') || lowerMsg.includes('change to') || lowerMsg.includes('change language')) {
        if (lowerMsg.includes('hindi')) newLang = { code: 'hi-IN', name: 'Hindi' };
        else if (lowerMsg.includes('telugu')) newLang = { code: 'te-IN', name: 'Telugu' };
        else if (lowerMsg.includes('english')) newLang = { code: 'en-IN', name: 'English' };

        if (newLang) languageChangeDetected = true;
      }

      if (languageChangeDetected && newLang) {
        setSelectedLanguage(newLang);
        stateRef.current.selectedLanguage = newLang;
        const response = newLang.code === 'en-IN' ? `Sure! I'll continue in English.` : newLang.code === 'te-IN' ? `సరే! నేను తెలుగులో కొనసాగిస్తాను.` : `ठीक है! मैं हिंदी में जारी रखूंगा।`;
        addMessage('agent', response);
        await speak(response, newLang.code);
        setIsProcessing(false);
        setIsThinking(false);
        return;
      }

      const currentMessages = stateRef.current.messages;
      let specializedPrompt = DefaultPrompt;
      const industry = selectedCompany?.industry?.toLowerCase() || '';
      const compName = selectedCompany?.name?.toLowerCase() || '';

      if (industry.includes('health') || compName.includes('hospital') || compName.includes('aarogya')) specializedPrompt = HospitalPrompt;
      else if (industry.includes('restaur') || compName.includes('garden') || compName.includes('aroma')) specializedPrompt = RestaurantPrompt;
      else if (industry.includes('commerce') || compName.includes('kart')) specializedPrompt = ECommercePrompt;
      else if (industry.includes('business') || industry.includes('tech')) specializedPrompt = BusinessPrompt;

      let languageInstruction = `\n\nCRITICAL: Respond in ${curLang.name} script.`;
      const latestName = stateRef.current.userName || 'Guest';

      const systemPrompt = `
IDENTITY: You are Callix, the warm and professional Virtual Receptionist for ${selectedCompany?.name}.
CURRENT DATE: ${new Date().toLocaleDateString('en-IN')} | CURRENT TIME: ${new Date().toLocaleTimeString('en-IN')}

PERSONALITY & STYLE:
- Polite, VIP Receptionist tone. Warm and helpful.
- Respond in ${curLang.name} script only. Speak as a native ${curLang.name} speaker would.
- Keep responses ultra-brief (max 20 words).

CORE PROTOCOLS:
1. **Details First**: You MUST know the exact Date and Time before booking. IF the user omitted the Date or Time, DO NOT use the bracket. First, ask them politely for the missing details. NEVER GUESS "today".
2. **Action Execution**: When the user confirms they want to proceed with a booking or order AND you have all exact details, you MUST IMMEDIATELY use the bracket: [BOOK_TABLE...], [BOOK_APPOINTMENT...], or [BOOK_ORDER...]. NEVER confirm an action without outputting the bracket!
3. **Discovery**: Use [QUERY_ENTITY_DATABASE] to check services/menu before guessing.
4. **Post-Action**: After a booking is completed, you MUST explicitly ask: "Please rate my assistance from 1 to 5 stars."
5. **Collecting Feedback**: CRITICAL: Whenever the user provides a numeric rating (1-5), you MUST include the exact command [COLLECT_FEEDBACK X/5] in your reply (e.g. [COLLECT_FEEDBACK 4.5/5]). The system cannot save feedback without this bracket.
6. **Hang Up**: If the user says goodbye or no further assistance is needed, use [HANG_UP].
7. **Language**: Use native ${curLang.name} script (Telugu script for Telugu, Devanagari for Hindi).

LIVE KNOWLEDGE:
${liveCatalogue || 'Standard records active.'}

BUSINESS CONTEXT:
${selectedCompany?.nlp_context || 'A premium provider.'}
${specializedPrompt}

USER CONTEXT:
Customer Name: ${latestName}`;

      const rawResponse = await chatWithGroq(
        `User Message: ${message}`,
        currentMessages.map(m => ({ role: m.sender === 'user' ? 'user' : 'assistant', text: m.rawText || m.text })),
        { ...selectedCompany, userName: latestName, userEmail, sessionId, currLangCode: curLang.code, currLangName: curLang.name },
        systemPrompt
      );

      console.log(`🤖 LLM: "${rawResponse}"`);
      setIsThinking(false);

      const finalDisplay = cleanInternalCommands(rawResponse) || "Processing your request...";
      addMessage('agent', finalDisplay, rawResponse);

      const shouldTerminate = rawResponse.toUpperCase().includes('HANG_UP');
      await speak(finalDisplay, curLang.code, shouldTerminate);

      if (shouldTerminate) endCall();

    } catch (error) {
      console.error('Message Handling Error:', error);
      let errorMsg = "I'm sorry, I missed that. Could you repeat it?";
      addMessage('agent', errorMsg);
      await speak(errorMsg, curLang.code);
    } finally {
      setIsProcessing(false);
      setIsThinking(false);
    }
  };

  const addMessage = (sender, text, rawText = null) => {
    setMessages(prev => [...prev, { sender, text, rawText: rawText || text, timestamp: new Date() }]);
  };

  const speak = (text, languageCode, shouldTerminate = false) => {
    return new Promise((resolve) => {
      // Determine language mapping for consistency
      const targetLangCode = languageCode || selectedLanguage.code;
      const ttsLang = languageLookup[targetLangCode] || 'en';
      const languageFullName = languageNameMap[targetLangCode] || 'English';

      console.log(`🗣️ Speak: Code="${targetLangCode}" (mapped to ${ttsLang}), Language="${languageFullName}", Gender="${agentGender}"`);

      setIsSpeaking(true);

      // Stop recording IMMEDIATELY to prevent echo or delay
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
        setIsListening(false);
      }

      const finishSpeech = () => {
        setIsSpeaking(false);
        resolve(); // Resolve promise when speech ends

        // Restart recording ONLY if call is still active AND not terminating
        const { callState: curCallState, isMuted: curIsMuted, isOpen: curIsOpen } = stateRef.current;
        if (curCallState === 'connected' && !curIsMuted && curIsOpen && !shouldTerminate) {
          // Restart Pro STT if needed
          if (mediaRecorderRef.current?.state === 'inactive') {
            mediaRecorderRef.current.start();
            if (restartFlushRef.current) restartFlushRef.current(); // Reset the 12s timer
            setIsListening(true);
          }
        }
      };

      const hasTelugu = /[\u0C00-\u0C7F]/.test(text);
      console.log(`🗣️ Pro TTS Request: Lang="${ttsLang}", Native Script: ${hasTelugu}, Text: "${text.substring(0, 40)}..."`);

      // Force Single Female Voice
      const femaleSpeaker = 'female';

      // Try Self-Hosted Pro TTS Server First
      ttsService.speak(text, ttsLang, femaleSpeaker)
        .then(() => {
          finishSpeech();
        })
        .catch(() => {
          // Fallback: Web Speech API
          const voices = window.speechSynthesis.getVoices();
          const getBestVoice = () => {
            if (voices.length === 0) return null;

            const target = targetLangCode.toLowerCase();
            const isMale = (v) => /male|guy|man|boy|mohan|kannan|ravi|david|mark|deepak|stefan/i.test(v.name.toLowerCase());
            const isFemale = (v) => !isMale(v);

            let chosen = null;

            // 1. HARD-LOCK FOR TELUGU
            if (target.includes('te')) {
              // Priority 1: Female Telugu
              chosen = voices.find(v =>
                (v.lang.toLowerCase().includes('te') || v.name.toLowerCase().includes('telugu')) && isFemale(v)
              );

              // Priority 2: Any Telugu (including Mohan if that's all there is)
              if (!chosen) {
                chosen = voices.find(v => v.lang.toLowerCase().includes('te') || v.name.toLowerCase().includes('telugu'));
              }

              // Priority 3: Female Hindi (Polyglot Fallback)
              if (!chosen || (chosen && isMale(chosen))) {
                const femaleHindi = voices.find(v => (v.lang.toLowerCase().includes('hi') || v.name.toLowerCase().includes('hindi')) && isFemale(v));
                if (femaleHindi) {
                  console.log("🇮🇳 [Gender-Fix] Preferring Female Hindi over Male Telugu for identity compatibility.");
                  chosen = femaleHindi;
                }
              }
            }
            // 2. HARD-LOCK FOR HINDI
            else if (target.includes('hi')) {
              chosen = voices.find(v => (v.lang.toLowerCase().includes('hi') || v.name.toLowerCase().includes('hindi')) && isFemale(v)) ||
                voices.find(v => v.lang.toLowerCase().includes('hi') || v.name.toLowerCase().includes('hindi'));
            }
            // 3. HARD-LOCK FOR ENGLISH (INDIA)
            else {
              chosen = voices.find(v => (v.lang.toLowerCase().includes('en-in') || v.name.toLowerCase().includes('india')) && isFemale(v)) ||
                voices.find(v => v.lang.toLowerCase().includes('en-in') || v.name.toLowerCase().includes('india')) ||
                voices.find(v => v.lang.toLowerCase().includes('en') && isFemale(v)) ||
                voices[0];
            }

            return chosen || voices[0];
          };

          window.speechSynthesis.cancel();
          setTimeout(() => {
            const voice = getBestVoice();
            if (voice || voices.length > 0) {
              const selectedVoice = voice || voices[0];
              console.log(`🔊 [Selection] Locked onto: ${selectedVoice.name} (${selectedVoice.lang}) for ${targetLangCode}`);
              const utterance = new SpeechSynthesisUtterance(text);
              utterance.voice = selectedVoice;
              utterance.lang = selectedVoice.lang;
              utterance.pitch = 1.1;
              utterance.rate = 1.0;
              utterance.onend = finishSpeech;
              utterance.onerror = (e) => {
                console.error("🔥 Browser TTS Error:", e);
                finishSpeech();
              };
              window.speechSynthesis.speak(utterance);
            } else {
              console.warn("⚠️ No suitable voice found for", targetLangCode);
              finishSpeech();
            }
          }, 100);
        });
    });
  };

  const onSpeechEnd = () => {
    // This is now handled inside the speak promise finishSpeech
  };

  const stopAudio = () => {
    ttsService.stop();
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    // Restart listening if not muted
    setTimeout(() => {
      const { callState: curCallState, isMuted: curIsMuted, isOpen: curIsOpen } = stateRef.current;
      if (curCallState === 'connected' && !curIsMuted && curIsOpen) {
        if (mediaRecorderRef.current?.state === 'inactive') {
          mediaRecorderRef.current.start();
          setIsListening(true);
        }
      }
    }, 400);
  };

  const toggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);

    if (nextMuted) {
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      setIsListening(false);
    } else {
      if (callState === 'connected' && mediaRecorderRef.current?.state === 'inactive') {
        mediaRecorderRef.current.start();
        setIsListening(true);
      }
    }
  };

  const handleStartCall = () => {
    // Stop ringing
    if (ringingAudioRef.current) {
      ringingAudioRef.current.pause();
    }

    setCallState('connected');
    const existingName = getNameFromUser(user);
    const nextPhase = existingName ? 'chatting' : 'onboarding';

    setConvoPhase(nextPhase);
    stateRef.current.convoPhase = nextPhase;

    // We no longer trigger an automatic message. 
    // The STT will start automatically due to the callState useEffect, 
    // and the AI will wait for the user to speak first.
    console.log("📞 Call Connected. Waiting for user input...");
  };

  const endCall = () => {
    setCallState('ended');
    setIsListening(false);
    setIsSpeaking(false);
    setMessages([]); // Clear history for next call
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    if (ringingAudioRef.current) ringingAudioRef.current.pause();
    window.speechSynthesis.cancel();
    ttsService.stop();

    // RESET ALL STATES FOR NEXT CALL
    setTimeout(() => {
      setMessages([]);
      setUserName(getNameFromUser(user));
      setConvoPhase('intro');
      setTranscript('');
      setSelectedLanguage({ code: 'en-IN', name: 'English' });
      onClose();
    }, 1500);
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div className="fixed inset-0 z-50 bg-white" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>

        {/* Language Selection Phase */}
        {callState === 'ringing' && (
          <div className="absolute inset-0 overflow-hidden">
            {/* Video Background */}
            <video
              autoPlay
              loop
              muted
              playsInline
              className="absolute inset-0 w-full h-full object-cover"
            >
              <source src="/callbg.mp4" type="video/mp4" />
            </video>

            {/* Overlay */}
            <div className="absolute inset-0 bg-gradient-to-br from-slate-900/60 to-blue-900/60"></div>

            {/* Content */}
            <div className="absolute inset-0 flex flex-col items-center justify-center overflow-y-auto py-4">
              {/* Animated Agent Avatar */}
              <div className="relative mb-6 w-48 h-48 mx-auto">
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-48 h-48 rounded-full bg-blue-200/30 animate-ping"></div>
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-40 h-40 rounded-full bg-blue-300/40 animate-pulse"></div>
                </div>
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

                <div className="flex justify-center flex-nowrap gap-2 mb-6 overflow-x-auto pb-2 scrollbar-hide">
                  {[
                    { code: 'en-IN', name: 'English', locked: false },
                    { code: 'hi-IN', name: 'Hindi', locked: false },
                    { code: 'te-IN', name: 'Telugu', locked: false },
                  ].map((lang) => (
                    <div key={lang.code} className="relative group">
                      <button
                        onClick={() => {
                          if (!lang.locked) {
                            setSelectedLanguage({ code: lang.code, name: lang.name });
                            stateRef.current.selectedLanguage = { code: lang.code, name: lang.name };
                            console.log(`🌐 Language selected: ${lang.name} (${lang.code})`);
                          }
                        }}
                        disabled={lang.locked}
                        className={`px-4 py-2 rounded-full border-2 transition-all duration-300 font-semibold text-sm flex items-center gap-2 ${lang.locked
                          ? 'border-white/20 bg-white/5 text-white/40 cursor-not-allowed'
                          : selectedLanguage.code === lang.code
                            ? 'border-blue-400 bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-lg shadow-blue-500/50 hover:scale-110'
                            : 'border-white/30 bg-white/10 backdrop-blur-sm text-white hover:border-blue-300 hover:bg-white/20 hover:scale-110'
                          }`}
                      >
                        {lang.name}
                        {lang.locked && (
                          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </button>

                      {/* Tooltip */}
                      {lang.locked && (
                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-slate-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-10">
                          <div className="font-semibold mb-1">Coming Soon!</div>
                          <div className="text-slate-300">We're working on {lang.name} support</div>
                          <div className="absolute top-full left-1/2 transform -translate-x-1/2 -mt-1">
                            <div className="border-4 border-transparent border-t-slate-900"></div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="mt-4">
                  <div className="flex items-center justify-center gap-4">

                    {/* Continue Button */}
                    <button
                      onClick={handleStartCall}
                      className="px-8 py-3 bg-[#000080] text-white rounded-full font-bold text-lg shadow-lg hover:bg-blue-700 transition-all transform hover:scale-105"
                    >
                      Continue Call
                    </button>

                    {/* Hangup Button */}
                    <button
                      onClick={endCall}
                      className="p-3 bg-red-500 text-white rounded-full shadow-lg hover:bg-red-600 transition-all transform hover:scale-110"
                    >
                      <PhoneOff size={20} />
                    </button>
                  </div>
                </div>



              </div>
            </div>
          </div>
        )}

        {/* Live Call Interface */}
        {callState === 'connected' && (
          <div className="h-full flex flex-col md:flex-row bg-white">
            {/* Left: Visual Agent */}
            <div className="md:w-1/2 flex flex-col items-center justify-center p-4 md:p-8 bg-slate-50 border-b md:border-b-0 md:border-r border-slate-200 relative shrink-0">
              <div className="relative">
                {/* Decorative Capsule Background */}
                <div className="absolute inset-0 -m-4 bg-gradient-to-b from-slate-100/50 to-white/30 rounded-[80px] blur-xl -z-10 border border-slate-200/50"></div>

                <motion.div
                  animate={{
                    scale: isSpeaking ? [1, 1.03, 1] : 1,
                    boxShadow: isSpeaking
                      ? ["0 15px 35px rgba(74, 222, 128, 0.2)", "0 25px 50px rgba(74, 222, 128, 0.4)", "0 15px 35px rgba(74, 222, 128, 0.2)"]
                      : isListening
                        ? "0 15px 35px rgba(59, 130, 246, 0.2)"
                        : "0 15px 35px rgba(0, 0, 0, 0.1)"
                  }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                  className={`w-32 h-32 md:w-56 md:h-56 aspect-square rounded-full overflow-hidden border-[4px] md:border-[6px] transition-all duration-500 flex items-center justify-center p-1.5 bg-white ${isSpeaking ? 'border-green-400' : isListening ? 'border-blue-600' : 'border-slate-100'
                    }`}
                >
                  <img src={agentAvatar} className="w-full h-full object-cover rounded-full shadow-inner" alt="Callix Agent" />
                </motion.div>
              </div>

              <div className="mt-4 md:mt-10 text-center flex flex-col items-center">
                <h3 className="text-2xl md:text-4xl font-black text-slate-900 tracking-tight">Callix</h3>
                <p className="text-blue-700 font-extrabold uppercase tracking-[0.2em] md:tracking-[0.4em] text-[8px] md:text-[10px] mt-2 bg-blue-50 px-4 py-1 rounded-full border border-blue-100">
                  {selectedCompany?.name || 'VIRTUAL ASSISTANT'}
                </p>

                {/* Real-time Indicator & Waveform */}
                <div className="flex flex-col items-center gap-2 md:gap-4 mt-4 md:mt-6">
                  {isListening && !isSpeaking && (
                    <div className="flex items-center gap-1 h-6 md:h-8">
                      {[1, 2, 3, 4, 5].map(i => (
                        <motion.div
                          key={i}
                          animate={{ height: [4, Math.random() * 16 + 4, 4] }}
                          transition={{ duration: 0.5, repeat: Infinity, delay: i * 0.1 }}
                          className="w-1 bg-blue-500 rounded-full"
                        />
                      ))}
                    </div>
                  )}

                  <div className="flex flex-col items-center gap-1">
                    <div className="flex flex-col items-center gap-2">
                      <div className={`px-3 py-1 md:px-4 md:py-1.5 rounded-full text-[8px] md:text-[10px] font-black tracking-widest uppercase flex items-center space-x-2 border transition-all duration-300 ${isSpeaking ? 'bg-green-100 text-green-700 border-green-200' : isThinking ? 'bg-purple-100 text-purple-700 border-purple-200' : isTranscribing ? 'bg-orange-100 text-orange-700 border-orange-200' : isListening ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`} style={{ transform: `scale(${isListening && !isSpeaking ? pulseScale : 1})` }}>
                        <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${isSpeaking ? 'bg-green-500' : isThinking ? 'bg-purple-500' : isTranscribing ? 'bg-orange-500' : isListening ? 'bg-blue-500' : 'bg-slate-400'}`}></div>
                        <span>{isSpeaking ? 'Speaking' : isThinking ? 'Thinking' : isTranscribing ? 'Transcribing' : isListening ? 'Listening' : 'Ready'}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 md:mt-8 flex items-center space-x-3 md:space-x-4">
                  <button onClick={toggleMute} className={`p-3 md:p-4 rounded-full shadow-lg transition-all ${isMuted ? 'bg-red-500 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}`}>
                    {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
                  </button>
                  {isSpeaking && (
                    <button onClick={stopAudio} className="p-3 md:p-4 bg-orange-500 text-white rounded-full shadow-lg hover:bg-orange-600 animate-bounce">
                      <VolumeX size={20} />
                    </button>
                  )}
                  <button onClick={endCall} className="p-3 md:p-4 bg-red-600 text-white rounded-full shadow-lg hover:bg-red-700 transform hover:scale-110"><PhoneOff size={20} /></button>
                </div>
              </div>
            </div>

            {/* Right: Message Stream */}
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
                  <motion.div initial={{ opacity: 0, x: m.sender === 'user' ? 20 : -20 }} animate={{ opacity: 1, x: 0 }} key={i} className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] p-4 rounded-2xl shadow-sm border ${m.sender === 'user' ? 'bg-[#000080] text-white border-[#000080]' : 'bg-white text-slate-800 border-slate-200'}`}>
                      <p className="text-sm font-medium leading-relaxed">{m.text}</p>
                      <p className={`text-[10px] mt-2 font-bold uppercase opacity-50 ${m.sender === 'user' ? 'text-white' : 'text-slate-400'}`}>{m.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                    </div>
                  </motion.div>
                ))}

                {transcript && (
                  <div className="flex justify-end">
                    <div className="bg-slate-200/50 p-4 rounded-2xl text-slate-500 text-sm font-bold italic animate-pulse">
                      {transcript}...
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <div className="p-6 bg-white border-t border-slate-100">
                <div className="flex items-center space-x-3 text-slate-400">
                  <div className={`w-2 h-2 rounded-full ${isListening ? 'bg-blue-500 animate-ping' : 'bg-slate-300'}`}></div>
                  <span className="text-xs font-black uppercase tracking-widest">{isListening ? 'Voice capture active' : 'Waiting for system'}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* End Screen */}
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
  const editDistance = (a, b) => {
    a = a.toLowerCase(); b = b.toLowerCase();
    let costs = [];
    for (let i = 0; i <= a.length; i++) {
      let lastValue = i;
      for (let j = 0; j <= b.length; j++) {
        if (i === 0) costs[j] = j;
        else if (j > 0) {
          let newValue = costs[j - 1];
          if (a.charAt(i - 1) !== b.charAt(j - 1)) newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
          costs[j - 1] = lastValue;
          lastValue = newValue;
        }
      }
      if (i > 0) costs[b.length] = lastValue;
    }
    return costs[b.length];
  };
  return (longer.length - editDistance(longer, shorter)) / parseFloat(longer.length);
};

export default VoiceOverlay;
