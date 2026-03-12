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

// Cleanup utility — only strips internal system markers, never user-visible text
export const cleanInternalCommands = (text) => {
  if (!text) return '';

  let cleaned = text;

  // Strip system result blocks injected by the pipeline
  cleaned = cleaned.replace(/\[SYSTEM ALERT[\s\S]*?\]/gi, '');
  cleaned = cleaned.replace(/SYSTEM ALERT:.*?(?:\n|$)/gi, '');
  cleaned = cleaned.replace(/LATEST_TASK_OUTCOME:.*?(?:\n|$)/gi, '');
  cleaned = cleaned.replace(/LATEST_DATA:.*?(?:\n|$)/gi, '');
  cleaned = cleaned.replace(/TASK_OUTCOME:.*?(?:\n|$)/gi, '');
  cleaned = cleaned.replace(/INTERNAL_STATE:.*?(?:\n|$)/gi, '');
  cleaned = cleaned.replace(/CRITICAL INSTRUCTIONS:.*?(?:\n|$)/gi, '');
  cleaned = cleaned.replace(/CRITICAL CONTEXT:.*?(?:\n|$)/gi, '');
  cleaned = cleaned.replace(/ACTION RESULT:.*?(?:\n|$)/gi, '');
  cleaned = cleaned.replace(/Booking Result:.*?(?:\n|$)/gi, '');
  cleaned = cleaned.replace(/Feedback Result:.*?(?:\n|$)/gi, '');
  cleaned = cleaned.replace(/Result: SUCCESS.*?(?:\n|$)/gi, '');
  cleaned = cleaned.replace(/Result: ERROR.*?(?:\n|$)/gi, '');
  cleaned = cleaned.replace(/^Data:\s*/gim, '');

  // Strip JSON-like data blobs that leaked through
  cleaned = cleaned.replace(/\{[\s\S]*?"(?:id|success|error)"[\s\S]*?\}/g, '');
  cleaned = cleaned.replace(/Data:\s*\[[\s\S]*?\]/gi, '');

  // Strip action brackets — these are internal commands, not for display
  cleaned = cleaned.replace(/\[(BOOK_APPOINTMENT|BOOK_TABLE|BOOK_ORDER|COLLECT_FEEDBACK|QUERY_ENTITY_DATABASE|GET_AVAILABLE_SLOTS|HANG_UP)[^\]]*\]/gi, '');

  // Strip markdown artifacts
  cleaned = cleaned.replace(/\*/g, '');

  // Normalise whitespace
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  return cleaned;
};

// API Key Management
const API_KEYS = (typeof import.meta !== 'undefined' && import.meta.env
  ? Object.keys(import.meta.env)
    .filter(key => key.includes('GROQ_API_KEY'))
    .sort()
    .map(key => import.meta.env[key])
    .filter(Boolean)
  : []);

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
  console.warn(`🔄 Rotating to API Key #${currentKeyIndex + 1}...`);
  return true;
};

const fetchWithRetry = async (url, options, maxRetries = 8) => {
  // Track which key index we started on so we know when we've cycled all keys
  const startKeyIndex = currentKeyIndex;
  let totalAttempts = 0;
  const totalKeys = API_KEYS.length || 1;
  // Allow up to (keys × 2) + extra backoff attempts
  const hardLimit = Math.max(maxRetries, totalKeys * 2 + 3);

  while (totalAttempts < hardLimit) {
    const currentKey = getActiveKey();
    try {
      const currentOptions = {
        ...options,
        headers: { ...options.headers, 'Authorization': `Bearer ${currentKey}` }
      };
      const response = await fetch(url, currentOptions);

      if (response.status === 429) {
        totalAttempts++;
        const rotated = rotateKey();
        if (rotated) {
          // Switched to a fresh key — retry immediately, no wait
          console.warn(`🔄 429 on key #${currentKeyIndex}. Trying key #${(currentKeyIndex) % totalKeys + 1}...`);
          continue;
        }
        // All keys exhausted — wait with exponential backoff then retry from first key
        const backoffSec = Math.min(30, 2 ** Math.floor(totalAttempts / totalKeys));
        console.warn(`⏳ All keys rate-limited. Waiting ${backoffSec}s before retry...`);
        await new Promise(r => setTimeout(r, backoffSec * 1000));
        // Reset to first key and try again
        currentKeyIndex = 0;
        continue;
      }

      // Any non-429 4xx is a real error — return immediately
      if (!response.ok && response.status >= 400 && response.status < 500) return response;
      // Success
      return response;
    } catch (err) {
      totalAttempts++;
      if (totalAttempts >= hardLimit) throw err;
      await new Promise(r => setTimeout(r, 1000 * Math.min(totalAttempts, 5)));
    }
  }
  throw new Error('Max retry attempts exceeded across all API keys');
};

// Per-session dedup memory (survives Vite HMR)
const sessionActionsMemory = (typeof window !== 'undefined' && window.__sessionActionsMemory)
  ? window.__sessionActionsMemory
  : new Map();
if (typeof window !== 'undefined') window.__sessionActionsMemory = sessionActionsMemory;

// ─── Per-session feedback lock (one feedback save per session) ───────────────
// Map<sessionId, true> — each call gets a unique sessionId, completely independent
const sessionFeedbackDone = (typeof window !== 'undefined' && window.__sessionFeedbackDone)
  ? window.__sessionFeedbackDone
  : new Map();
if (typeof window !== 'undefined') window.__sessionFeedbackDone = sessionFeedbackDone;

