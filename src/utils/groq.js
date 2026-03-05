import { tools } from './database.js';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_AUDIO_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

// Cleanup utility for internal markers
export const cleanInternalCommands = (text) => {
  if (!text) return '';
  return text
    .replace(/^(Callix|Agent|Assistant|System|User|Callix Virtual Assistant):\s*/i, '')
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
    1. **Greet First**: Always start with a warm greeting if it's the beginning of the chat.
    2. **Booking Requirements**: Before using [BOOK_TABLE] or [BOOK_APPOINTMENT], you MUST know the exact Date and Time requested by the user.
       If the user omitted the date or time, DO NOT use the bracket. First, ask them: "For what date and time?"
       NEVER GUESS. NEVER ASSUME "today".
    3. **Action Execution**: When the user confirms they want to book, place an order, or reserve AND you have exact details, you MUST immediately output the EXACT bracket command (e.g. [BOOK_ORDER for {item}]). DO NOT confirm the action in words without including the bracket!
    4. **Confirmation Turn**: Make sure you tell the user their booking is confirmed, then ask specifically: "Please rate my assistance today on a scale of 1 to 5."
    5. **Collecting Rating**: Use [COLLECT_FEEDBACK rating/5] ONLY when the user explicitly provides a number from 1 to 5.
    
    ACTION BRACKETS:
    - [QUERY_ENTITY_DATABASE for topic]
    - [GET_AVAILABLE_SLOTS for date]
    - [BOOK_APPOINTMENT for person on YYYY-MM-DD at time]
    - [BOOK_TABLE for guests on YYYY-MM-DD at time]
    - [BOOK_ORDER for item (price)]
    - [COLLECT_FEEDBACK rating/5]
    - [HANG_UP]
    
    CRITICAL: Never leak internal commands or "Thinking..." lines. No "Your We look forward..."—ensure every sentence is grammatically complete.`;

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

    // Fallback for missing feedback command:
    if (!intent && history.length > 0) {
      const lastBotMsg = history[history.length - 1]?.content || '';
      if (/rate|star|feedback|assistance/i.test(lastBotMsg)) {
        const ratingMatch = prompt.match(/([\d.]+)\s?\/\s?5/) || prompt.match(/(?:^|\s|\b)([1-5](?:\.\d+)?)\b/);
        if (ratingMatch) {
          const ratingVal = parseFloat(ratingMatch[1]);
          if (ratingVal > 0 && ratingVal <= 5) {
            intent = {
              name: 'collect_feedback',
              args: {
                companyId: companyContext?._id || companyContext?.id || companyContext?.company_id || 'manual',
                companyName: companyContext?.name || 'General',
                rating: ratingVal,
                user_email: companyContext?.userEmail || '',
                user_name: companyContext?.userName || 'Guest',
                comment: prompt.replace(/User Message:/i, '').trim() || 'Voice Feedback',
                industry: companyContext?.industry || 'General'
              }
            };
            console.log('⚠️ Activated Feedback Fallback System!');

            // Force the AI to actually acknowledge the rating
            assistantMessage = "Thank you for your valuable feedback! Is there anything else I can help you with?";
          }
        }
      }
    }

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

      if (memorySet.has(actionSignature) && intent.name !== 'query_entity_database') {
        console.log('⚠️ Duplicate Intent Prevented in session:', intent.name);
        return cleanInternalCommands(assistantMessage) || "I've carefully noted those details for you. Is there anything else you need assistance with?";
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

      if (['collect_feedback', 'hang_up', 'query_entity_database', 'get_available_slots'].includes(intent.name)) {
        criticalInstructions = `
              - Speak normally to the user as a helpful virtual assistant.
              - The LATEST_DATA will contain exact records in brackets like [MENU] or [CARDIOLOGY].
              - YOU MUST ONLY READ OUT exact titles and prices from the data.
              - CRITICAL ANTI-HALLUCINATION: NEVER invent or hallucinate names, doctors, or items that are not explicitly provided in the LATEST_DATA. If there are no specific doctor names provided, just read out the service or consultation titles exactly as they represent.
              - Don't be too short if you need to explain things.`;
      } else if (['book_appointment', 'book_table', 'book_order'].includes(intent.name)) {
        criticalInstructions = `
              - EXTREMELY BRIEF CONFIRMATION: Just concisely confirm the exact date, time, and service/name based on LATEST_DATA.
              - Do NOT read out all the extra hospital/business descriptors continuously.
              - Keep it to 2 short sentences max.
              - Provide a warm, professional confirmation.`;
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
        if (result.success && !bypassRatingsAppends.includes(intent.name) && !/rate|star|feedback|1 to 5/i.test(finalDisplay)) {
          finalDisplay += " Please rate my assistance today from 1 to 5 stars.";
        }
        return finalDisplay;
      }

      let baseFallback = cleanInternalCommands(assistantMessage);
      if (result.success && !bypassRatingsAppends.includes(intent.name) && !/rate|star|feedback|1 to 5/i.test(baseFallback)) {
        baseFallback += " Please rate my assistance today from 1 to 5 stars.";
      }
      return baseFallback;
    }

    // Secondary fallback: if no intent bracket was generated, but the AI is claiming confirmation:
    let baseResponse = cleanInternalCommands(assistantMessage);
    if (/(confirm|booked|reserved|successfully|scheduled)/i.test(baseResponse) && !/rate|star|feedback|1 to 5/i.test(baseResponse)) {
      // Only append if it's genuinely a booking confirmation
      if (history.length > 2) {
        baseResponse += " Please rate my assistance from 1 to 5 stars.";
      }
    }
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

  const cleanArg = (val, fallback = '') => {
    if (!val) return fallback;
    let cleaned = val.replace(/[\[\]{}"']/g, '').replace(/(?:dish|item|name|product|title|guest|guests):\s*/gi, '').trim();
    const low = cleaned.toLowerCase();
    // Detect dummy placeholders
    if (low.includes('available time') || low.includes('any time') || low.includes('select time') || low.includes('tbd')) return fallback;
    if (low === 'date' || low === 'time' || low === 'guests') return fallback;
    return cleaned || fallback;
  };

  const parseRelativeDate = (dateStr) => {
    if (!dateStr || dateStr.toUpperCase() === 'TBD') return 'TBD';
    const low = dateStr.toLowerCase().trim();
    const today = new Date();
    if (low === 'today') {
      return today.toISOString().split('T')[0];
    }
    if (low === 'tomorrow') {
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return tomorrow.toISOString().split('T')[0];
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
    dDate = parseRelativeDate(cleanArg(dDate, 'TBD'));
    tTime = cleanArg(tTime, 'TBD');

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
    bDate = parseRelativeDate(cleanArg(bDate, 'TBD'));
    bTime = cleanArg(bTime, 'TBD');

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

    if (rating || msg.includes('STAR')) {
      if (rating > 5 || rating < 1) {
        return { name: 'invalid_feedback', args: { rating } };
      }

      // Clean comment: remove the command block and common leftovers
      const comment = message
        .replace(/\[COLLECT_FEEDBACK.*?\]/gi, '')
        .replace(/\[.*?\]/g, '')
        .split('How would you rate')[0]
        .trim()
        .substring(0, 100) || 'Voice Feedback';

      return {
        name: 'collect_feedback',
        args: {
          companyId: entityId,
          companyName: entityName,
          rating: rating || 5, // Default to 5 if keywords present but no number found
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
