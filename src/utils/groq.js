import { tools } from './database.js';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_AUDIO_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

// --- Safe localStorage helper (SSR + production safe) ---
const safeStorage = {
  get: (key, fallback = '{}') => {
    try {
      return typeof window !== 'undefined' ? (localStorage.getItem(key) || fallback) : fallback;
    } catch { return fallback; }
  },
  parse: (key, fallback = {}) => {
    try { return JSON.parse(safeStorage.get(key, JSON.stringify(fallback))); } catch { return fallback; }
  }
};

// Cleanup utility for internal markers
export const cleanInternalCommands = (text) => {
  if (!text) return '';

  // 1. Aggressively strip internal JSON blocks and system results
  let cleaned = text.replace(/Result:\s*(?:SUCCESS|ERROR).*?(?:Data:|$)/gi, '');
  cleaned = cleaned.replace(/Data:\s*\{[\s\S]*?\}/gi, '');
  cleaned = cleaned.replace(/\{[\s\S]*?"id":[\s\S]*?\}/gi, '');
  cleaned = cleaned.replace(/Data:\s*\[[\s\S]*?\]/gi, '');

  // 2. Clear known bracketed commands and any text inside them
  cleaned = cleaned.replace(/\[(BOOK|COLLECT|QUERY|HANG|SYSTEM|LATEST).*?\]/gi, '');
  cleaned = cleaned.replace(/\[[A-Z_0-9: ]{3,}.*?\]/gi, '');

  const labelsToRemove = [
    /SYSTEM ALERT:.*?(?:\n|$)/gi,
    /LATEST_TASK_OUTCOME:.*?(?:\n|$)/gi,
    /LATEST_DATA:.*?(?:\n|$)/gi,
    /TASK_OUTCOME:.*?(?:\n|$)/gi,
    /INTERNAL_STATE:.*?(?:\n|$)/gi,
    /CRITICAL INSTRUCTIONS:.*?(?:\n|$)/gi,
    /CRITICAL CONTEXT:.*?(?:\n|$)/gi,
    /ACTION RESULT:.*?(?:\n|$)/gi,
    /Booking Result:.*?(?:\n|$)/gi,
    /Feedback Result:.*?(?:\n|$)/gi,
    /Result: SUCCESS/gi,
    /Result: ERROR/gi,
    /Data:\s*/gi
  ];

  labelsToRemove.forEach(pattern => { cleaned = cleaned.replace(pattern, ''); });
  cleaned = cleaned.replace(/\*/g, '');
  return cleaned.trim();
};

// API Key Management
// Load all Groq API keys from Vite env and ensure the primary key is included
const API_KEYS = (typeof import.meta !== 'undefined' && import.meta.env
  ? Object.keys(import.meta.env)
    .filter(key => key.includes('GROQ_API_KEY'))
    .sort()
    .map(key => import.meta.env[key])
    .filter(Boolean)
  : []);

// Debug log – remove in production
console.log('🗝️ Loaded Groq API keys:', API_KEYS);



let currentKeyIndex = 0;
let primaryApiKey = null;
export const initializeGroq = (key) => {
  if (!key) return false;
  primaryApiKey = key;
  if (!API_KEYS.includes(key)) API_KEYS.unshift(key);
  return true;
};

export const isGroqInitialized = () => !!primaryApiKey || API_KEYS.length > 0;

const getActiveKey = () => API_KEYS.length === 0 ? primaryApiKey : API_KEYS[currentKeyIndex];

const rotateKey = () => {
  if (API_KEYS.length <= 1) return false;
  currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
  console.warn(`🔄 Rate limit reached. Switching to API Key #${currentKeyIndex + 1}...`);
  return true;
};