// Helper: check and mark feedback as done atomically
const markFeedbackDone = (sid) => {
  if (sessionFeedbackDone.get(sid)) return false; // already done
  sessionFeedbackDone.set(sid, true);
  return true; // we have the lock
};
const isFeedbackDone = (sid) => sessionFeedbackDone.get(sid) === true;

// ─── Session cleanup — call this when a call ends ────────────────────────────
export const clearSessionMemory = (sessionId) => {
  if (!sessionId) return;
  sessionFeedbackDone.delete(sessionId);
  sessionActionsMemory.delete(sessionId);
  console.log(`🧹 Cleared session memory for: ${sessionId}`);
};

// ─── Extract a 1-5 star rating from raw user text ────────────────────────────
const extractRatingFromUserText = (text) => {
  if (!text) return 0;
  const t = text.trim();
  const up = t.toUpperCase();

  // Skip if this looks like the agent's "please rate 1 to 5" prompt echoed back
  if (/1\s*(?:to|\-|నుండి|से)\s*5/i.test(t)) return 0;

  // Explicit "X/5"
  const slashM = t.match(/\b([1-5])\s*\/\s*5\b/);
  if (slashM) return parseInt(slashM[1]);

  // Standalone digit 1-5 (whole message is just a number or "4 stars" etc.)
  const numM = t.match(/^\s*([1-5])\s*(?:stars?|స్టార్లు|స్టార్|स्टार)?\s*$/i);
  if (numM) return parseInt(numM[1]);

  // Digit followed by /5 or "out of 5"
  const outOfM = t.match(/\b([1-5])\s*(?:\/\s*5|out\s*of\s*5)/i);
  if (outOfM) return parseInt(outOfM[1]);

  // Spelled-out words
  const w = up;
  if (/\bONE\b|ఒకటి|\bEK\b|एक/.test(w)) return 1;
  if (/\bTWO\b|రెండు|दो/.test(w)) return 2;
  if (/\bTHREE\b|మూడు|तीन/.test(w)) return 3;
  if (/\bFOUR\b|నాలుగు|चार/.test(w)) return 4;
  if (/\bFIVE\b|ఐదు|पाँच|पांच/.test(w)) return 5;

  return 0;
};

