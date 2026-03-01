import { tools } from './database.js';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_AUDIO_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

// Cleanup utility for internal markers
export const cleanInternalCommands = (text) => {
  if (!text) return '';
  return text
    .replace(/^(Callix|Agent|Assistant|System|User|Callix Virtual Assistant):\s*/i, '')
    // Replace all internal bracketed commands (space or underscore)
    .replace(/\[(BOOK|COLLECT|GET|QUERY|HANG|TRACE).*?\]/gim, '')
    // Remove standalone command keywords if they leak
    .replace(/\b(BOOK_APPOINTMENT|BOOK_TABLE|BOOK_ORDER|COLLECT_FEEDBACK|GET_AVAILABLE_SLOTS|QUERY_ENTITY_DATABASE|HANG_UP)\b/gi, '')
    // Remove debug markers that leak from system prompts
    .replace(/(ACTION STATUS|ACTION COMPLETED|RESULT DATA|DATA:|Action Type:).*?(\n|$)/gim, '')
    // Remove "Thinking" or "Action" crumbs
    .replace(/(Searching|Booking|Checking|Wait|One moment|Hold on|I'm checking|Let me see|Querying|Processing|Fetching).*?(slots|database|available|appointment|info|table|order|result|data)\.{0,3}/gi, '')
    // Final cleanup of punctuation and formatting
    .replace(/[\[\]]/g, '')
    .replace(/\.\.+/g, '.')
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

    const systemMessage = customSystemMessage || `You are Callix, the professional AI Voice Assistant for ${companyContext?.name || 'this establishment'}.
    CURRENT DATE: ${dateStr} (${dayName})
    CURRENT TIME: ${timeStr}
    INDUSTRY: ${companyContext?.industry || 'Service'}
    
    MISSION:
    Provide a premium, helpful, and efficient experience. Always follow the industry context: ${companyContext?.nlpContext || 'Professional service'}.

    CONVERSATION FLOW:
    1. **Greeting & Introduction**: ${isFirstTurn ? `Start with: "Hello ${userName}, I am Callix, your virtual assistant for ${companyContext?.name}. I can help you with ${companyContext?.industry.toLowerCase().includes('health') ? 'booking appointments and checking doctor availability' : companyContext?.industry.toLowerCase().includes('food') ? 'reserving tables and taking food orders' : 'browsing our services and making bookings'}." THEN, immediately address the user's message/request below.` : 'Continue the professional conversation.'}
    2. **Service Discovery**: If the user asks for something, first use [QUERY_ENTITY_DATABASE] to see what we offer/available times. Never guess.
    3. **Information Inquiry**: Before booking, ensure you have the required details (Date, Time, Item/Service Name).
    4. **Booking/Action**: Use the exact bracketed commands (e.g., [BOOK_APPOINTMENT ...]) to commit to the database.
    5. **Post-Action Feedback**: AFTER you receive a "SUCCESS" status for a booking/order, you MUST ask: "Since your order/booking is confirmed, how would you rate my service today on a scale of 1 to 5 stars?"
    6. **Collecting Feedback**: When the user provides a rating (e.g., "5"), you MUST immediately output the bracketed command: [COLLECT_FEEDBACK rating/5]. Do not skip this bracketed command.
    7. **Response Style**: If the user just says "Hey" or "Hi", reply warmly with your introduction and ask how you can help. Never say "I didn't catch that" for a greeting.

    CRITICAL PROTOCOLS:
    - **NAME USAGE**: ${isFirstTurn ? `Use ${userName} in the introduction.` : `Do not repeat the user's name frequently; stay concise.`}
    - **COMMANDS**: Bracketed commands are the ONLY way to update the database. 
    - **FEEDBACK**: If a user gives a rating (e.g., "5 stars"), immediately trigger [COLLECT_FEEDBACK rating/5].
    - **FIRST TURN**: Since you are listening first, the user might provide their name or a request immediately. Acknowledge what they said right after your introduction.
    
    CAPABILITIES (USE THESE EXACT BRACKETS):
    - [QUERY_ENTITY_DATABASE for query] (Find info)
    - [GET_AVAILABLE_SLOTS for date] (Check timings)
    - [BOOK_APPOINTMENT for person on date at time]
    - [BOOK_TABLE for guests on date at time]
    - [BOOK_ORDER for item (price)]
    - [COLLECT_FEEDBACK rating/5]
    - [HANG_UP]
    
    CRITICAL: Never use curly braces like {tomorrow} in the command. If you lack details, ASK. DO NOT finish a turn without an action bracket if a task is being decided.`;

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
      msgUpper.includes('BOOK') || msgUpper.includes('COLLECT') ||
      msgUpper.includes('QUERY') || msgUpper.includes('HANG') ||
      msgUpper.includes('STARS') || msgUpper.includes('APPOINTMENT');

    const intent = hasCommand ? detectIntent(assistantMessage, companyContext) : null;

    if (intent) {
      console.log('🤖 Detected Intent:', (intent.name || 'unknown'), (intent.args || {}));
      const result = await executeAction(intent);
      console.log('🛠 Action Result:', result);

      // Confirmation turn - The model needs to give the final natural response after the action
      const finalResponse = await fetchWithRetry(GROQ_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant',
          messages: [
            ...messages,
            { role: 'assistant', content: assistantMessage },
            {
              role: 'system',
              content: `ACTION COMPLETED: ${result.success ? 'SUCCESS' : 'FAILED'}. 
              DATA: ${JSON.stringify(result)}. 
              
              CRITICAL: 
              1. Produce a single, natural sentence confirming the result in ${companyContext?.currLangName || 'English'}.
              2. DO NOT repeat the words "ACTION STATUS" or "RESULT DATA".
              3. If a booking was successful, you MUST ask for a 1-5 star rating.
              4. Be extremely brief (max 15 words).`
            }
          ],
          temperature: 0.1, // Lower temperature for more consistent, less hallucinatory confirmation
          max_tokens: 150
        })
      });

      if (finalResponse && finalResponse.ok) {
        const finalData = await finalResponse.json();
        const confirmationText = finalData.choices[0]?.message?.content;
        return cleanInternalCommands(confirmationText);
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

    // Fallback: If only time/date provided, try to extract whatever is there
    if (!match) {
      const timeMatch = message.match(/at\s+([^\n.\r\]]*)/i);
      const dateMatch = message.match(/on\s+([^\n.\r\]]*)/i);
      const guestMatch = message.match(/BOOK[_\s]TABLE (?:for )?(\d+)/i) || message.match(/for (\d+)/i);

      if (timeMatch || dateMatch) {
        match = [null, guestMatch ? guestMatch[1] : '2', dateMatch ? dateMatch[1] : 'today', timeMatch ? timeMatch[1] : 'TBD'];
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
  if (msg.includes('COLLECT') || msg.includes('RATE') || isRatingWords) {
    // Look for any number 1-5 even if not in the command name itself
    const ratingMatch = message.match(/(\d)\s?\/\s?5/) || message.match(/Rating:\s*(\d)/i) || message.match(/\b([1-5])\b/);
    let rating = ratingMatch ? parseInt(ratingMatch[1]) : 0;

    if (!rating) {
      if (msg.includes('ONE') || msg.includes('1')) rating = 1;
      else if (msg.includes('TWO') || msg.includes('2')) rating = 2;
      else if (msg.includes('THREE') || msg.includes('3')) rating = 3;
      else if (msg.includes('FOUR') || msg.includes('4')) rating = 4;
      else if (msg.includes('FIVE') || msg.includes('5')) rating = 5;
    }

    if (rating || isRatingWords) {
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
