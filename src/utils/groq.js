import { tools } from './database.js';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_AUDIO_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

// Cleanup utility for internal markers
export const cleanInternalCommands = (text) => {
  if (!text) return '';
  return text
    .replace(/^(Callix|Agent|Assistant|System|User|Callix Virtual Assistant):\s*/i, '')
    // 0. Remove markdown symbols like asterisks used for bolding
    .replace(/\*/g, '')
    // 1. First, remove explicit internal bracketed thoughts/commands
    .replace(/\[(BOOK|COLLECT|GET|QUERY|HANG|TRACE|THOUGHT|ACTION|RESULT).*?\]/gim, '')
    // 2. Remove standalone command keywords if they leak out of brackets
    .replace(/\b(BOOK_APPOINTMENT|BOOK_TABLE|BOOK_ORDER|COLLECT_FEEDBACK|GET_AVAILABLE_SLOTS|QUERY_ENTITY_DATABASE|HANG_UP)\b/gi, '')
    // 3. Remove specific debug marker lines
    .replace(/(ACTION STATUS|ACTION COMPLETED|RESULT DATA|LATEST_TASK_OUTCOME|LATEST_DATA:|Action Type:).*?(\n|$)/gim, '')
    // 4. Remove standalone success/fail markers
    .replace(/^\s*(SUCCESS|FAILED|COMPLETED|ERROR)\.?\s*$/gim, '')
    // 5. Remove ONLY standalone "Thinking" lines (not mid-sentence words)
    .replace(/^\s*(Searching|Booking|Checking|Wait|One moment|Hold on|Querying|Processing|Fetching|Syncing|Verifying)(\.{1,3}|.*?request|.*?database|.*?slots)\s*$/gim, '')
    // Final cleanup of empty artifacts
    .replace(/\s+/g, ' ')
    .trim();
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
        if (rotateKey()) continue;
        const delay = 2000 * (attempt + 1);
        await new Promise(r => setTimeout(r, delay));
        attempt++;
        continue;
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

    const systemMessage = customSystemMessage || `You are Callix, the warm and professional Virtual Receptionist for ${companyContext?.name || 'our business'}.
    CURRENT DATE: ${dateStr} (${dayName}) | CURRENT TIME: ${timeStr}
    INDUSTRY: ${companyContext?.industry || 'Service'}
    USER NAME: ${userName}
    
    PERSONALITY & STYLE:
    - Polite, attentive, and helpful. Treat every user like a VIP guest.
    - Respond naturally. If the user says "Okay" or "Thank you", respond with a warm "You're very welcome!" or "It's my pleasure."
    
    CORE PROTOCOLS:
    1. GREETING: "Hello [Name], I'm Callix. I'm here to assist you with our services and bookings."
    2. ONGOING: DO NOT repeat your introduction or greeting (e.g., "Hello, I'm Callix") after the first message.
    3. DISCOVERY: Use [QUERY_ENTITY_DATABASE] to find info.
    4. DETAIL GATHERING: If the user wants to book, you MUST explicitly ask for the exact Date AND the Time if either is missing. DO NOT book anything until you have BOTH details. Never assume 'today'. If they only give the date, ask for the time. If they only give the time, ask for the date.
    5. CONFIRM & BOOK: When the user confirms an order or booking AND you have the details, you MUST use [BOOK_APPOINTMENT], [BOOK_ORDER], or [BOOK_TABLE]. Do not say it's confirmed without the bracket!
    6. NEXT STEPS: After confirming, ask: "Is there anything else I can help you with?".
    7. FEEDBACK: ONLY ask for a 1-5 star rating when the user is ready to end the conversation.

    TONE: Polite and ultra-brief. NO MARKDOWN (no asterisks).
    
    ACTION BRACKETS:
    - [QUERY_ENTITY_DATABASE for topic]
    - [GET_AVAILABLE_SLOTS for date]
    - [BOOK_APPOINTMENT for person on YYYY-MM-DD at time]
    - [BOOK_TABLE for guests on YYYY-MM-DD at time]
    - [BOOK_ORDER for item (price)]
    - [COLLECT_FEEDBACK rating/5] (ONLY use this when the user gives you a number. NEVER use this bracket when asking the question!)
    - [HANG_UP]
    
    CRITICAL: Never use an action bracket (e.g. [BOOK_...], [COLLECT_...]) when you are simply ASKING the user a question. Brackets are for CONFIRMING actions only. Ensure every sentence is grammatically complete. Do not say "Your We look forward..." or mixed sentences.`;

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
        actionSignature = `collect_feedback_session_locked`;
      } else {
        actionSignature = `${intent.name}_${JSON.stringify(intent.args)}`;
      }

      if (!sessionActionsMemory.has(sessionId)) {
        sessionActionsMemory.set(sessionId, new Set());
      }
      const memorySet = sessionActionsMemory.get(sessionId);

      const isTe = (companyContext?.currLangCode === 'te-IN' || companyContext?.selectedLanguage?.code === 'te-IN');
      const fallbackMsg = isTe
        ? "నేను ఆ వివరాలను నమోదు చేసుకున్నాను. నేను మీకు ఇంకా ఏదైనా సహాయం చేయగలనా?"
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
              3. Keep it conversational. If listing items, list 2-3 clearly with prices.`;

      // Use the isTe flag defined above


      if (['query_entity_database', 'get_available_slots'].includes(intent.name)) {
        criticalInstructions = isTe
          ? `- వినియోగదారుకు తెలుగులో సమాధానం ఇవ్వండి.
              - LATEST_DATAలో ఉన్న వంటకాలు లేదా సేవల వివరాలను మాత్రమే చదవండి.
              - ధరలను మరియు సమయాలను స్పష్టంగా చెప్పండి.
              - లేని సమాచారాన్ని సృష్టించవద్దు.`
          : `- Speak normally to the user as a helpful virtual assistant.
              - The LATEST_DATA will contain exact records in brackets like [MENU] or [CARDIOLOGY].
              - YOU MUST ONLY READ OUT exact items and prices. NO technical IDs or dates.
              - CRITICAL ANTI-HALLUCINATION: NEVER invent or hallucinate names, doctors, or items that are not explicitly provided in the LATEST_DATA.`;
      } else if (intent.name === 'collect_feedback') {
        criticalInstructions = isTe
          ? `- తెలుగులో మర్యాదగా ధన్యవాదాలు చెప్పండి: "మీ విలువైన అభిప్రాయానికి ధన్యవాదాలు! మిమ్మల్ని మళ్ళీ సేవించడానికి మేము ఎదురుచూస్తున్నాము." 
              - 1 sentence max.`
          : `- DONT SUMMARIZE THE DATA. NO TECHNICAL DETAILS.
              - Just say a warm, brief thank you: "Thank you for your feedback! We look forward to serving you again."
              - 1 sentence max.`;
      } else if (intent.name === 'hang_up') {
        criticalInstructions = isTe
          ? `- తెలుగులో మర్యాదగా సెలవు తీసుకోండి. 1 sentence max.`
          : `- Just say a brief professional goodbye. No technical summary.`;
      } else if (['book_appointment', 'book_table', 'book_order'].includes(intent.name)) {
        criticalInstructions = isTe
          ? `- తెలుగులో క్లుప్తంగా చెప్పండి: "మీ బుకింగ్ ఖరారైంది. నేను మీకు ఇంకా ఏదైనా సహాయం చేయగలనా?" 
              - బుకింగ్ వివరాలను మళ్ళీ చెప్పవద్దు. గరిష్టంగా 1-2 వాక్యాలు.`
          : `- ULTRA-MINIMALIST: Just say "Your booking is confirmed. Is there anything else I can assist you with today?"
              - DO NOT recite the date, time, or service name. 
              - Total length must be exactly 1-2 short sentences.`;
      }

      const finalResponse = await fetchWithRetry(GROQ_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant',
          messages: [
            ...messages.slice(-2), // Only give very recent history to prevent "double confirmation" of old tasks
            { role: 'assistant', content: assistantMessage },
            {
              role: 'user',
              content: `[SYSTEM ALERT: TASK EXECUTION LOG]
              LATEST_TASK_OUTCOME: ${(result && !result.error && (result.success || typeof result === 'string')) ? 'COMPLETED' : 'ERROR'}. 
              LATEST_DATA: ${typeof result === 'string' ? result : JSON.stringify(result)}. 
              
              CRITICAL INSTRUCTIONS:${criticalInstructions}`
            }
          ],
          temperature: 0.1, // Slight temperature for natural variation
          max_tokens: 150
        })
      });

      const bypassRatingsAppends = ['query_entity_database', 'get_available_slots', 'collect_feedback', 'hang_up'];

      if (finalResponse && finalResponse.ok) {
        const finalData = await finalResponse.json();
        const confirmationText = finalData.choices[0]?.message?.content;
        let finalDisplay = cleanInternalCommands(confirmationText) || cleanInternalCommands(assistantMessage);
        return finalDisplay;
      }

      let baseFallback = cleanInternalCommands(assistantMessage);
      return baseFallback;
    }

    // Secondary fallback: if no intent bracket was generated:
    let baseResponse = cleanInternalCommands(assistantMessage);
    return baseResponse;
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

  const parseRelativeDate = (dateStr) => {
    if (!dateStr || dateStr.toUpperCase() === 'TBD') return 'TBD';
    const low = dateStr.toLowerCase().trim();
    const today = new Date();

    // Simple today/tomorrow check
    if (low === 'today' || low === 'ఈరోజు') return today.toISOString().split('T')[0];
    if (low === 'tomorrow' || low === 'రేపు') {
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);
      return tomorrow.toISOString().split('T')[0];
    }

    // Days of the week map for English and Telugu
    const dayMap = {
      'sunday': 0, 'ఆదివారం': 0,
      'monday': 1, 'సోమవారం': 1,
      'tuesday': 2, 'మంగళవారం': 2,
      'wednesday': 3, 'బుధవారం': 3,
      'thursday': 4, 'గురువారం': 4,
      'friday': 5, 'శుక్రవారం': 5,
      'saturday': 6, 'శనివారం': 6
    };

    if (dayMap[low] !== undefined) {
      const targetDay = dayMap[low];
      const currentDay = today.getDay();
      let diff = targetDay - currentDay;
      if (diff <= 0) diff += 7; // If today or in the past, move to next week's occurrence
      const targetDate = new Date(today);
      targetDate.setDate(today.getDate() + diff);
      return targetDate.toISOString().split('T')[0];
    }

    return dateStr;
  };

  // Appointment Logic
  if (msg.includes('BOOK') && (msg.includes('APPOINTMENT') || msg.includes('DOCTOR') || msg.includes('MEETING'))) {
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
      // Robust Fallback
      const cmdMatch = message.match(/BOOK[_\s](?:APPOINTMENT|DOCTOR|MEETING|RECORD)\s+([^\]]+)/i);
      const detailsStr = cmdMatch ? cmdMatch[1] : message;

      const timeMatch = detailsStr.match(/at\s+([^\s\]]+)/i) || detailsStr.match(/(\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm))/i);
      if (timeMatch) tTime = timeMatch[1].trim();

      const dateMatch = detailsStr.match(/on\s+([^\s\]]+)/i) || detailsStr.match(/(today|tomorrow|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i);
      if (dateMatch) dDate = dateMatch[1].trim();

      const personMatch = detailsStr.match(/(?:for\s+)?(.*?)(?:\s+on|\s+at|$|\])/i);
      if (personMatch) pName = personMatch[1].trim();
    }

    pName = cleanArg(pName, 'General');
    dDate = parseRelativeDate(cleanArg(dDate, 'TBD', 'date'));
    tTime = cleanArg(tTime, 'TBD', 'time');

    const type = (industry.toLowerCase().includes('health') || industry.toLowerCase().includes('hosp')) ? 'doctor' : 'interview';

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
    if (match) {
      let fullText = match[1].replace(/[\[\]{}"']/g, '').replace(/(?:dish|item|name|product|title):\s*/gi, '').trim();
      const priceMatch = fullText.match(/[₹\$]\s?([\d,]+)/);
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

  // Rating Logic (Resilient to spaces and word variety)
  const isRatingWords = msg.includes('STAR') || msg.includes('RATING') || msg.includes('FEEDBACK') || msg.includes('SCORE');
  // Rating Logic (Specific to the command or explicit bracket)
  const isExplicitCommand = msg.includes('COLLECT_FEEDBACK');
  const hasBrackets = message.includes('[') && message.includes(']');

  if (isExplicitCommand || (hasBrackets && (msg.includes('STAR') || msg.includes('FEEDBACK')))) {
    // Look for any number (including decimals and values over 5)
    const ratingMatch = message.match(/([\d.]+)\s?\/\s?5/) || message.match(/Rating:\s*([\d.]+)/i) || message.match(/([\d.]+)\s*star/i) || message.match(/(?:^|\s|\b)([\d.]+)\b/);
    let rating = ratingMatch ? parseFloat(ratingMatch[1]) : 0;

    // Fallbacks for spelled numbers
    if (msg.includes('ONE')) rating = 1;
    else if (msg.includes('TWO')) rating = 2;
    else if (msg.includes('THREE')) rating = 3;
    else if (msg.includes('FOUR')) rating = 4;
    else if (msg.includes('FIVE')) rating = 5;
    else if (msg.includes('SIX')) rating = 6;
    else if (msg.includes('SEVEN')) rating = 7;
    else if (msg.includes('EIGHT')) rating = 8;
    else if (msg.includes('NINE')) rating = 9;
    else if (msg.includes('TEN')) rating = 10;

    // STICKER FEEDBACK RULE: Only trigger if there is a number or an explicit bracket command
    if (rating > 0) {
      if (rating > 5) return { name: 'invalid_feedback', args: { rating } };

      const comment = message
        .replace(/\[COLLECT_FEEDBACK.*?\]/gi, '')
        .replace(/\[.*?\]/g, '')
        .split(/how would you rate|please rate/i)[0]
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

  if (msg.includes('QUERY_ENTITY_DATABASE')) {
    const match = message.match(/QUERY_ENTITY_DATABASE (?:for )?(.*)/i);
    const query = match ? match[1].replace(/[\[\]]/g, '').trim() : message;
    return { name: 'query_entity_database', args: { entityId, query } };
  }

  if (msg.includes('HANG_UP')) return { name: 'hang_up', args: {} };
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