export const chatWithGroq = async (prompt, history = [], companyContext = null, customSystemMessage = null) => {
  if (API_KEYS.length === 0 && !primaryApiKey) throw new Error('No Groq API keys configured.');

  try {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const dayName = now.toLocaleDateString('en-IN', { weekday: 'long' });
    const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

    const storedUser = safeStorage.parse('user', {});
    const userName = companyContext?.userName || storedUser.full_name || storedUser.user_metadata?.full_name || 'there';

    const isTe = (companyContext?.currLangCode === 'te-IN');
    const isHi = (companyContext?.currLangCode === 'hi-IN');
    const sessionId = companyContext?.sessionId || 'default';

    // ── EARLY INTERCEPT: If user is replying with a rating number, handle it
    // directly without calling the LLM at all. This is the most reliable path.
    // We only do this if:
    //   (a) feedback hasn't already been saved this session
    //   (b) the last agent message was asking for a rating
    //   (c) the user message resolves to a 1-5 number
    if (!isFeedbackDone(sessionId)) {
      const lastAgentMsg = [...history].reverse().find(m => m.role === 'assistant');
      const lastAgentText = (lastAgentMsg?.text || lastAgentMsg?.content || '').toLowerCase();
      const wasAskingForRating = /rate|rating|stars?|1.*5|రేటింగ్|స్టార్|रेटिंग|स्टार/i.test(lastAgentText);

      if (wasAskingForRating) {
        const userPromptClean = prompt.replace(/^User Message:\s*/i, '').trim();
        const rating = extractRatingFromUserText(userPromptClean);

        if (rating >= 1 && rating <= 5) {
          console.log(`⭐ Early intercept: rating=${rating} from user prompt`);

          const entityId = companyContext?._id || companyContext?.id || companyContext?.company_id || 'manual';
          const entityName = companyContext?.name || 'General';
          const userEmail = companyContext?.userEmail || storedUser.email || '';
          const industry = companyContext?.industry || 'Other';

          // Save feedback directly
          const feedbackArgs = {
            companyId: entityId,
            companyName: entityName,
            rating,
            user_email: userEmail,
            user_name: userName,
            comment: 'Voice Feedback',
            industry
          };

          try {
            if (markFeedbackDone(sessionId)) {  // atomic lock — only one path saves
              const result = await tools.collect_feedback(feedbackArgs);
              console.log('✅ Feedback saved via early intercept:', result);
              if (result?.error) {
                // DB write failed — release the lock so it can retry
                sessionFeedbackDone.delete(sessionId);
              }
            } else {
              console.log('⚠️ Feedback already in progress for this session, skipping.');
            }
          } catch (e) {
            console.error('Feedback save failed:', e);
            sessionFeedbackDone.delete(sessionId); // release lock on exception
          }

          // Return hardcoded thank-you — never touches LLM
          const thankMsg = isTe
            ? 'అభిప్రాయం తెలిపినందుకు ధన్యవాదాలు.'
            : isHi
              ? 'फीडबैक के लिए धन्यवाद।'
              : 'Thank you for your feedback.';
          return `${thankMsg} [HANG_UP]`;
        }
      }
    }

    // ── EARLY INTERCEPT: Booking — parse date+time from user message directly ──
    // When previous agent turn was asking for date/time, extract from user message
    // and save to DB immediately. This survives 429 errors and AI bracket omissions.
    {
      const lastAgentMsg = [...history].reverse().find(m => m.role === 'assistant');
      const lastAgentText = (lastAgentMsg?.text || lastAgentMsg?.content || '').toLowerCase();
      const wasAskingForDateTime =
        /date.*time|time.*date|తేదీ.*సమయం|సమయం.*తేదీ|तारीख.*समय|समय.*तारीख|dine.*date|reserve|reservation|appointment|book.*table|table.*book/i
          .test(lastAgentText);

      if (wasAskingForDateTime) {
        const userPromptClean = prompt.replace(/^User Message:\s*/i, '').trim();
        const entityId = companyContext?._id || companyContext?.id || companyContext?.company_id || 'manual';
        const entityName = companyContext?.name || 'General';
        const userEmail = companyContext?.userEmail || storedUser.email || '';
        const industry = companyContext?.industry || 'Other';

        // ── Date parsing (relative + absolute) ───────────────────────────────
        const now2 = companyContext?.systemDate ? new Date(companyContext.systemDate) : new Date();
        const formatISO2 = (d) => {
          try {
            return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
          } catch { return d.toISOString().split('T')[0]; }
        };

        const parseDate2 = (txt) => {
          const t = txt.toLowerCase();
          if (/\btoday\b|ఈరోజు|आज/.test(t)) return formatISO2(now2);
          if (/\btomorrow\b|రేపు|कल/.test(t)) { const d = new Date(now2); d.setDate(d.getDate() + 1); return formatISO2(d); }
          const dayNames = { sunday: 0, ఆదివారం: 0, रविवार: 0, monday: 1, సోమవారం: 1, सोमवार: 1, tuesday: 2, మంగళవారం: 2, मंगलवार: 2, wednesday: 3, బుధవారం: 3, बुधवार: 3, thursday: 4, గురువారం: 4, गुरुवार: 4, friday: 5, శుక్రవారం: 5, शुक्रवार: 5, saturday: 6, శనివారం: 6, शनिवार: 6 };
          for (const [name, idx] of Object.entries(dayNames)) {
            if (t.includes(name)) {
              const ref = new Date(now2);
              let diff = idx - ref.getDay();
              if (diff <= 0) diff += 7;
              ref.setDate(ref.getDate() + diff);
              return formatISO2(ref);
            }
          }
          const iso = t.match(/\d{4}-\d{2}-\d{2}/);
          if (iso) return iso[0];
          const dmy = t.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
          if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
          return null;
        };

        const parseTime2 = (txt) => {
          const t = txt.toLowerCase();
          // "10 గంటలకు" / "10 baje" / "10 am" / "10:30" / "ఉదయం 10" etc.
          const teluguTime = t.match(/(?:ఉదయం|మధ్యాహ్నం|సాయంత్రం|రాత్రి|सुबह|दोपहर|शाम|रात)?\s*(\d{1,2})(?::(\d{2}))?\s*(?:గంటలకు|గంటలు|గంట|बजे)?/);
          const stdTime = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m|p\.m)/i);
          const colonTime = t.match(/(\d{1,2}):(\d{2})/);

          if (stdTime) {
            let h = parseInt(stdTime[1]), m = parseInt(stdTime[2] || '0');
            const period = (stdTime[3] || '').toLowerCase();
            if (period.startsWith('p') && h !== 12) h += 12;
            if (period.startsWith('a') && h === 12) h = 0;
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
          }
          if (colonTime) return `${colonTime[1].padStart(2, '0')}:${colonTime[2]}`;
          if (teluguTime) {
            let h = parseInt(teluguTime[1]), m = parseInt(teluguTime[2] || '0');
            // Telugu PM: మధ్యాహ్నం/సాయంత్రం/రాత్రి | Hindi PM: दोपहर/शाम/रात
            if (/మధ్యాహ్నం|సాయంత్రం|రాత్రి|दोपहर|शाम|रात/.test(t) && h < 12) h += 12;
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
          }
          return null;
        };

        const parseGuests2 = (txt) => {
          const t = txt.toLowerCase();
          const wordMap = {
            one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
            ఒకరు: 1, ఇద్దరు: 2, ముగ్గురు: 3, నలుగురు: 4, అయిదుగురు: 5,
            एक: 1, दो: 2, तीन: 3, चार: 4, पाँच: 5, पांच: 5
          };
          for (const [w, n] of Object.entries(wordMap)) { if (t.includes(w)) return String(n); }
          const numM = t.match(/(\d+)\s*(?:guests?|people|persons?|మంది|నలుగురు|వ్యక్తులు|लोग)/i);
          if (numM) return numM[1];
          const bareNum = t.match(/\b(\d+)\b/);
          if (bareNum) return bareNum[1];
          return '2';
        };

        const parsedDate = parseDate2(userPromptClean);
        const parsedTime = parseTime2(userPromptClean);
        const parsedGuests = parseGuests2(userPromptClean);

        // Scan full conversation history to determine booking type and what was being booked
        const fullConvoText = history.map(m => m.text || m.content || '').join(' ').toLowerCase();
        const allContext = fullConvoText + ' ' + lastAgentText + ' ' + userPromptClean;

        // Use industry as the strongest signal — restaurant/food = always table booking
        const industryLower = (industry || '').toLowerCase();
        const isRestaurantIndustry = /food|beverage|restaur|dining|cafe|bistro/i.test(industryLower);
        const isHealthIndustry = /health|hospital|clinic|medical|pharmac/i.test(industryLower);

        // Text signals (word boundary-free for multilingual reliability)
        const hasTableSignal = /table|reservation|reserve|dining|టేబుల్|రెస్టారెంట్|मेज|रेस्टोरेंट/i.test(allContext);
        const hasDoctorSignal = /doctor|dr\.?|appointment|clinic|hospital|అపాయింట్మెంట్|డాక్టర్|डॉक्टर|अपॉइंटमेंट/i.test(allContext);

        // Industry overrides text signal — a restaurant booking is always a table booking
        const isTableBooking = isRestaurantIndustry || hasTableSignal;
        const isDoctorBooking = !isTableBooking && (isHealthIndustry || hasDoctorSignal);

        // Find the earliest user message that expressed the booking intent (not just date/time)
        const intentMsg = [...history]
          .filter(m => m.role === 'user')
          .map(m => m.text || m.content || '')
          .find(t => /book|appointment|table|reserve|doctor|meeting|schedule/i.test(t))
          || '';

        if (parsedDate && parsedTime) {
          console.log(`📌 Booking intercept: type=${isTableBooking ? 'table' : isDoctorBooking ? 'doctor' : 'appointment'}, Date=${parsedDate}, Time=${parsedTime}, Guests=${parsedGuests}`);

          let bookingResult;
          try {
            if (isTableBooking) {
              bookingResult = await tools.book_appointment({
                entityId, entityName,
                type: 'table',
                industry: industry || 'Food & Beverage',
                personName: `Table for ${parsedGuests} — ${userName}`,
                date: parsedDate,
                time: parsedTime,
                userEmail,
                userName
              });
            } else {
              // For non-table bookings, build a clean label from the intent message
              // Strip filler words to get the core subject (e.g. "Doctor Rajesh Kumar")
              const cleanIntent = intentMsg
                ? intentMsg
                  .replace(/^(i want to|i need to|please|can you|book|schedule|appointment with|book appointment with)\s*/gi, '')
                  .trim()
                  .substring(0, 60)
                : (isDoctorBooking ? `Doctor Appointment — ${userName}` : `Meeting — ${userName}`);
              bookingResult = await tools.book_appointment({
                entityId, entityName,
                type: isDoctorBooking ? 'doctor' : 'interview',
                industry,
                personName: cleanIntent || `Appointment — ${userName}`,
                date: parsedDate,
                time: parsedTime,
                userEmail,
                userName
              });
            }

            console.log('✅ Booking saved via intercept:', bookingResult);

            if (!bookingResult?.error) {
              // Register in session memory to prevent duplicate on AI path
              if (!sessionActionsMemory.has(sessionId)) sessionActionsMemory.set(sessionId, new Set());
              const sig = `book_appointment_intercept_${parsedDate}_${parsedTime}_${entityId}`;
              sessionActionsMemory.get(sessionId).add(sig);

              return isTe
                ? 'మీ బుకింగ్ నిర్ధారించబడింది. నేను మీకు మరింకేమైనా సహాయం చేయగలనా?'
                : isHi
                  ? 'आपकी बुकिंग कन्फर्म हो गई है। क्या मैं आपकी और कोई मदद कर सकता हूँ?'
                  : 'Your booking is confirmed. Is there anything else I can help you with?';
            }
          } catch (e) {
            console.error('Booking intercept failed:', e);
            // Fall through to normal LLM path
          }
        }
      }
    }

    // Determine if this is the very first agent turn (no agent messages in history yet)
    const isFirstTurn = !history.some(m => m.role === 'assistant');

    const systemMessage = customSystemMessage || buildDefaultSystemMessage({
      companyContext, userName, dateStr, dayName, timeStr, isTe, isHi, isFirstTurn
    });

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
        temperature: 0.2,
        max_tokens: 600
      })
    });

    if (!response.ok) throw new Error(`Groq Error: ${response.status}`);

    const data = await response.json();
    let assistantMessage = data.choices[0]?.message?.content || '';
    console.log('🤖 AI Raw Response:', assistantMessage);

    const msgUpper = assistantMessage.toUpperCase();

    // If AI included [COLLECT_FEEDBACK] but forgot [HANG_UP], add it
    if (!msgUpper.includes('HANG_UP') && msgUpper.includes('COLLECT_FEEDBACK')) {
      assistantMessage += ' [HANG_UP]';
    }

    const hasActionBracket = /\[(BOOK_|COLLECT_FEEDBACK|QUERY_|GET_AVAILABLE|HANG_UP)/i.test(assistantMessage);
    const intent = hasActionBracket ? detectIntent(assistantMessage, companyContext) : null;

    if (intent) {

      // Build dedup signature
      let actionSignature;
      if (intent.name === 'collect_feedback') {
        actionSignature = `feedback_${intent.args.companyId}_${sessionId}_${intent.args.rating}`;
        // Hard session lock — only one path saves per session
        if (isFeedbackDone(sessionId)) {
          console.log('⚠️ Feedback already saved for this session, skipping DB write.');
          const isTeLock = (companyContext?.currLangCode === 'te-IN');
          const isHiLock = (companyContext?.currLangCode === 'hi-IN');
          const thankLock = isTeLock
            ? 'అభిప్రాయం తెలిపినందుకు ధన్యవాదాలు.'
            : isHiLock ? 'फीडबैक के लिए धन्यवाद।'
              : 'Thank you for your feedback.';
          return `${thankLock} [HANG_UP]`;
        }
        if (!markFeedbackDone(sessionId)) {
          console.log('⚠️ Feedback lock already taken, skipping.');
          return assistantMessage;
        }
      } else if (intent.name === 'hang_up') {
        // Always allow hang_up through — it's just a signal
        const result = await executeAction(intent);
        return assistantMessage;
      } else {
        actionSignature = `${intent.name}_${JSON.stringify(intent.args)}`;
      }

      if (!sessionActionsMemory.has(sessionId)) sessionActionsMemory.set(sessionId, new Set());
      const memorySet = sessionActionsMemory.get(sessionId);

      // Check if booking interceptor already handled this (same date+time slot)
      if (['book_appointment', 'book_table', 'book_order'].includes(intent.name)) {
        const dateArg = intent.args?.date || '';
        const timeArg = intent.args?.time || '';
        const interceptSig = `book_appointment_intercept_${dateArg}_${timeArg}_${intent.args?.entityId || ''}`;
        if (memorySet.has(interceptSig)) {
          console.log('⚠️ Booking already saved by interceptor, skipping duplicate DB write.');
          const isTeLang2 = (companyContext?.currLangCode === 'te-IN');
          const isHiLang2 = (companyContext?.currLangCode === 'hi-IN');
          return isTeLang2
            ? 'మీ బుకింగ్ నిర్ధారించబడింది. నేను మీకు మరింకేమైనా సహాయం చేయగలనా?'
            : isHiLang2
              ? 'आपकी बुकिंग कन्फर्म हो गई है। क्या मैं आपकी और कोई मदद कर सकता हूँ?'
              : 'Your booking is confirmed. Is there anything else I can help you with?';
        }
      }

      if (memorySet.has(actionSignature) && intent.name !== 'query_entity_database') {
        console.log('⚠️ Duplicate intent prevented:', intent.name);
        return assistantMessage;
      }
      memorySet.add(actionSignature);

      console.log('🎯 Detected Intent:', intent.name, '| Args:', intent.args);
      const result = await executeAction(intent);
      console.log('✅ Action Result:', result);

      // Mark feedback as done (lock was already taken above in the check block)
      if (intent.name === 'collect_feedback' && result?.error) {
        // DB write failed — release the lock so it can be retried
        sessionFeedbackDone.delete(sessionId);
      }

      // ── Guaranteed hardcoded responses for critical actions ──────────────
      // These never go through the LLM again — no risk of rephrasing or omission.
      const isTeLang = (companyContext?.currLangCode === 'te-IN');
      const isHiLang = (companyContext?.currLangCode === 'hi-IN');

      // BOOKING CONFIRMED — always return this exact string, never LLM-generated
      if (['book_appointment', 'book_table', 'book_order'].includes(intent.name)) {
        if (result?.error) {
          // Booking failed — hardcoded error message
          return isTeLang
            ? 'బుకింగ్ లో చిన్న సమస్య వచ్చింది. దయచేసి మళ్ళీ ప్రయత్నించండి.'
            : isHiLang
              ? 'बुकिंग में कोई समस्या आई। कृपया दोबारा प्रयास करें।'
              : 'There was an issue with your booking. Please try again.';
        }
        // SUCCESS — hardcoded confirmation + follow-up question
        return isTeLang
          ? 'మీ బుకింగ్ నిర్ధారించబడింది. నేను మీకు మరింకేమైనా సహాయం చేయగలనా?'
          : isHiLang
            ? 'आपकी बुकिंग कन्फर्म हो गई है। क्या मैं आपकी और कोई मदद कर सकता हूँ?'
            : 'Your booking is confirmed. Is there anything else I can help you with?';
      }

      // FEEDBACK SAVED — hardcoded thank-you + hang up signal
      if (intent.name === 'collect_feedback') {
        const thankMsg = isTeLang
          ? 'అభిప్రాయం తెలిపినందుకు ధన్యవాదాలు.'
          : isHiLang
            ? 'फीडबैक के लिए धन्यवाद।'
            : 'Thank you for your feedback.';
        return `${thankMsg} [HANG_UP]`;
      }

      // HANG UP — hardcoded goodbye
      if (intent.name === 'hang_up') {
        return isTeLang
          ? 'ధన్యవాదాలు, మళ్ళీ కలుద్దాం. [HANG_UP]'
          : isHiLang
            ? 'धन्यवाद, फिर मिलेंगे। [HANG_UP]'
            : 'Thank you, goodbye. [HANG_UP]';
      }

      // QUERY / SLOTS — still use second LLM call since we need to render live data
      let confirmationInstruction;
      if (['query_entity_database', 'get_available_slots'].includes(intent.name)) {
        confirmationInstruction = isTeLang
          ? 'LATEST_DATA లోని వివరాలను మాత్రమే చదివి తెలుగులో సమాధానం ఇవ్వండి. 2-3 వాక్యాలు. కల్పించవద్దు. "DATA_NOT_FOUND" అంటే "ప్రస్తుతం సమాచారం అందుబాటులో లేదు" అని చెప్పండి.'
          : isHiLang
            ? 'LATEST_DATA में से ही जानकारी हिंदी में दें। 2-3 वाक्य। कुछ न बनाएं। "DATA_NOT_FOUND" मिले तो कहें "अभी जानकारी उपलब्ध नहीं है।"'
            : 'Read ONLY from LATEST_DATA and answer clearly in English. 2-3 sentences max. Never invent data. If DATA_NOT_FOUND, say "I don\'t have that information available right now."';
      } else {
        confirmationInstruction = 'Provide a brief professional response. Max 2 sentences. No markdown.';
      }

      const finalResponse = await fetchWithRetry(GROQ_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant',
          messages: [
            {
              role: 'system',
              content: `${systemMessage}\n\nCRITICAL INSTRUCTION: ${confirmationInstruction}\nNEVER expose JSON, brackets, system markers, or raw data to the user.`
            },
            ...messages.slice(-4),
            { role: 'assistant', content: assistantMessage },
            {
              role: 'user',
              content: `[SYSTEM: Action completed. Result: ${result?.error ? 'ERROR' : 'SUCCESS'}. Data: ${typeof result === 'string' ? result : JSON.stringify(result)}]`
            }
          ],
          temperature: 0.1,
          max_tokens: 300
        })
      });

      if (finalResponse?.ok) {
        const finalData = await finalResponse.json();
        return finalData.choices[0]?.message?.content || assistantMessage;
      }

      return assistantMessage;
    }

    return assistantMessage;

  } catch (error) {
    console.error('Groq AI Error:', error);
    throw error;
  }
};