const fetchWithRetry = async (url, options, maxRetries = 3) => {
  let attempt = 0;
  while (attempt <= maxRetries) {
    const currentKey = getActiveKey();
    try {
      const currentOptions = {
        ...options,
        headers: { ...options.headers, 'Authorization': `Bearer ${currentKey}` }
      };
      const response = await fetch(url, currentOptions);

      if (response.status === 429) {
        attempt++; // Always increment first to avoid infinite loops
        const rotated = rotateKey();
        if (rotated) {
          // New key available — retry immediately (don't increment again)
          continue;
        }
        // No more keys — wait with backoff
        if (attempt <= maxRetries) {
          const delay = 2000 * attempt;
          console.warn(`Rate limit hit, no keys to rotate. Retrying in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        // Exhausted retries
        return response;
      }

      if (!response.ok && response.status >= 400 && response.status < 500) return response;
      return response;
    } catch (err) {
      if (attempt >= maxRetries) throw err;
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      attempt++;
    }
  }
};

// Cache to prevent duplicate actions in the same session (persistent across Vite HMR)
const sessionActionsMemory = (typeof window !== 'undefined' && window.__sessionActionsMemory)
  ? window.__sessionActionsMemory
  : new Map();
if (typeof window !== 'undefined') window.__sessionActionsMemory = sessionActionsMemory;

export const chatWithGroq = async (prompt, history = [], companyContext = null, customSystemMessage = null) => {
  if (API_KEYS.length === 0 && !primaryApiKey) throw new Error('No Groq API keys configured.');

  try {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const dayName = now.toLocaleDateString('en-IN', { weekday: 'long' });
    const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

    // SSR-safe user retrieval
    const storedUser = safeStorage.parse('user', {});
    const userName = companyContext?.userName || storedUser.full_name || storedUser.user_metadata?.full_name || 'Guest';

    const isTe = (companyContext?.currLangCode === 'te-IN');
    const isHi = (companyContext?.currLangCode === 'hi-IN');

    const greeting = isTe
      ? `నమస్కారం ${userName}, నేను Callix, ${companyContext?.name || 'మీ వ్యాపారం'} కొరకు వర్చువల్ రిసెప్షనిస్ట్. నేను మీకు ఎలా సహాయపడగలను?`
      : isHi
        ? `नमस्ते ${userName}, मैं Callix हूँ, ${companyContext?.name || 'आपके व्यापार'} के लिए वर्चुअल रिसेप्शनिस्ट। मैं आपकी कैसे मदद कर सकता हूँ?`
        : `Hello ${userName}, I am Callix, the Virtual Receptionist for ${companyContext?.name || 'our company'}. How may I help you today?`;

    const systemMessage = customSystemMessage || `You are Callix, the warm and professional Virtual Receptionist for ${companyContext?.name || 'our business'}.
    CURRENT DATE: ${dateStr} (${dayName}) | CURRENT TIME: ${timeStr}
    INDUSTRY: ${companyContext?.industry || 'Service'}
    USER NAME: ${userName}
    LANGUAGE: ${isTe ? 'TELUGU' : isHi ? 'HINDI' : 'ENGLISH'} (STRICT: Always respond ONLY in this language).
    
    PERSONALITY & STYLE:
    - Polite, attentive, and helpful. 
    - BE ULTRA-CONCISE (Max 2 sentences).
    
    CORE PROTOCOLS:
    1. GREETING: "${greeting}"
    2. ONGOING: DO NOT repeat your introduction.
    3. DISCOVERY: Use [QUERY_ENTITY_DATABASE] for info.
    4. OUT OF CONTEXT: If the user's query is outside the context of the database or your role, DO NOT hallucinate. Instead, say exactly: "I'm designed to work on these roles. You can ask me questions related to these like these:" and provide a brief relevant example from the database.
    5. DETAIL GATHERING: When asking for a booking date and time, ask directly without unnecessary words. Need exact Date AND Time for bookings.
    6. CONFIRM & BOOK: You MUST use the exact action bracket (e.g., [BOOK_APPOINTMENT for <name> on <date> at <time>]) in your response text to trigger the database.
    7. NEXT STEPS: After confirming, ask exactly: "Your Booking is confirmed. Is there anything else I can help you with?"
    8. FEEDBACK: If the user says "no", "that's all", "nothing else", "ఏం లేదు", "అంతే", "వద్దు", "नहीं", "बस" or similar, ask for feedback with a small sentence without unnecessary words: "Please rate my service from 1 to 5 stars."
    9. TERMINATION: Use [HANG_UP] only AFTER you have received a star rating.

    TONE: Professional, ultra-brief. NO MARKDOWN.
    
    ACTION BRACKETS (YOU MUST INCLUDE THESE EXACTLY IN YOUR TEXT TO PERFORM ACTIONS):
    - To query data: [QUERY_ENTITY_DATABASE for topic]
    - To get slots: [GET_AVAILABLE_SLOTS for date]
    - To book appointment: [BOOK_APPOINTMENT for person on YYYY-MM-DD at time]
    - To book table: [BOOK_TABLE for guests on YYYY-MM-DD at time]
    - To book order: [BOOK_ORDER for item (price)]
    - To collect rating: [COLLECT_FEEDBACK X/5]
    - To hang up: [HANG_UP]
    
    CRITICAL: YOU MUST NEVER SAY "Your appointment is confirmed" WITHOUT INCLUDING THE [BOOK_APPOINTMENT ...] BRACKET IN THE SAME MESSAGE. THIS IS MANDATORY.
    
    TELUGU STANDARD RESPONSES:
    - Booking Confirmed: "మీ బుకింగ్ ఖరారైంది. నేను మీకు ఇంకా ఏదైనా సహాయం చేయగలనా?"
    - Feedback Request: "దయచేసి నా సహాయానికి 1 నుండి 5 స్టార్లు రేటింగ్ ఇవ్వండి."
    - Closing: "అభిప్రాయం తెలిపినందుకు ధన్యవాదాలు."
    
    HINDI STANDARD RESPONSES:
    - Booking Confirmed: "आपकी बुकिंग कन्फर्म हो गई है। क्या मैं आपकी और मदद कर सकता हूँ?"
    - Feedback Request: "कृपया मेरी सेवा को 1 से 5 स्टार रेटिंग दें।"
    - Closing: "फीडबैक के लिए धन्यवाद।"`;

    const messages = [
      { role: 'system', content: systemMessage },
      ...history.map(msg => ({ role: msg.role || 'user', content: msg.text || msg.content || '' })),
      { role: 'user', content: prompt }
    ];

    const response = await fetchWithRetry(GROQ_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages,
        temperature: 0.3,
        max_tokens: 600
      })
    });

    if (!response.ok) throw new Error(`Groq Error: ${response.status}`);

    const data = await response.json();
    let assistantMessage = data.choices[0]?.message?.content || '';

    console.log('🤖 AI Raw Response:', assistantMessage);

    const msgUpper = assistantMessage.toUpperCase();
    const hasCommand = /\[.*?\]/i.test(assistantMessage) ||
      msgUpper.includes('BOOK_') || msgUpper.includes('COLLECT_') ||
      msgUpper.includes('QUERY_') || msgUpper.includes('HANG_UP') ||
      msgUpper.includes('STAR') || msgUpper.includes('RATING') ||
      msgUpper.includes('ధన్యవాదాలు') || msgUpper.includes('సెలవు') || msgUpper.includes('धन्यवाद');

    // Force inject bracket if AI failed to include it but used confirmation words
    if (!hasCommand) {
      if ((msgUpper.includes('CONFIRMED') || msgUpper.includes('SUCCESSFUL')) &&
        (msgUpper.includes('APPOINTMENT') || msgUpper.includes('BOOK') || msgUpper.includes('ORDER') || msgUpper.includes('TABLE'))) {
        console.warn('⚠️ AI omitted action bracket despite confirming. Falling back to system extraction.');
      } else if (msgUpper.includes('THANK') && (msgUpper.includes('GOODBYE') || msgUpper.includes('FEEDBACK'))) {
        assistantMessage += ' [HANG_UP]';
      } else if (msgUpper.includes('ధన్యవాదాలు') || msgUpper.includes('సెలవు') || msgUpper.includes('धन्यवाद')) {
        assistantMessage += ' [HANG_UP]';
      }
    }

    let intent = (hasCommand || msgUpper.includes('[HANG_UP]')) ? detectIntent(assistantMessage, companyContext) : null;

    // Fallback: If AI just said "thank you" to a user rating but failed to output [COLLECT_FEEDBACK]
    if (!intent && msgUpper.includes('THANK') && !hasCommand) {
      const userPromptUpper = prompt.toUpperCase();
      if (userPromptUpper.includes('STAR') || userPromptUpper.includes('RATE') || userPromptUpper.includes('RATING') || !isNaN(parseFloat(userPromptUpper))) {
        console.log('🛠 Fallback: Parsing raw user prompt for feedback.');
        intent = detectIntent(prompt, companyContext);
      }
    }

    const isTeLang = (companyContext?.currLangCode === 'te-IN' || companyContext?.selectedLanguage?.code === 'te-IN');
    const isHiLang = (companyContext?.currLangCode === 'hi-IN' || companyContext?.selectedLanguage?.code === 'hi-IN');

    const fallbackMsg = isTeLang
      ? "నేను ఆ వివరాలను నమోదు చేసుకున్నాను. నేను మీకు ఇంకా ఏదైనా సహాయం చేయగలనా?"
      : isHiLang
        ? "मैंने वे विवरण दर्ज कर लिए हैं। क्या मैं आपकी किसी और तरह से सहायता कर सकता हूँ?"
        : "I've carefully noted those details for you. Is there anything else you need assistance with?";

    if (intent) {
      const sessionId = companyContext?.sessionId || 'default';

      // Tighter dedup signature: include rating value for feedback
      let actionSignature;
      if (intent.name === 'collect_feedback') {
        // Include rating so different ratings from same user are distinct,
        // but lock to one per company per rating within the dedup window
        actionSignature = `feedback_${intent.args.companyId}_${intent.args.rating}`;
      } else {
        actionSignature = `${intent.name}_${JSON.stringify(intent.args)}`;
      }

      if (!sessionActionsMemory.has(sessionId)) sessionActionsMemory.set(sessionId, new Set());
      const memorySet = sessionActionsMemory.get(sessionId);

      if (memorySet.has(actionSignature) && intent.name !== 'query_entity_database') {
        console.log('⚠️ Duplicate Intent Prevented in session:', intent.name);
        return assistantMessage || fallbackMsg;
      }

      memorySet.add(actionSignature);

      // Extract raw bracket string for booking verification
      console.log('🤖 Detected Intent:', intent.name, 'Args:', intent.args);
      const result = await executeAction(intent);
      console.log('🛠 Action Result:', result);

      let criticalInstructions = `
        1. Provide a warm, professional receptionist confirmation.
        2. DO NOT repeat internal keywords or brackets.
        3. Always provide a TEXT RESPONSE alongside any [COMMAND].
        4. Keep it conversational. If listing items, list 2-3 clearly with prices.`;

      const criticalInstructionsHi = intent.name === 'collect_feedback'
        ? `- फीडबैक सुरक्षित हो गया है। बस कहें: "फीडबैक के लिए धन्यवाद।" तुरंत [HANG_UP] का उपयोग करें।`
        : intent.name === 'hang_up'
          ? `- संक्षेप में समाप्त करें: "धन्यवाद, अलविदा।"`
          : ['book_appointment', 'book_table', 'book_order'].includes(intent.name)
            ? `- केवल एक वाक्य: "आपकी बुकिंग कन्फर्म हो गई है। क्या मैं आपकी और मदद कर सकता हूँ?"`
            : `- संक्षेप में उत्तर दें (अधिकतम 2 वाक्य)।`;

      if (['query_entity_database', 'get_available_slots'].includes(intent.name)) {
        criticalInstructions = isTeLang
          ? `- వినియోగదారుకు తెలుగులో సమాధానం ఇవ్వండి. LATEST_DATAలో ఉన్న వివరాలను మాత్రమే చదవండి. 2-3 ముఖ్యమైన వివరాలు మరియు ధరలను స్పష్టంగా చెప్పండి. గరిష్టంగా 3 వాక్యాలలో ముగించండి. లేని సమాచారాన్ని సృష్టించవద్దు. సంబంధం లేని ప్రశ్నలు అడిగితే తప్పుగా ఊహించకండి (do not hallucinate).`
          : isHiLang
            ? `- उपयोगकर्ता को हिंदी में उत्तर दें। LATEST_DATA में मौजूद विवरणों को ही पढ़ें। 2-3 महत्वपूर्ण विवरण और कीमतें स्पष्ट रूप से बताएं। अधिकतम 3 वाक्यों में समाप्त करें। डेटा न मिलने पर कल्पना न करें (do not hallucinate).`
            : `- Speak normally as a helpful virtual assistant. Read exact items and prices from LATEST_DATA. NEVER invent or hallucinate data. If the prompt is outside context, tell them you are designed to work on these roles and suggest related questions.`;
      } else if (intent.name === 'collect_feedback') {
        criticalInstructions = isTeLang
          ? `- అభిప్రాయం విజయవంతంగా సేవ్ చేయబడింది. కేవలం "అభిప్రాయం తెలిపినందుకు ధన్యవాదాలు." అని చెప్పండి. ఆ వెంటనే [HANG_UP] వాడండి.`
          : isHiLang ? criticalInstructionsHi
            : `- Feedback saved. Say exactly: "Thanks for the feedback." Then immediately use [HANG_UP].`;
      } else if (intent.name === 'hang_up') {
        criticalInstructions = isTeLang
          ? `- క్లుప్తంగా ముగించండి: "ధన్యవాదాలు, సెలవు."`
          : isHiLang ? criticalInstructionsHi
            : `- Just say: "Thank you, goodbye."`;
      } else if (['book_appointment', 'book_table', 'book_order'].includes(intent.name)) {
        criticalInstructions = isTeLang
          ? `- కేవలం ఒకే వాక్యం: "మీ బుకింగ్ ఖరారైంది. నేను మీకు ఇంకా ఏదైనా సహాయం చేయగలనా?"`
          : isHiLang ? criticalInstructionsHi
            : `- ULTRA-MINIMALIST: Just say exactly "Your Booking is confirmed. Is there anything else I can help you with?"`;
      }

      const criticalSystemAddon = isTeLang
        ? `గమనిక: సమయం గురించి ఎటువంటి విశ్లేషణ వద్దు. నేరుగా సమాధానం చెప్పండి.`
        : isHiLang
          ? `महत्वपूर्ण: आंतरिक तर्क या समय की तुलना कभी न समझाएं। बस पुष्टि करें।`
          : `CRITICAL: NEVER explain internal logic or time comparisons. Just confirm or suggest.`;

      const finalResponse = await fetchWithRetry(GROQ_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant',
          messages: [
            { role: 'system', content: `${systemMessage}\n\n${criticalSystemAddon}\n\nCRITICAL CONTEXT: ${criticalInstructions}` },
            ...messages.slice(-4),
            { role: 'assistant', content: assistantMessage },
            {
              role: 'user',
              content: `[SYSTEM ALERT: TASK OUTCOME]\nResult: ${(result && !result.error && (result.success || typeof result === 'string')) ? 'SUCCESS' : 'ERROR'}.\nData: ${typeof result === 'string' ? result : JSON.stringify(result)}.`
            }
          ],
          temperature: 0.1,
          max_tokens: 600
        })
      });

      if (finalResponse && finalResponse.ok) {
        const finalData = await finalResponse.json();
        const confirmationText = finalData.choices[0]?.message?.content;
        let finalDisplay = confirmationText;
        if (!finalDisplay || finalDisplay.length < 2) finalDisplay = assistantMessage;
        return finalDisplay || fallbackMsg;
      }

      return assistantMessage || fallbackMsg;
    }

    return assistantMessage || fallbackMsg;

  } catch (error) {
    console.error('Groq AI Error:', error);
    throw error;
  }
};

const detectIntent = (message, context) => {
  const msg = message.toUpperCase();
  const entityId = context?._id || context?.id || context?.company_id || 'manual';
  const entityName = context?.name || 'General';
  const industry = context?.industry || 'Other';

  // SSR-safe user data
  const storedUser = safeStorage.parse('user', {});
  const userEmail = context?.userEmail || storedUser.email || '';
  const userName = context?.userName || storedUser.full_name || 'Guest';
  const systemDate = context?.systemDate || new Date();

  const cleanArg = (val, fallback = '', type = 'any') => {
    if (!val) return fallback;
    let cleaned = val.replace(/[\[\]{}"']/g, '').replace(/(?:dish|item|name|product|title|guest|guests):\s*/gi, '').trim();
    const low = cleaned.toLowerCase();

    if (low.includes('available time') || low.includes('any time') || low.includes('select time') || low.includes('tbd')) return fallback;
    if (low === 'date' || low === 'time' || low === 'guests') return fallback;

    if (type === 'date') {
      const isKnownDay = /^(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|ఈరోజు|రేపు|సోమవారం|మంగళవారం|బుధవారం|గురువారం|శుక్రవారం|శనివారం|ఆదివారం)/i.test(low);
      const isNumericDate = /\d/.test(low) && (low.includes('-') || low.includes('/') || low.includes(','));
      if (!isKnownDay && !isNumericDate) return fallback;
    }

    if (type === 'time') {
      const hasNumbers = /\d/.test(low);
      const hasTimePeriod = /am|pm/i.test(low);
      const hasColon = low.includes(':');
      if (!hasNumbers && !hasTimePeriod && !hasColon) return fallback;
    }

    return cleaned || fallback;
  };

  const formatDateLocal = (date) => {
    try {
      const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
      return formatter.format(date);
    } catch {
      const d = new Date(date);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
  };

  const parseRelativeDate = (dateStr) => {
    if (!dateStr || dateStr.toUpperCase() === 'TBD') return 'TBD';

    const raw = dateStr.toLowerCase().trim();
    const isNext = /next|अगला|తర్వాత/i.test(raw);
    let low = raw.replace(/next|अगला|తర్వాత/i, '').trim();

    const systemReference = systemDate ? new Date(systemDate) : new Date();

    if (low === 'today' || low === 'ఈరోజు' || low === 'आज') return formatDateLocal(systemReference);
    if (low === 'tomorrow' || low === 'రేపు' || low === 'कल') {
      const target = new Date(systemReference);
      target.setDate(systemReference.getDate() + 1);
      return formatDateLocal(target);
    }

    const dayMap = {
      'sunday': 0, 'ఆదివారం': 0, 'रविवार': 0,
      'monday': 1, 'సోమవారం': 1, 'सोमवार': 1,
      'tuesday': 2, 'మంగళవారం': 2, 'मंगलवार': 2,
      'wednesday': 3, 'బుధవారం': 3, 'बुधवार': 3,
      'thursday': 4, 'గురువారం': 4, 'गुरुवार': 4,
      'friday': 5, 'శుక్రవారం': 5, 'शुक्रवार': 5,
      'saturday': 6, 'శనివారం': 6, 'शनिवार': 6
    };

    if (dayMap[low] !== undefined) {
      const targetDayIdx = dayMap[low];
      const todayIdx = systemReference.getDay();
      let diff = targetDayIdx - todayIdx;
      if (diff <= 0) diff += 7;
      if (isNext) diff += 7;
      const targetDate = new Date(systemReference);
      targetDate.setDate(systemReference.getDate() + diff);
      return formatDateLocal(targetDate);
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(low)) return low;

    const ddmmyyyy = low.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (ddmmyyyy) return `${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2, '0')}-${ddmmyyyy[1].padStart(2, '0')}`;

    const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    const monthRegex = new RegExp(`(\\d{1,2})\\s+(${months.join('|')})|(${months.join('|')})\\s+(\\d{1,2})`, 'i');
    const monthMatch = low.match(monthRegex);
    if (monthMatch) {
      const day = monthMatch[1] || monthMatch[4];
      const monthName = monthMatch[2] || monthMatch[3];
      const monthIdx = months.indexOf(monthName.toLowerCase()) + 1;
      return `${systemReference.getFullYear()}-${String(monthIdx).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }

    return 'TBD';
  };

  // --- Appointment ---
  const isBookingText = msg.includes('BOOK') || msg.includes('APPOINTMENT') || msg.includes('DOCTOR') ||
    msg.includes('బుక్') || msg.includes('అపాయింట్మెంట్') ||
    msg.includes('बुक') || msg.includes('अपॉइंटमेंट');

  if (isBookingText && (msg.includes('APPOINTMENT') || msg.includes('DOCTOR') || msg.includes('MEETING') ||
    msg.includes('RESERVE') || msg.includes('రిజర్వ్') || msg.includes('రిజర్వేషన్') ||
    msg.includes('रिज़र्व') || msg.includes('आरक्षण'))) {
    let pName = 'General', dDate = 'today', tTime = 'TBD';

    let match = message.match(/BOOK[_\s](?:APPOINTMENT|DOCTOR|MEETING|RECORD)\s*(?:for\s+)?(.*?)\s+on\s+(.*?)\s+at\s+([^\n.\r\]]*)/i);
    if (match) {
      pName = match[1]; dDate = match[2]; tTime = match[3];
    } else {
      const cmdMatch = message.match(/BOOK[_\s](?:APPOINTMENT|DOCTOR|MEETING|RECORD)\s+([^\]]+)/i);
      const detailsStr = cmdMatch ? cmdMatch[1] : message;
      const parts = detailsStr.split(/\s+(?:on|at|కి|న|రోజు|పర|को|బజే)\s+/i);
      if (parts.length >= 3) {
        pName = parts[0]; dDate = parts[1]; tTime = parts[2];
      } else {
        const timeMatch = detailsStr.match(/at\s+([^\s\]]+)/i) || detailsStr.match(/(\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm))/i);
        if (timeMatch) tTime = timeMatch[1].trim();
        const dateMatch = detailsStr.match(/on\s+([^\s\]]+)/i) || detailsStr.match(/(today|tomorrow|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|ఈరోజు|రేపు|సోమవారం|మంగళవారం|బుధవారం|గురువారం|శుక్రవారం|శనివారం|ఆదివారం|आज|कल|सोमवार|मंगलवार|बुधवार|गुरुवार|शुक्रवार|शनिवार|रविवार)/i);
        if (dateMatch) dDate = dateMatch[1].trim();
        const personMatch = detailsStr.match(/(?:for\s+|के\s+लिए\s+)?(.*?)(?:\s+on|\s+at|\s+पर|\s+को|$|\])/i);
        if (personMatch) pName = personMatch[1].trim();
      }
    }

    pName = cleanArg(pName, 'General');
    dDate = parseRelativeDate(cleanArg(dDate, 'TBD', 'date'));
    tTime = cleanArg(tTime, 'TBD', 'time');

    const type = (industry.toLowerCase().includes('health') || industry.toLowerCase().includes('hosp')) ? 'doctor' : 'interview';
    console.log(`📌 Booking Parsed: Person=${pName}, Date=${dDate}, Time=${tTime}`);

    return { name: 'book_appointment', args: { entityId, entityName, type, industry, personName: pName, date: dDate, time: tTime, userEmail, userName } };
  }

  // --- Table ---
  if (msg.includes('BOOK') && (msg.includes('TABLE') || msg.includes('RESERVATION'))) {
    let gSize = '2', bDate = 'today', bTime = 'TBD';

    let match = message.match(/BOOK[_\s](?:TABLE|RESERVATION)\s*(?:for\s+)?(.*?)\s+on\s+(.*?)\s+at\s+([^\n.\r\]]*)/i);
    if (match) {
      gSize = match[1]; bDate = match[2]; bTime = match[3];
    } else {
      const cmdMatch = message.match(/BOOK[_\s](?:TABLE|RESERVATION)\s+([^\]]+)/i);
      const detailsStr = cmdMatch ? cmdMatch[1] : message;
      const guestMatch = detailsStr.match(/(?:for\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:guests|people|members|persons|pax)?/i) || detailsStr.match(/(\d+)/);
      if (guestMatch) gSize = guestMatch[1];
      const timeMatch = detailsStr.match(/at\s+([^\s\]]+)/i) || detailsStr.match(/(\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm))/i);
      if (timeMatch) bTime = timeMatch[1].trim();
      const dateMatch = detailsStr.match(/on\s+([^\s\]]+)/i) || detailsStr.match(/(today|tomorrow|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i);
      if (dateMatch) bDate = dateMatch[1].trim();
    }

    gSize = cleanArg(gSize, '2');
    bDate = parseRelativeDate(cleanArg(bDate, 'TBD', 'date'));
    bTime = cleanArg(bTime, 'TBD', 'time');

    const finalTitle = gSize.toLowerCase().includes(userName.toLowerCase()) || userName.toLowerCase().includes(gSize.toLowerCase())
      ? `Table for ${gSize}`
      : `Table for ${gSize} (${userName})`;

    return {
      name: 'book_appointment',
      args: { entityId, entityName, type: 'table', industry: 'Food & Beverage', personName: finalTitle, date: bDate, time: bTime, userEmail, userName, relatedId: 'TABLE_TBD' }
    };
  }

  // --- Order ---
  if (msg.includes('BOOK_ORDER')) {
    const match = message.match(/BOOK_ORDER (?:for )?(.*?)(?:\s*[\r\n\]]|$)/i) || message.match(/BOOK_ORDER\s+([^\]]+)\]/i);
    let item = 'Item', totalPrice = 0;
    if (match) {
      let fullText = match[1].replace(/[\[\]{}"']/g, '').replace(/(?:dish|item|name|product|title):\s*/gi, '').trim();
      const priceMatch = fullText.match(/[₹\$]\s?([\d,]+)/) || fullText.match(/\(([\d,]+)\)/);
      totalPrice = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : 999;
      item = fullText.split(/[₹\$\(\[]/)[0].trim();
    } else {
      const fallbackMatch = message.match(/BOOK_ORDER\s+(.*)/i);
      if (fallbackMatch) item = fallbackMatch[1].replace(/[\[\]]/g, '').trim().substring(0, 30);
    }
    return { name: 'book_order', args: { companyId: entityId, entityName, item, totalPrice, customerName: userName, userEmail, industry } };
  }

  // --- Feedback ---
  const isExplicitFeedback = msg.includes('[COLLECT_FEEDBACK') || msg.includes('COLLECT_FEEDBACK') ||
    msg.includes('RATING') || msg.includes('RATE') || msg.includes('STAR') ||
    msg.includes('రేటింగ్') || msg.includes('రేట్') || msg.includes('స్టార్') ||
    msg.includes('रेटिंग') || msg.includes('स्टार') || msg.includes('रेट');

  if (isExplicitFeedback) {
    let rating = 0;
    const bracketMatch = message.match(/\[COLLECT_FEEDBACK\s*([\d.]+)(\s*\/\s*5)?\s*\]/i);
    if (bracketMatch) {
      rating = parseFloat(bracketMatch[1]);
    } else {
      const isRangeRequest = message.match(/1\s*(?:to|-| నుండి | సే | తక్ )\s*5/i);
      if (!isRangeRequest) {
        const ratingMatch = message.match(/([\d.]+)\s?\/\s?5/) || message.match(/Rating:\s*([\d.]+)/i) || message.match(/([\d.]+)\s*star/i);
        rating = ratingMatch ? parseFloat(ratingMatch[1]) : 0;
      }
    }

    if (rating === 0) {
      const spelledLower = msg.toLowerCase();
      if (spelledLower.includes('one') || spelledLower.includes('ఒకటి') || spelledLower.includes('एक')) rating = 1;
      else if (spelledLower.includes('two') || spelledLower.includes('రెండు') || spelledLower.includes('दो')) rating = 2;
      else if (spelledLower.includes('three') || spelledLower.includes('మూడు') || spelledLower.includes('तीन')) rating = 3;
      else if (spelledLower.includes('four') || spelledLower.includes('నాలుగు') || spelledLower.includes('चार')) rating = 4;
      else if (spelledLower.includes('five') || spelledLower.includes('ఐదు') || spelledLower.includes('पाँच') || spelledLower.includes('पांच')) rating = 5;
    }

    if (rating > 0) {
      if (rating > 5) return { name: 'invalid_feedback', args: { rating } };

      const comment = message
        .replace(/\[COLLECT_FEEDBACK.*?\]/gi, '')
        .replace(/\[.*?\]/g, '')
        .split(/how would you rate|please rate|దయచేసి|రేటింగ్/i)[0]
        .replace(/Callix|Virtual Assistant|Receptionist/gi, '')
        .trim()
        .substring(0, 100) || 'Voice Feedback';

      return {
        name: 'collect_feedback',
        args: { companyId: entityId, companyName: entityName, rating, user_email: userEmail, user_name: userName, comment, industry }
      };
    }
  }

  if (msg.includes('GET_AVAILABLE_SLOTS')) {
    const match = message.match(/GET_AVAILABLE_SLOTS (?:for )?(.*)/i);
    const date = match ? match[1].replace(/[\[\]]/g, '').trim() : 'today';
    return { name: 'get_available_slots', args: { entityId, date, industry } };
  }

  if (msg.includes('QUERY_ENTITY_DATABASE') || msg.includes('చూపించు') || msg.includes('అందుబాటులో') || msg.includes('सेवाएं') || msg.includes('दिखाओ')) {
    const match = message.match(/QUERY_ENTITY_DATABASE (?:for )?(.*)/i);
    const query = match ? match[1].replace(/[\[\]]/g, '').trim() : message;
    return { name: 'query_entity_database', args: { entityId, query } };
  }

  if (msg.includes('HANG_UP') || msg.includes('ధన్యవాదాలు') || msg.includes('సెలవు') || msg.includes('బై') || msg.includes('धन्यवाद') || msg.includes('बाय')) {
    return { name: 'hang_up', args: {} };
  }

  return null;
};

const executeAction = async (match) => {
  const { name, args } = match;
  if (name === 'invalid_feedback') {
    return { error: `User provided an invalid rating of ${args.rating} stars. Gently inform them ratings must be 1–5 stars, and ask again.` };
  }
  if (tools[name]) return await tools[name](args);
  return { error: 'Unknown action' };
};

export const transcribeAudio = async (audioBlob, languageCode = 'en') => {
  const formData = new FormData();
  formData.append('file', audioBlob, 'audio.webm');
  formData.append('model', 'whisper-large-v3');
  formData.append('language', languageCode.split('-')[0]);
  const response = await fetchWithRetry(GROQ_AUDIO_URL, { method: 'POST', body: formData });
  if (!response.ok) throw new Error('Transcription Error');
  const data = await response.json();
  return data.text;
};