import { tools } from './database.js';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_AUDIO_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

// Cleanup utility for internal markers
export const cleanInternalCommands = (text) => {
  if (!text) return '';
  // Force removal of internal brackets like [BOOK_APPOINTMENT ...] or [COLLECT_FEEDBACK ...]
  let cleaned = text.replace(/\[[A-Z_]{4,}(?:\s+[^\]]*)?\]/gi, '');

  // Strip system markers that might leak
  cleaned = cleaned.replace(/\[SYSTEM ALERT:.*?\]/gi, '').replace(/\[SYSTEM ALERT:.*?$/gi, '');
  cleaned = cleaned.replace(/LATEST_TASK_OUTCOME:.*?(?:\n|$)/gi, '');
  cleaned = cleaned.replace(/LATEST_DATA:.*?(?:\n|$)/gi, '');
  cleaned = cleaned.replace(/CRITICAL INSTRUCTIONS:.*?(?:\n|$)/gi, '');
  cleaned = cleaned.replace(/CRITICAL CONTEXT:.*?(?:\n|$)/gi, '');
  cleaned = cleaned.replace(/ACTION RESULT:.*?(?:\n|$)/gi, '');
  cleaned = cleaned.replace(/\*/g, ''); // Remove Markdown bolding

  return cleaned.trim();
};

// API Key Management
const API_KEYS = Object.keys(import.meta.env)
  .filter(key => key.includes('GROQ_API_KEY'))
  .sort()
  .map(key => import.meta.env[key])
  .filter(Boolean);

let currentKeyIndex = 0;
let primaryApiKey = null;

export const initializeGroq = (key) => {
  if (!key) return false;
  primaryApiKey = key;
  if (!API_KEYS.includes(key)) {
    API_KEYS.unshift(key);
  }
  return true;
};

export const isGroqInitialized = () => !!primaryApiKey || API_KEYS.length > 0;