// ─── Default system message (used when VoiceOverlay doesn't supply one) ──────
const buildDefaultSystemMessage = ({ companyContext, userName, dateStr, dayName, timeStr, isTe, isHi, isFirstTurn }) => {
  const greeting = isFirstTurn
    ? (isTe
      ? `నమస్కారం ${userName}, నేను కాల్లిక్స్, ${companyContext?.name || 'మీ కంపెనీ'} వర్చువల్ రిసెప్షనిస్ట్. నేను మీకు ఎలా సహాయపడగలను?`
      : isHi
        ? `नमस्ते ${userName}, मैं कॉलिक्स हूँ, ${companyContext?.name || 'आपकी कंपनी'} का वर्चुअल रिसेप्शनिस्ट। मैं आपकी कैसे मदद कर सकता हूँ?`
        : `Hello ${userName}, I'm Callix, the virtual receptionist for ${companyContext?.name || 'our company'}. How may I help you today?`)
    : '';

  return `You are Callix, the virtual receptionist for ${companyContext?.name || 'our business'}.
DATE: ${dateStr} (${dayName}) | TIME: ${timeStr}
LANGUAGE: ${isTe ? 'TELUGU ONLY' : isHi ? 'HINDI ONLY' : 'ENGLISH ONLY'}
USER: ${userName}

${isFirstTurn ? `FIRST MESSAGE: Say exactly: "${greeting}"` : 'DO NOT repeat your introduction.'}

RULES:
- Max 2 sentences. NO markdown. No asterisks. No filler phrases.
- Use [QUERY_ENTITY_DATABASE for {topic}] to look up data. NEVER invent data.
- Need BOTH date AND time before using any [BOOK_...] bracket.
- Never say "booking confirmed" without the [BOOK_...] bracket in the same message.
- After booking → ask if there's anything else.
- When user is done → ask: "Please rate my service from 1 to 5 stars."
- After rating → use [COLLECT_FEEDBACK {number}/5] then say thank you then [HANG_UP].
- [HANG_UP] ONLY after receiving a rating.
- OUT-OF-CONTEXT: Say "I'm designed to assist with [industry] services here. You can ask me things like: [example from data]." NEVER hallucinate.`;
};

