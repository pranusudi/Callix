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

// Cache to prevent duplicate actions in the same session string
const sessionActionsMemory = new Map();

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
    2. **Booking Requirements**: Before using [BOOK_TABLE] or [BOOK_APPOINTMENT], you MUST have: Number of guests, Specific Date, Specific Time.
       If the user already provided this information, DO NOT ASK AGAIN. Simply use the bracket command immediately.
       If any are missing, ask politely: "Certainly! For what time and for how many guests should I reserve the table?"
    3. **Action Execution**: When the user confirms they want to book, place an order, or reserve, you MUST immediately output the EXACT bracket command (e.g. [BOOK_ORDER for {item}]). DO NOT confirm the action in words without including the bracket!
    4. **Confirmation Turn**: Make sure you tell the user their booking is confirmed, then ask specifically: "Please rate my assistance today on a scale of 1 to 5."
    5. **Collecting Rating**: Use [COLLECT_FEEDBACK rating/5] ONLY when the user explicitly provides a number from 1 to 5.
    
    ACTION BRACKETS:
    - [QUERY_ENTITY_DATABASE for topic]
    - [GET_AVAILABLE_SLOTS for date]
    - [BOOK_APPOINTMENT for person on date at time]
    - [BOOK_TABLE for guests on date at time]
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
    const assistantMessage = data.choices[0]?.message?.content || '';

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
      const actionSignature = `${intent.name}_${JSON.stringify(intent.args)}`;

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
      const finalResponse = await fetchWithRetry(GROQ_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant',
          messages: [
            ...messages.slice(-2), // Only give very recent history to prevent "double confirmation" of old tasks
            { role: 'assistant', content: assistantMessage },
            {
              role: 'system',
              content: `LATEST_TASK_OUTCOME: ${result.success ? 'COMPLETED' : 'ERROR'}. 
              LATEST_DATA: ${JSON.stringify(result)}. 
              
              CRITICAL INSTRUCTIONS:
              1. Provide a warm, professional receptionist confirmation.
              2. DO NOT repeat internal keywords or brackets.
              3. If outcome is COMPLETED, you MUST explicitly ask: "Please rate my assistance today from 1 to 5 stars."
              4. Max 20 words. Be concise but charming.`
            }
          ],
          temperature: 0.1, // Slight temperature for natural variation
          max_tokens: 150
        })
      });

      if (finalResponse && finalResponse.ok) {
        const finalData = await finalResponse.json();
        const confirmationText = finalData.choices[0]?.message?.content;
        return cleanInternalCommands(confirmationText) || cleanInternalCommands(assistantMessage);
      }
      return cleanInternalCommands(assistantMessage);
    }

    return cleanInternalCommands(assistantMessage);
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

  // Helper to clean extracted values from leaks/placeholders
  const cleanArg = (val, fallback = '') => {
    if (!val) return fallback;
    let cleaned = val.replace(/[\[\]{}]/g, '').trim();
    const low = cleaned.toLowerCase();
    // Detect dummy placeholders
    if (low.includes('available time') || low.includes('any time') || low.includes('select time') || low.includes('tbd')) return fallback;
    if (low === 'date' || low === 'time' || low === 'guests') return fallback;
    return cleaned || fallback;
  };

  // Appointment Logic (Flexible regex for spaces/underscores)
  if (msg.includes('BOOK') && (msg.includes('APPOINTMENT') || msg.includes('DOCTOR') || msg.includes('MEETING'))) {
    const match = message.match(/BOOK[_\s](?:APPOINTMENT|DOCTOR|MEETING|RECORD) (?:for )?(.*?) on (.*?) at ([^\n.\r\]]*)/i);
    if (match) {
      const type = (industry.toLowerCase().includes('health') || industry.toLowerCase().includes('hosp')) ? 'doctor' : 'interview';
      const pName = cleanArg(match[1], 'General');
      const dDate = cleanArg(match[2], 'today');
      const tTime = cleanArg(match[3], 'TBD');

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
  }

  // Table Logic
  if (msg.includes('BOOK') && (msg.includes('TABLE') || msg.includes('RESERVATION'))) {
    // Try to match standard format: BOOK_TABLE for [guests] on [date] at [time]
    let match = message.match(/BOOK[_\s](?:TABLE|RESERVATION) (?:for )?(.*?) on (.*?) at ([^\n.\r\]]*)/i);

    // Fallback: Try different word orders (at [time] on [date] or on [date] at [time])
    if (!match) {
      const timeMatch = message.match(/at\s+([^\n.\r\]]*)/i) || message.match(/(\d{1,2}(?::\d{2})?\s?(?:AM|PM|am|pm))/i);
      const dateMatch = message.match(/on\s+([^\n.\r\]]*)/i) || message.match(/(today|tomorrow|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i);
      const guestMatch = message.match(/for\s+(\d+|one|two|three|four|five|six)/i);

      if (timeMatch || dateMatch) {
        match = [null, guestMatch ? guestMatch[1] : '2', dateMatch ? (Array.isArray(dateMatch) ? dateMatch[1] : dateMatch) : 'today', timeMatch ? (Array.isArray(timeMatch) ? timeMatch[1] : timeMatch) : 'TBD'];
      }
    }

    if (match) {
      const gSize = cleanArg(match[1], '2');
      const bDate = cleanArg(match[2], 'today');
      const bTime = cleanArg(match[3], 'TBD');

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
  }

  // Order Logic
  if (msg.includes('BOOK_ORDER')) {
    const match = message.match(/BOOK_ORDER (?:for )?(.*?)(?:\s*[\r\n\]]|$)/i);
    if (match) {
      const fullText = match[1].replace(/[\[\]]/g, '').trim();
      const priceMatch = fullText.match(/[₹\$]\s?([\d,]+)/);
      const totalPrice = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : 0;
      const item = fullText.split(/[₹\$\(\[]/)[0].trim();
      return {
        name: 'book_order',
        args: { companyId: entityId, entityName, item, totalPrice: totalPrice || 999, customerName: userName, userEmail, industry }
      };
    }
  }

  // Rating Logic (Resilient to spaces and word variety)
  const isRatingWords = msg.includes('STAR') || msg.includes('RATING') || msg.includes('FEEDBACK') || msg.includes('SCORE');
  // Rating Logic (Specific to the command or explicit bracket)
  const isExplicitCommand = msg.includes('COLLECT_FEEDBACK');
  const hasBrackets = message.includes('[') && message.includes(']');

  if (isExplicitCommand || (hasBrackets && (msg.includes('STAR') || msg.includes('FEEDBACK')))) {
    // Look for any number 1-5 (including decimals like 4.5) even if not in the command name itself
    const ratingMatch = message.match(/([\d.]+)\s?\/\s?5/) || message.match(/Rating:\s*([\d.]+)/i) || message.match(/(?:^|\s|\b)([1-5](?:\.\d+)?)\b/);
    let rating = ratingMatch ? parseFloat(ratingMatch[1]) : 0;

    if (rating || msg.includes('STAR')) {
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