const getActiveKey = () => {
  if (API_KEYS.length === 0) return primaryApiKey;
  return API_KEYS[currentKeyIndex];
};

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
        headers: {
          ...options.headers,
          'Authorization': `Bearer ${currentKey}`
        }
      };
      const response = await fetch(url, currentOptions);
      if (response.status === 429) {
        // Always increment attempt on 429 to prevent infinite loops
        attempt++;
        if (rotateKey()) {
          // If a key was rotated, try again immediately with the new key
          continue;
        } else {
          // No more keys to rotate, or only one key. Wait and retry with the same key.
          if (attempt <= maxRetries) {
            const delay = 2000 * attempt; // Use current attempt for delay calculation
            console.warn(`Rate limit hit, no more keys to rotate or single key. Retrying in ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
        }
      }
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500 && response.status !== 429) return response;
      }
      return response;
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const delay = 1000 * (attempt + 1);
      await new Promise(r => setTimeout(r, delay));
      attempt++;
    }
  }
};

// Cache to prevent duplicate actions in the same session string (Persistant across Vite HMR)
const sessionActionsMemory = typeof window !== 'undefined' && window.__sessionActionsMemory
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

    const storedUser = JSON.parse(localStorage.getItem('user') || '{}');
    const userName = companyContext?.userName || storedUser.full_name || storedUser.user_metadata?.full_name || 'Guest';
    const isFirstTurn = (history.length === 0);

    const isTe = (companyContext?.currLangCode === 'te-IN');
    const isHi = (companyContext?.currLangCode === 'hi-IN');

    const greeting = isTe
      ? `నమస్కారం ${userName}, నేను Callix. మీకు ఎలా సహాయం చేయగలను?`
      : isHi
        ? `नमस्ते ${userName}, मैं Callix हूँ। मैं आपकी कैसे सहायता कर सकता हूँ?`
        : `Hello ${userName}, I'm Callix. How may I assist you today?`;

    const systemMessage = customSystemMessage || `You are Callix, the warm and professional Virtual Receptionist for ${companyContext?.name || 'our business'}.
    CURRENT DATE: ${dateStr} (${dayName}) | CURRENT TIME: ${timeStr}
    INDUSTRY: ${companyContext?.industry || 'Service'}
    USER NAME: ${userName}
    LANGUAGE: ${isTe ? 'TELUGU' : isHi ? 'HINDI' : 'ENGLISH'} (STRICT: Always respond ONLY in this language).
    
    PERSONALITY & STYLE:
    - Polite, attentive, and helpful. Treat every user like a VIP guest.
    - RESPOND FULLY in the detected language. Do NOT mix languages.
    - BE ULTRA-CONCISE (Max 2 sentences).
    
    CORE PROTOCOLS:
    1. GREETING: "${greeting}"
    2. ONGOING: DO NOT repeat your introduction or greeting after the first message.
    3. DISCOVERY: Use [QUERY_ENTITY_DATABASE] to find info.
    4. DETAIL GATHERING: Ask for exact Date AND Time. Do not book until you have BOTH.
    5. CONFIRM & BOOK: Use [BOOK_APPOINTMENT], [BOOK_ORDER], or [BOOK_TABLE].
    6. NEXT STEPS: After confirming, ask if they need anything else.
    7. FEEDBACK: When the user is ready to end/says "No", you MUST ask for a 1-5 star rating. 
    8. TERMINATION: NEVER use [HANG_UP] until AFTER you have received a star rating. Asking for the rating is mandatory.

    TONE: Professional, receptionist-like, ultra-brief. NO MARKDOWN.
    
    ACTION BRACKETS:
    - [QUERY_ENTITY_DATABASE for topic]
    - [GET_AVAILABLE_SLOTS for date]
    - [BOOK_APPOINTMENT for person on YYYY-MM-DD at time]
    - [BOOK_TABLE for guests on YYYY-MM-DD at time]
    - [BOOK_ORDER for item (price)]
    - [COLLECT_FEEDBACK rating/5]
    - [HANG_UP]
    
    TELUGU STANDARD RESPONSES:
    - Booking Confirmed: "మీ బుకింగ్ ఖరారైంది. నేను మీకు ఈరోజు ఇంకా ఏదైనా సహాయం చేయగలనా?"
    - Feedback Request: "దయచేసి నా సహాయానికి 1 నుండి 5 వరకు రేటింగ్ ఇవ్వండి."
    - Closing: "మీ అభిప్రాయానికి ధన్యవాదాలు! మళ్ళీ సేవించడానికి ఎదురుచూస్తున్నాము." (MANDATORY: Use this only after [COLLECT_FEEDBACK])
    
    HINDI STANDARD RESPONSES:
    - Booking Confirmed: "आपकी बुकिंग सफलतापूर्वक दर्ज हो गई है। क्या मैं आपकी और सहायता कर सकता हूँ?"
    - Feedback Request: "कृपया मेरी सहायता को 1 से 5 स्टार तक रेटिंग दें।"
    - Closing: "आपकी प्रतिक्रिया के लिए धन्यवाद! हम फिर से आपकी सेवा करने के लिए तत्पर हैं।" (MANDATORY: Use this only after [COLLECT_FEEDBACK])`;

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

    // Handle Intent - Much more inclusive detection
    const msgUpper = assistantMessage.toUpperCase();
    const hasCommand = /\[.*?\]/i.test(assistantMessage) ||
      msgUpper.includes('BOOK_') || msgUpper.includes('COLLECT_') ||
      msgUpper.includes('QUERY_') || msgUpper.includes('HANG_UP');

    let intent = hasCommand ? detectIntent(assistantMessage, companyContext) : null;



    if (intent) {
      const sessionId = companyContext?.sessionId || 'default';

      // Prevent double feedback if comment wording naturally changes slightly
      let actionSignature;
      if (intent.name === 'collect_feedback') {
        actionSignature = `feedback_${intent.args.companyId}_locked`;
      } else {
        actionSignature = `${intent.name}_${JSON.stringify(intent.args)}`;
      }

      if (!sessionActionsMemory.has(sessionId)) {
        sessionActionsMemory.set(sessionId, new Set());
      }
      const memorySet = sessionActionsMemory.get(sessionId);

      const isTe = (companyContext?.currLangCode === 'te-IN' || companyContext?.selectedLanguage?.code === 'te-IN');
      const isHi = (companyContext?.currLangCode === 'hi-IN' || companyContext?.selectedLanguage?.code === 'hi-IN');

      const fallbackMsg = isTe
        ? "నేను ఆ వివరాలను నమోదు చేసుకున్నాను. నేను మీకు ఇంకా ఏదైనా సహాయం చేయగలనా?"
        : isHi
          ? "मैंने वे विवरण दर्ज कर लिए हैं। क्या मैं आपकी किसी और तरह से सहायता कर सकता हूँ?"
          : "I've carefully noted those details for you. Is there anything else you need assistance with?";

      if (memorySet.has(actionSignature) && intent.name !== 'query_entity_database') {
        console.log('⚠️ Duplicate Intent Prevented in session:', intent.name);
        return cleanInternalCommands(assistantMessage) || fallbackMsg;
      }

      memorySet.add(actionSignature);

      console.log('🤖 Detected Intent:', (intent.name || 'unknown'), (intent.args || {}));
      const result = await executeAction(intent);
      console.log('🛠 Action Result:', result);

      // Confirmation turn - Force-focused on the latest result to prevent repetition
      let criticalInstructions = `
              1. Provide a warm, professional receptionist confirmation.
              2. DO NOT repeat internal keywords or brackets.
              3. YOU MUST ALWAYS PROVIDE A TEXT RESPONSE alongside any [COMMAND]. Never output only a command.
              4. Keep it conversational. If listing items, list 2-3 clearly with prices.`;

      // Use the isTe flag defined above


      const criticalInstructionsHi = intent.name === 'collect_feedback'
        ? `- फीडबैक सुरक्षित हो गया है (TASK COMPLETED).
           - बस कहें: "आपकी प्रतिक्रिया के लिए धन्यवाद! हम फिर से आपकी सेवा करने के लिए तत्पर हैं।"
           - तुरंत [HANG_UP] का उपयोग करें।`
        : intent.name === 'hang_up'
          ? `- संक्षेप में समाप्त करें: "धन्यवाद, अलविदा।"`
          : ['book_appointment', 'book_table', 'book_order'].includes(intent.name)
            ? `- केवल एक वाक्य कहें: "आपकी बुकिंग सफलतापूर्वक दर्ज हो गई है। क्या मैं आपकी और सहायता कर सकता हूँ?"`
            : `- संक्षेप में उत्तर दें (अधिकतम 2 वाक्य)।`;

      if (['query_entity_database', 'get_available_slots'].includes(intent.name)) {
        criticalInstructions = isTe
          ? `- వినియోగదారుకు తెలుగులో సమాధానం ఇవ్వండి.
              - LATEST_DATAలో ఉన్న వివరాలను మాత్రమే చదవండి. 2-3 ముఖ్యమైన వివరాలు మరియు ధరలను స్పష్టంగా చెప్పండి.
              - గరిష్టంగా 3 వాక్యాలలో ముగించండి.
              - లేని సమాచారాన్ని సృష్టించవద్దు.`
          : isHi
            ? `- उपयोगकर्ता को हिंदी में उत्तर दें।
              - LATEST_DATA में मौजूद विवरणों को ही पढ़ें। 2-3 महत्वपूर्ण विवरण और कीमतें स्पष्ट रूप से बताएं।
              - अधिकतम 3 वाक्यों में समाप्त करें।
              - अनुपलब्ध जानकारी का आविष्कार या कल्पना न करें।`
            : `- Speak normally to the user as a helpful virtual assistant.
              - The LATEST_DATA will contain exact records.
              - YOU MUST ONLY READ OUT exact items and prices. NO technical IDs.
              - CRITICAL ANTI-HALLUCINATION: NEVER invent or hallucinate data.`;
      } else if (intent.name === 'collect_feedback') {
        criticalInstructions = isTe
          ? `- అభిప్రాయం విజయవంతంగా సేవ్ చేయబడింది (TASK COMPLETED).
              - కేవలం "మీ అభిప్రాయానికి ధన్యవాదాలు! మళ్ళీ సేవించడానికి ఎదురుచూస్తున్నాము." అని చెప్పండి.
              - ఆ వెంటనే [HANG_UP] వాడండి.`
          : isHi ? criticalInstructionsHi
            : `- Feedback has been saved (TASK COMPLETED).
              - Simply say: "Thank you for your feedback! We look forward to serving you again."
              - Immediately follow with [HANG_UP].`;
      } else if (intent.name === 'hang_up') {
        criticalInstructions = isTe ? `- క్లుప్తంగా ముగించండి: "ధన్యవాదాలు, సెలవు."` : isHi ? criticalInstructionsHi : `- Just say: "Thank you, goodbye."`;
      } else if (['book_appointment', 'book_table', 'book_order'].includes(intent.name)) {
        criticalInstructions = isTe
          ? `- కేవలం ఒకే వాక్యం చెప్పండి: "మీ బుకింగ్ ఖరారైంది. నేను మీకు ఈరోజు ఇంకా ఏదైనా సహాయం చేయగలనా?"`
          : isHi ? criticalInstructionsHi
            : `- ULTRA-MINIMALIST: Just say "Your booking is confirmed. Is there anything else I can assist you with today?"`;
      }

      const criticalSystemAddon = isTe
        ? `గమనిక: సమయం గురించి ఎటువంటి విశ్లేషణ (comparison/logic) వద్దు. "సరిపోల్చి చూద్దాం" వంటి మాటలు వద్దు. నేరుగా సమాధానం చెప్పండి.`
        : isHi
          ? `महत्वपूर्ण: उपयोगकर्ता को अपनी आंतरिक तर्क या समय की तुलना कभी न समझाएं। "आइए तुलना करें" या "मिलान" जैसे शब्द न कहें। बस पुष्टि करें या सुझाव दें।`
          : `CRITICAL: NEVER explain your internal logic or time comparisons to the user. Do not say "let's compare" or "matching". Just confirm or suggest.`;

      const finalResponse = await fetchWithRetry(GROQ_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant',
          messages: [
            { role: 'system', content: `${systemMessage}\n\n${criticalSystemAddon}\n\nCRITICAL CONTEXT: ${criticalInstructions}` },
            ...messages.slice(-4), // Give a bit more context
            { role: 'assistant', content: assistantMessage },
            {
              role: 'user',
              content: `[SYSTEM ALERT: TASK OUTCOME]
              Result: ${(result && !result.error && (result.success || typeof result === 'string')) ? 'SUCCESS' : 'ERROR'}. 
              Data: ${typeof result === 'string' ? result : JSON.stringify(result)}.`
            }
          ],
          temperature: 0.1, // Slight temperature for natural variation
          max_tokens: 600
        })
      });

      const bypassRatingsAppends = ['query_entity_database', 'get_available_slots', 'collect_feedback', 'hang_up'];

      if (finalResponse && finalResponse.ok) {
        const finalData = await finalResponse.json();
        const confirmationText = finalData.choices[0]?.message?.content;
        let finalDisplay = cleanInternalCommands(confirmationText);

        if (!finalDisplay || finalDisplay.length < 2) {
          finalDisplay = cleanInternalCommands(assistantMessage);
        }

        return finalDisplay || fallbackMsg;
      }

      let baseFallback = cleanInternalCommands(assistantMessage);
      return baseFallback || fallbackMsg;
    }

    // Secondary fallback: if no intent bracket was generated:
    let baseResponse = cleanInternalCommands(assistantMessage);
    const finalResult = baseResponse || (typeof fallbackMsg === 'string' ? fallbackMsg : "I've noted that for you. Anything else?");
    return finalResult;
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
  const storedUser = JSON.parse(localStorage.getItem('user') || '{}');
  const userEmail = context?.userEmail || storedUser.email || '';
  const userName = context?.userName || storedUser.full_name || 'Guest';
  const systemDate = context?.systemDate || new Date();

  const cleanArg = (val, fallback = '', type = 'any') => {
    if (!val) return fallback;
    let cleaned = val.replace(/[\[\]{}"']/g, '').replace(/(?:dish|item|name|product|title|guest|guests):\s*/gi, '').trim();
    const low = cleaned.toLowerCase();

    // Detect dummy placeholders
    if (low.includes('available time') || low.includes('any time') || low.includes('select time') || low.includes('tbd')) return fallback;
    if (low === 'date' || low === 'time' || low === 'guests') return fallback;

    // Strict Date/Time validation if type is specified
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
      // Stable Asia/Kolkata formatting to YYYY-MM-DD
      const options = { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' };
      const formatter = new Intl.DateTimeFormat('en-CA', options);
      return formatter.format(date);
    } catch (e) {
      const d = new Date(date);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
  };

  const parseRelativeDate = (dateStr) => {
    if (!dateStr || dateStr.toUpperCase() === 'TBD') return 'TBD';

    // Normalize and detect "next" flag
    const raw = dateStr.toLowerCase().trim();
    const isNext = /next|अगला|తర్వాత/i.test(raw);
    let low = raw.replace(/next|अगला|తర్వాత/i, '').trim();

    // Asia/Kolkata Reference Time
    const now = new Date();
    const systemReference = systemDate ? new Date(systemDate) : now;

    // Relative Words
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

      // Calculate diff: if today or earlier in the week, move to next week
      if (diff <= 0) diff += 7;
      // If "next" is explicitly said, add another week
      if (isNext) diff += 7;

      const targetDate = new Date(systemReference);
      targetDate.setDate(systemReference.getDate() + diff);
      return formatDateLocal(targetDate);
    }

    // Numeric & Format Normalization
    if (/^\d{4}-\d{2}-\d{2}$/.test(low)) return low; // ISO pass-through

    // DD/MM/YYYY or DD-MM-YYYY
    const ddmmyyyy = low.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (ddmmyyyy) return `${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2, '0')}-${ddmmyyyy[1].padStart(2, '0')}`;

    // Month Name Parsing (e.g., "10 March")
    const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    const monthRegex = new RegExp(`(\\d{1,2})\\s+(${months.join('|')})|(${months.join('|')})\\s+(\\d{1,2})`, 'i');
    const monthMatch = low.match(monthRegex);
    if (monthMatch) {
      const day = monthMatch[1] || monthMatch[4];
      const monthName = monthMatch[2] || monthMatch[3];
      const monthIdx = months.indexOf(monthName.toLowerCase()) + 1;
      return `${systemReference.getFullYear()}-${String(monthIdx).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }

    return "TBD";
  };

  // Appointment Logic
  const isBookingText = msg.includes('BOOK') || msg.includes('APPOINTMENT') || msg.includes('DOCTOR') ||
    msg.includes('బుక్') || msg.includes('అపాయింట్మెంట్') ||
    msg.includes('बुक') || msg.includes('अपॉइंटमेंट');

  if (isBookingText && (msg.includes('APPOINTMENT') || msg.includes('DOCTOR') || msg.includes('MEETING') ||
    msg.includes('RESERVE') || msg.includes('రిజర్వ్') || msg.includes('రిజర్వేషన్') ||
    msg.includes('रिज़र्व') || msg.includes('आरक्षण'))) {
    let pName = 'General';
    let dDate = 'today';
    let tTime = 'TBD';

    // First, try the strict instructed format
    let match = message.match(/BOOK[_\s](?:APPOINTMENT|DOCTOR|MEETING|RECORD)\s*(?:for\s+)?(.*?)\s+on\s+(.*?)\s+at\s+([^\n.\r\]]*)/i);

    if (match) {
      pName = match[1];
      dDate = match[2];
      tTime = match[3];
    } else {
      // Robust Language-Agnostic Fallback
      const cmdMatch = message.match(/BOOK[_\s](?:APPOINTMENT|DOCTOR|MEETING|RECORD)\s+([^\]]+)/i);
      const detailsStr = cmdMatch ? cmdMatch[1] : message;

      // Split by common separators like "on", "at", or linguistic equivalents
      const parts = detailsStr.split(/\s+(?:on|at|కి|న|రోజు|पर|को|बजे)\s+/i);
      if (parts.length >= 3) {
        pName = parts[0];
        dDate = parts[1];
        tTime = parts[2];
      } else {
        const timeMatch = detailsStr.match(/at\s+([^\s\]]+)/i) ||
          detailsStr.match(/(\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm))/i) ||
          detailsStr.match(/(\d{1,2}\s*(?:గంటలకు|గంటలు|बजे))/);
        if (timeMatch) tTime = timeMatch[1].trim();

        const dateMatch = detailsStr.match(/on\s+([^\s\]]+)/i) ||
          detailsStr.match(/(today|tomorrow|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|ఈరోజు|రేపు|సోమవారం|మంగళవారం|బుధవారం|గురువారం|శుక్రవారం|శనివారం|ఆదివారం|आज|कल|सोमवार|मंगलवार|बुधवार|गुरुवार|शुक्रवार|शनिवार|रविवार)/i);
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

    return {
      name: 'book_appointment',
      args: {
        entityId, entityName, type, industry,
        personName: pName,
        date: dDate,
        time: tTime,
        userEmail, userName
      }
    };
  }

  // Table Logic
  if (msg.includes('BOOK') && (msg.includes('TABLE') || msg.includes('RESERVATION'))) {
    let gSize = '2';
    let bDate = 'today';
    let bTime = 'TBD';

    // First, try the strict instructed format
    let match = message.match(/BOOK[_\s](?:TABLE|RESERVATION)\s*(?:for\s+)?(.*?)\s+on\s+(.*?)\s+at\s+([^\n.\r\]]*)/i);

    if (match) {
      gSize = match[1];
      bDate = match[2];
      bTime = match[3];
    } else {
      // Robust Fallback
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
      args: {
        entityId, entityName, type: 'table', industry: 'Food & Beverage',
        personName: finalTitle,
        date: bDate,
        time: bTime,
        userEmail, userName,
        relatedId: 'TABLE_TBD'
      }
    };
  }

  // Order Logic
  if (msg.includes('BOOK_ORDER')) {
    const match = message.match(/BOOK_ORDER (?:for )?(.*?)(?:\s*[\r\n\]]|$)/i) || message.match(/BOOK_ORDER\s+([^\]]+)\]/i);
    let item = 'Item';
    let totalPrice = 0; // Initialize correctly
    if (match) {
      let fullText = match[1].replace(/[\[\]{}"']/g, '').replace(/(?:dish|item|name|product|title):\s*/gi, '').trim();
      // Improved price detection: handles symbols or numbers in parentheses
      const priceMatch = fullText.match(/[₹\$]\s?([\d,]+)/) || fullText.match(/\(([\d,]+)\)/);
      totalPrice = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : 999;
      item = fullText.split(/[₹\$\(\[]/)[0].trim();
    } else {
      // Just extract everything after BOOK_ORDER
      const fallbackMatch = message.match(/BOOK_ORDER\s+(.*)/i);
      if (fallbackMatch) {
        item = fallbackMatch[1].replace(/[\[\]]/g, '').trim().substring(0, 30);
      }
    }

    return {
      name: 'book_order',
      args: { companyId: entityId, entityName, item, totalPrice, customerName: userName, userEmail, industry }
    };
  }

  // --- Feedback Logic (Strictly locked to the Bracket) ---
  const isExplicitFeedback = msg.includes('[COLLECT_FEEDBACK') || msg.includes('COLLECT_FEEDBACK') ||
    msg.includes('రేటింగ్') || msg.includes('రేట్') || msg.includes('స్టార్') ||
    msg.includes('रेटिंग') || msg.includes('स्टार') || msg.includes('रेट');

  if (isExplicitFeedback) {
    // 1. Look for the rating within the bracket first (e.g., [COLLECT_FEEDBACK 5/5])
    let rating = 0;
    const bracketMatch = message.match(/\[COLLECT_FEEDBACK\s*([\d.]+)(\s*\/\s*5)?\s*\]/i);

    if (bracketMatch) {
      rating = parseFloat(bracketMatch[1]);
    } else {
      // 2. Fallback: Search the whole message ONLY if the command keyword exists
      const ratingMatch = message.match(/([\d.]+)\s?\/\s?5/) || message.match(/Rating:\s*([\d.]+)/i) || message.match(/([\d.]+)\s*star/i);
      rating = ratingMatch ? parseFloat(ratingMatch[1]) : 0;
    }

    // 3. Fallbacks for spelled numbers (English, Telugu, Hindi)
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

      // Clean up comment by removing internal markers
      const comment = message
        .replace(/\[COLLECT_FEEDBACK.*?\]/gi, '')
        .replace(/\[.*?\]/g, '')
        .split(/how would you rate|please rate|దయచేసి|రేటింగ్/i)[0]
        .replace(/Callix|Virtual Assistant|Receptionist/gi, '')
        .trim()
        .substring(0, 100) || 'Voice Feedback';

      return {
        name: 'collect_feedback',
        args: {
          companyId: entityId,
          companyName: entityName,
          rating,
          user_email: userEmail,
          user_name: userName,
          comment,
          industry
        }
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

  if (msg.includes('HANG_UP') || msg.includes('ధన్యవాదాలు') || msg.includes('సరే') || msg.includes('బై') || msg.includes('धन्यवाद') || msg.includes('बाय')) return { name: 'hang_up', args: {} };
  return null;
};

const executeAction = async (match) => {
  const { name, args } = match;
  if (name === 'invalid_feedback') {
    return { error: `User provided an invalid rating of ${args.rating} stars. Gently inform them that ratings must be exactly between 1 and 5 stars, and ask them for a valid rating.` };
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