// ─── Intent Detection ─────────────────────────────────────────────────────────
const detectIntent = (message, context) => {
  const msg = message.toUpperCase();
  const entityId = context?._id || context?.id || context?.company_id || 'manual';
  const entityName = context?.name || 'General';
  const industry = context?.industry || 'Other';

  const storedUser = safeStorage.parse('user', {});
  const userEmail = context?.userEmail || storedUser.email || '';
  const userName = context?.userName || storedUser.full_name || 'Guest';
  const systemDate = context?.systemDate ? new Date(context.systemDate) : new Date();

  // ─── Date helpers ──────────────────────────────────────────────────────────
  const formatDateISO = (date) => {
    try {
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric', month: '2-digit', day: '2-digit'
      });
      return formatter.format(date);
    } catch {
      const d = new Date(date);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
  };

  const parseRelativeDate = (dateStr) => {
    if (!dateStr || dateStr.toUpperCase() === 'TBD' || dateStr === '') return 'TBD';
    const raw = dateStr.toLowerCase().trim();
    const isNext = /\bnext\b|\bअगला\b|\bతర్వాత\b/i.test(raw);
    const cleaned = raw.replace(/\bnext\b|\bअगला\b|\bతర్వాత\b/gi, '').trim();
    const ref = new Date(systemDate);

    if (/^(today|ఈరోజు|आज)$/.test(cleaned)) return formatDateISO(ref);
    if (/^(tomorrow|రేపు|कल)$/.test(cleaned)) {
      ref.setDate(ref.getDate() + 1);
      return formatDateISO(ref);
    }

    const dayMap = {
      sunday: 0, ఆదివారం: 0, रविवार: 0,
      monday: 1, సోమవారం: 1, सोमवार: 1,
      tuesday: 2, మంగళవారం: 2, मंगलवार: 2,
      wednesday: 3, బుధవారం: 3, बुधवार: 3,
      thursday: 4, గురువారం: 4, गुरुवार: 4,
      friday: 5, శుక్రవారం: 5, शुक्रवार: 5,
      saturday: 6, శనివారం: 6, शनिवार: 6
    };

    if (dayMap[cleaned] !== undefined) {
      const target = dayMap[cleaned];
      const today = ref.getDay();
      let diff = target - today;
      if (diff <= 0) diff += 7;
      if (isNext) diff += 7;
      ref.setDate(ref.getDate() + diff);
      return formatDateISO(ref);
    }

    // ISO format already
    if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned;

    // DD/MM/YYYY or DD-MM-YYYY
    const dmy = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;

    // "15 march" or "march 15"
    const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    const mReg = new RegExp(`(\\d{1,2})\\s+(${months.join('|')})|(${months.join('|')})\\s+(\\d{1,2})`, 'i');
    const mMatch = cleaned.match(mReg);
    if (mMatch) {
      const day = mMatch[1] || mMatch[4];
      const mName = (mMatch[2] || mMatch[3]).toLowerCase();
      const mIdx = months.indexOf(mName) + 1;
      return `${ref.getFullYear()}-${String(mIdx).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }

    return 'TBD';
  };

  const cleanArg = (val, fallback = '', type = 'any') => {
    if (!val) return fallback;
    let cleaned = val.replace(/[\[\]{}"']/g, '')
      .replace(/(?:dish|item|name|product|title|guest|guests):\s*/gi, '').trim();
    const low = cleaned.toLowerCase();

    // Reject placeholder-like values
    if (['date', 'time', 'guests', 'tbd', 'available time', 'any time', 'select time'].includes(low)) return fallback;

    if (type === 'date') {
      const isNamedDay = /^(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|ఈరోజు|రేపు|సోమవారం|మంగళవారం|బుధవారం|గురువారం|శుక్రవారం|శనివారం|ఆదివారం|आज|कल|सोमवार|मंगलवार|बुधवार|गुरुवार|शुक्रवार|शनिवार|रविवार)/i.test(low);
      const isNumericDate = /\d/.test(low) && (low.includes('-') || low.includes('/') || low.includes(',') || low.match(/\b\d{1,2}\b/));
      if (!isNamedDay && !isNumericDate) return fallback;
    }

    if (type === 'time') {
      // Accept numeric time, am/pm, colon format, or Telugu/Hindi time words with digits
      const hasDigit = /\d/.test(low);
      const hasAmPm = /am|pm/i.test(low);
      const hasColon = low.includes(':');
      const hasTimeWord = /గంటలకు|గంటలు|బజే|baje/i.test(low);
      if (!hasDigit && !hasAmPm && !hasColon && !hasTimeWord) return fallback;
    }

    return cleaned || fallback;
  };

  // ─── Appointment ──────────────────────────────────────────────────────────
  const isApptText = msg.includes('BOOK_APPOINTMENT') || msg.includes('BOOK_DOCTOR') || msg.includes('BOOK_MEETING');

  if (isApptText) {
    let pName = 'General', dDate = 'TBD', tTime = 'TBD';

    const fullMatch = message.match(/BOOK[_\s](?:APPOINTMENT|DOCTOR|MEETING|RECORD)\s*(?:for\s+)?(.*?)\s+on\s+(.*?)\s+at\s+([^\n\r\]]*)/i);
    if (fullMatch) {
      pName = fullMatch[1]; dDate = fullMatch[2]; tTime = fullMatch[3];
    } else {
      const cmdStr = (message.match(/BOOK[_\s](?:APPOINTMENT|DOCTOR|MEETING|RECORD)\s+([^\]]+)/i) || [])[1] || message;
      const timeM = cmdStr.match(/at\s+([^\s\]\n]+(?:\s*(?:AM|PM|am|pm))?)/i) || cmdStr.match(/(\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm))/i);
      if (timeM) tTime = timeM[1].trim();
      const dateM = cmdStr.match(/on\s+([\w\-\/]+)/i) || cmdStr.match(/(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|ఈరోజు|రేపు|సోమవారం|మంగళవారం|బుధవారం|గురువారం|శుక్రవారం|శనివారం|ఆదివారం|आज|कल|सोमवार|मंगलवार|बुधवार|गुरुवार|शुक्रवार|शनिवार|रविवार)/i);
      if (dateM) dDate = dateM[1].trim();
      const personM = cmdStr.match(/(?:for\s+)?(.*?)(?:\s+on|\s+at|\s+को|$|\])/i);
      if (personM) pName = personM[1].trim();
    }

    pName = cleanArg(pName, 'General');
    dDate = parseRelativeDate(cleanArg(dDate, 'TBD', 'date'));
    tTime = cleanArg(tTime, 'TBD', 'time');

    const type = (industry.toLowerCase().includes('health') || industry.toLowerCase().includes('hosp')) ? 'doctor' : 'interview';
    console.log(`📌 Appointment: Person=${pName}, Date=${dDate}, Time=${tTime}`);

    return {
      name: 'book_appointment',
      args: { entityId, entityName, type, industry, personName: pName, date: dDate, time: tTime, userEmail, userName }
    };
  }

  // ─── Table ────────────────────────────────────────────────────────────────
  if (msg.includes('BOOK_TABLE') || (msg.includes('BOOK') && msg.includes('TABLE'))) {
    let gSize = '2', bDate = 'TBD', bTime = 'TBD';

    const fullMatch = message.match(/BOOK[_\s]TABLE\s*(?:for\s+)?(.*?)\s+(?:guests?\s+)?on\s+(.*?)\s+at\s+([^\n\r\]]*)/i);
    if (fullMatch) {
      gSize = fullMatch[1]; bDate = fullMatch[2]; bTime = fullMatch[3];
    } else {
      const cmdStr = (message.match(/BOOK[_\s]TABLE\s+([^\]]+)/i) || [])[1] || message;
      const gM = cmdStr.match(/(?:for\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:guests|people|persons|pax)?/i) || cmdStr.match(/(\d+)/);
      if (gM) gSize = gM[1];
      const tM = cmdStr.match(/at\s+([^\s\]\n]+(?:\s*(?:AM|PM|am|pm))?)/i) || cmdStr.match(/(\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm))/i);
      if (tM) bTime = tM[1].trim();
      const dM = cmdStr.match(/on\s+([\w\-\/]+)/i) || cmdStr.match(/(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|ఈరోజు|రేపు|సోమవారం|మంగళవారం|బుధవారం|గురువారం|శుక్రవారం|శనివారం|ఆదివారం|आज|कल|सोमवार|मंगलवार|बुधवार|गुरुवार|शुक्रवार|शनिवार|रविवार)/i);
      if (dM) bDate = dM[1].trim();
    }

    gSize = cleanArg(gSize, '2');
    bDate = parseRelativeDate(cleanArg(bDate, 'TBD', 'date'));
    bTime = cleanArg(bTime, 'TBD', 'time');

    const title = `Table for ${gSize} (${userName})`;
    console.log(`📌 Table: Guests=${gSize}, Date=${bDate}, Time=${bTime}`);

    return {
      name: 'book_appointment',
      args: { entityId, entityName, type: 'table', industry: 'Food & Beverage', personName: title, date: bDate, time: bTime, userEmail, userName }
    };
  }

  // ─── Order ────────────────────────────────────────────────────────────────
  if (msg.includes('BOOK_ORDER')) {
    const m = message.match(/BOOK_ORDER\s+(?:for\s+)?([^\]]+)/i);
    let item = 'Item', totalPrice = 0;
    if (m) {
      const raw = m[1].replace(/[\[\]{}"']/g, '').trim();
      const priceM = raw.match(/[₹\$]\s?([\d,]+)/) || raw.match(/\(([\d,]+)\)/);
      totalPrice = priceM ? parseInt(priceM[1].replace(/,/g, '')) : 0;
      item = raw.split(/[₹\$\(\[]/)[0].replace(/(?:dish|item|product):\s*/gi, '').trim().substring(0, 60);
    }
    console.log(`📌 Order: Item=${item}, Price=${totalPrice}`);
    return {
      name: 'book_order',
      args: { companyId: entityId, entityName, item, totalPrice, customerName: userName, userEmail, industry }
    };
  }

  // ─── Feedback ─────────────────────────────────────────────────────────────
  const hasFeedbackBracket = /\[COLLECT_FEEDBACK/i.test(message);
  const hasRatingKeyword = /RATING|RATE|STAR|రేటింగ్|స్టార్|रेटिंग|स्टार/i.test(msg);

  if (hasFeedbackBracket || hasRatingKeyword) {
    let rating = 0;

    // Priority 1: explicit bracket [COLLECT_FEEDBACK 4/5]
    const bracketM = message.match(/\[COLLECT_FEEDBACK\s*([\d.]+)(?:\s*\/\s*5)?\s*\]/i);
    if (bracketM) rating = parseFloat(bracketM[1]);

    // Priority 2: "X/5" pattern
    if (!rating) {
      const slashM = message.match(/([\d.]+)\s*\/\s*5/);
      if (slashM) rating = parseFloat(slashM[1]);
    }

    // Priority 3: standalone number (only if not a range question like "1 to 5")
    if (!rating && !message.match(/1\s*(?:to|\-|నుండి|से)\s*5/i)) {
      const numM = message.match(/\b([1-5])\b/);
      if (numM) rating = parseFloat(numM[1]);
    }

    // Priority 4: spelled-out words
    if (!rating) {
      const w = msg.toLowerCase();
      if (/\bone\b|ఒకటి|एक/.test(w)) rating = 1;
      else if (/\btwo\b|రెండు|दो/.test(w)) rating = 2;
      else if (/\bthree\b|మూడు|तीन/.test(w)) rating = 3;
      else if (/\bfour\b|నాలుగు|चार/.test(w)) rating = 4;
      else if (/\bfive\b|ఐదు|पाँच|पांच/.test(w)) rating = 5;
    }

    if (rating > 0) {
      if (rating > 5) {
        return { name: 'invalid_feedback', args: { rating } };
      }

      const comment = message
        .replace(/\[COLLECT_FEEDBACK[^\]]*\]/gi, '')
        .replace(/\[[^\]]*\]/g, '')
        .replace(/Callix|Virtual Assistant|Receptionist/gi, '')
        .trim()
        .substring(0, 100) || 'Voice Feedback';

      console.log(`📌 Feedback: Rating=${rating}, Company=${entityId}`);
      return {
        name: 'collect_feedback',
        args: { companyId: entityId, companyName: entityName, rating, user_email: userEmail, user_name: userName, comment, industry }
      };
    }
  }

  // ─── Available Slots ──────────────────────────────────────────────────────
  if (msg.includes('GET_AVAILABLE_SLOTS')) {
    const m = message.match(/GET_AVAILABLE_SLOTS\s+(?:for\s+)?(.*)/i);
    const date = m ? parseRelativeDate(m[1].replace(/[\[\]]/g, '').trim()) : formatDateISO(new Date());
    return { name: 'get_available_slots', args: { entityId, date, industry } };
  }

  // ─── Query ────────────────────────────────────────────────────────────────
  if (msg.includes('QUERY_ENTITY_DATABASE') || msg.includes('చూపించు') || msg.includes('అందుబాటులో') || msg.includes('सेवाएं') || msg.includes('दिखाओ')) {
    const m = message.match(/QUERY_ENTITY_DATABASE\s+(?:for\s+)?(.*)/i);
    const query = m ? m[1].replace(/[\[\]]/g, '').trim() : message.substring(0, 100);
    return { name: 'query_entity_database', args: { entityId, query } };
  }

  // ─── Hang Up ──────────────────────────────────────────────────────────────
  if (msg.includes('HANG_UP')) {
    return { name: 'hang_up', args: {} };
  }

  return null;
};

// ─── Execute Action ───────────────────────────────────────────────────────────
const executeAction = async (match) => {
  const { name, args } = match;
  if (name === 'invalid_feedback') {
    return { error: `Invalid rating of ${args.rating}. Ratings must be 1–5 stars.` };
  }
  if (tools[name]) {
    try {
      return await tools[name](args);
    } catch (e) {
      console.error(`Action ${name} failed:`, e);
      return { error: e.message || 'Action failed' };
    }
  }
  return { error: 'Unknown action' };
};

// ─── Audio Transcription ──────────────────────────────────────────────────────
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