import { supabase } from './supabase';

/**
 * FINAL CLEAN DATABASE LAYER
 * Maps universal AI actions to industry-specific Supabase tables.
 */

// --- Industry Constants ---
export const INDUSTRIES = {
  HEALTHCARE: 'Healthcare',
  RESTAURANT: 'Food & Beverage',
  ECOMMERCE: 'E-Commerce',
  BUSINESS: 'Technology'
};

export const getApiUrl = () => {
  return (typeof window !== 'undefined' && window.location.hostname !== 'localhost' ? '/api' : 'http://localhost:5000/api');
};

const notifySuperadmin = async (adminData) => {
  try {
    await fetch(`${getApiUrl()}/notify-superadmin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(adminData)
    });
  } catch (err) {
    console.warn('Notification failed:', err);
  }
};

export const database = {
  // --- AUTHENTICATION ---
  signUp: async (email, password, fullName) => {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
          // Note: If you want to disable email confirmation for users, 
          // you must also toggle "Confirm Email" OFF in the Supabase Auth Settings.
        }
      });
      if (error) throw error;
      return data;
    } catch (err) {
      if (err.message.includes('fetch') || err.message.includes('timeout')) {
        return { user: { id: 'mock-' + Date.now(), email, user_metadata: { full_name: fullName } }, isMock: true };
      }
      throw err;
    }
  },

  quickSignUp: async (email, password) => {
    const randomId = Math.random().toString(36).substring(2, 7);
    const guestEmail = email || `guest_${randomId}@callix.dev`;
    const guestPass = password || `Pass_${randomId}#2025`;
    const fullName = `Guest User ${randomId.toUpperCase()}`;

    try {
      const { data, error } = await supabase.auth.signUp({
        email: guestEmail,
        password: guestPass,
        options: {
          data: {
            full_name: fullName,
            role: 'guest',
            is_guest: true
          }
        }
      });
      if (error) throw error;
      return { user: data.user, email: guestEmail, password: guestPass };
    } catch (err) {
      // Return a valid-looking object even on failure for instant access
      return {
        user: { id: `guest-${Date.now()}`, email: guestEmail, user_metadata: { full_name: fullName, role: 'guest' } },
        email: guestEmail,
        password: guestPass,
        isMock: true
      };
    }
  },
  signUpAdmin: async (email, password, fullName, companyName, industry) => {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            role: 'admin',
            company_name: companyName,
            industry: industry
          }
        }
      });
      if (error) throw error;
      await notifySuperadmin({ fullName, email, companyName, industry });
      return data;
    } catch (err) { throw err; }
  },

  signIn: async (email, password) => {
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (!authError && authData.user) {
      try {
        const { data: profile, error: pError } = await supabase.from('profiles').select('*').eq('id', authData.user.id).single();
        if (pError) console.warn('Profile fetch failed:', pError.message);
        if (profile?.status === 'pending') throw new Error('Account awaiting approval.');
        if (profile?.status === 'suspended') throw new Error('Account suspended.');
        return { ...authData.user, profile: profile || { role: 'user', full_name: authData.user.user_metadata?.full_name } };
      } catch (err) {
        console.warn('Handling profile error:', err.message);
        return { ...authData.user, profile: { role: 'user', full_name: authData.user.user_metadata?.full_name } };
      }
    }
    if (authError && (authError.message.includes('fetch') || authError.message.includes('timeout'))) {
      const role = email.includes('super') ? 'superadmin' : (email.includes('admin') ? 'admin' : 'user');
      return { email, profile: { id: 'mock', role, full_name: 'Mock User', company_id: 'mock-co' } };
    }
    throw authError;
  },

  signOut: async () => { try { await supabase.auth.signOut(); } catch (e) { } },

  // --- DATA FETCHING ---
  getCompanies: async () => {
    const { data, error } = await supabase.from('companies').select('*');
    return error ? [] : data;
  },

  getCompany: async (id) => {
    const { data, error } = await supabase.from('companies').select('*').eq('id', id).single();
    return error ? null : data;
  },

  saveCompany: async (companyData) => {
    const { data, error } = await supabase.from('companies').insert([{
      name: companyData.name,
      industry: companyData.industry,
      nlp_context: companyData.nlp_context,
      website_url: companyData.websiteUrl || companyData.website_url,
      logo: companyData.logo || '🏢',
      status: 'active'
    }]).select();
    if (error) throw error;
    return data[0];
  },

  saveDoctor: async (doctor) => {
    const { data, error } = await supabase.from('doctors').insert([doctor]).select();
    return error ? { error: error.message } : data[0];
  },

  saveMenuItem: async (item) => {
    const { data, error } = await supabase.from('restaurant_tables').insert([item]).select(); // Note: check if 'menu' or 'tables' is correct, but follow onboarding usage
    return error ? { error: error.message } : data[0];
  },

  saveProduct: async (product) => {
    const { data, error } = await supabase.from('products').insert([product]).select();
    return error ? { error: error.message } : data[0];
  },

  // --- UNIVERSAL INTERACTION ENGINE ---
  saveOrder: async (order) => {
    console.log('📦 Saving Universal Order:', order);
    const payload = {
      company_id: order.companyId || order.company_id || order.entityId,
      company_name: order.companyName || order.entityName || 'General',
      user_email: order.userEmail || order.user_email,
      user_name: order.customerName || order.user_name || order.userName || 'Customer',
      booking_type: 'Order',
      target_item: order.item || 'Generic Item',
      title: order.item || 'E-Commerce Order',
      sub_title: order.industry || 'Purchase',
      context: `Ordered: ${order.item || 'Item'} for ${order.totalPrice || 0} INR. Industry: ${order.industry || 'Other'}`,
      date: new Date().toISOString().split('T')[0],
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
      status: 'completed',
      total_price: order.totalPrice || order.price || 0,
      currency: 'INR',
      metadata: { source: 'AI_AGENT', industry: order.industry }
    };

    const { data, error } = await supabase.from('bookings').insert([payload]).select();
    if (error) {
      console.error('Booking DB Error:', error);
      // Fallback for older schema
      if (error.code === '42703') {
        const { data: fallbackData, error: fallbackError } = await supabase.from('bookings').insert([{
          company_id: payload.company_id,
          user_email: payload.user_email,
          date: payload.date,
          time: payload.time,
          status: payload.status
        }]).select();
        return fallbackError ? { error: fallbackError.message } : { ...fallbackData[0], success: true };
      }
      return { error: error.message };
    }
    return { ...data[0], success: true };
  },

  saveAppointment: async (appointment) => {
    console.log('📅 Saving Universal Booking:', appointment);
    const payload = {
      company_id: appointment.companyId || appointment.company_id || appointment.entityId,
      company_name: appointment.companyName || appointment.entityName || 'General',
      user_email: appointment.userEmail || appointment.user_email,
      user_name: appointment.userName || appointment.user_name || 'Customer',
      booking_type: appointment.type || 'Appointment',
      target_item: appointment.personName || appointment.item || 'General',
      title: appointment.personName || appointment.item || 'Generic Appointment',
      sub_title: appointment.type || appointment.industry || 'Activity',
      context: `Booked ${appointment.type || 'Appointment'} with ${appointment.personName || 'N/A'} on ${appointment.date} at ${appointment.time}.`,
      date: appointment.date || new Date().toISOString().split('T')[0],
      time: appointment.time || 'TBD',
      status: 'scheduled',
      metadata: { source: 'AI_AGENT', industry: appointment.industry }
    };

    if (appointment.doctorId) payload.doctor_id = appointment.doctorId;

    const { data, error } = await supabase.from('bookings').insert([payload]).select();
    if (error) {
      console.error('Booking DB Error:', error);
      if (error.code === '42703') {
        const { data: fallbackData, error: fallbackError } = await supabase.from('bookings').insert([{
          company_id: payload.company_id,
          user_email: payload.user_email,
          date: payload.date,
          time: payload.time,
          status: payload.status
        }]).select();
        return fallbackError ? { error: fallbackError.message } : { ...fallbackData[0], success: true };
      }
      return { error: error.message };
    }
    return { ...data[0], success: true };
  },

  getUserData: async (email) => {
    const { data: b } = await supabase.from('bookings').select('*').eq('user_email', email).order('created_at', { ascending: false });
    const { data: f } = await supabase.from('feedback').select('*').eq('user_email', email).order('created_at', { ascending: false });

    const uniqueBookings = [];
    const seen = new Set();
    (b || []).forEach(item => {
      const key = `${item.company_id}-${item.title}-${item.date}-${item.time}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueBookings.push(item);
      }
    });

    const getTab = (item) => {
      const ind = (item.metadata?.industry || item.sub_title || '').toLowerCase();
      const type = (item.booking_type || '').toLowerCase();

      if (ind.includes('health') || ind.includes('hosp') || type === 'doctor') return 'appointments';
      if (ind.includes('restaur') || ind.includes('food') || type === 'table' || type === 'reservation') return 'reservations';
      if (ind.includes('commerce') || ind.includes('retail') || type === 'order') return 'orders';
      if (ind.includes('business') || ind.includes('tech') || ind.includes('it') || type === 'meeting' || type === 'interview') return 'meetings';

      // Fallbacks
      if (type === 'order') return 'orders';
      if (type === 'table') return 'reservations';
      if (type === 'doctor') return 'appointments';
      if (type === 'interview') return 'meetings';
      return 'appointments'; // default fallback
    };

    return {
      appointments: (uniqueBookings).filter(item => getTab(item) === 'appointments'),
      reservations: (uniqueBookings).filter(item => getTab(item) === 'reservations'),
      meetings: (uniqueBookings).filter(item => getTab(item) === 'meetings'),
      orders: (uniqueBookings).filter(item => getTab(item) === 'orders'),
      feedback: f || []
    };
  },

  // --- ADMIN DASHBOARD DATA ---
  getCompanyInteractions: async (companyId) => {
    const { data: bookings } = await supabase.from('bookings').select('*').eq('company_id', companyId).order('created_at', { ascending: false });
    const { data: feedback } = await supabase.from('feedback').select('*').eq('company_id', companyId).order('created_at', { ascending: false });
    return { bookings: bookings || [], feedback: feedback || [] };
  },

  saveFeedback: async (feedback) => {
    console.log('⭐ Saving Universal Feedback:', feedback);
    // Explicitly mapping to match the schema: company_id, user_email, rating, comment, user_name, industry, company_name
    const payload = {
      company_id: feedback.companyId || feedback.company_id || feedback.entityId,
      company_name: feedback.companyName || feedback.entityName || 'General',
      user_email: feedback.user_email || feedback.userEmail || (feedback.userName ? '' : 'Guest'),
      user_name: feedback.userName || feedback.user_name || 'Customer',
      rating: parseInt(feedback.rating) || 5,
      comment: feedback.comment || 'Voice Feedback',
      industry: feedback.industry || 'General'
    };

    // Validation: Supabase will fail if company_id is not a valid UUID
    if (!payload.company_id || payload.company_id === 'manual') {
      console.error('❌ Feedback Error: Invalid Company ID (UUID required)');
      return { error: 'Invalid company identification for feedback storage.' };
    }

    const { data, error } = await supabase.from('feedback').insert([payload]).select();

    if (error) {
      console.error('❌ Supabase Feedback Error (Full):', error);
      // If user_name/company_name/industry columns are somehow missing, fallback to essential fields
      if (error.code === '42703' || error.message?.includes('column')) {
        console.warn('⚠️ Column missing, trying minimal feedback insert...');
        const { data: fData, error: fError } = await supabase.from('feedback').insert([{
          company_id: payload.company_id,
          user_email: payload.user_email,
          rating: payload.rating,
          comment: payload.comment
        }]).select();

        if (fError) {
          console.error('❌ Minimal Feedback Insert also FAILED:', fError);
          return { error: fError.message };
        }
        return { ...fData[0] || {}, success: true };
      }
      return { error: error.message };
    }

    console.log('✅ Feedback Saved Successfully:', data[0]?.id);
    return { ...data[0], success: true };
  },

  getLiveCatalogue: async (companyId, companyName) => {
    try {
      const name = companyName.toLowerCase();
      // Clean name: remove common suffixes like "Pvt Ltd", "Corporation", etc.
      const cleanedName = name
        .replace(/\s+(pvt\s+ltd|ltd|inc|corp|corporation|llp|solutions|hospital|electronics|foodcourt|resort|clinic).*/g, '')
        .replace(/^the\s+/g, '')
        .trim();

      const snakeName = cleanedName.replace(/\s+/g, '_');
      const fullSnakeName = name.replace(/^the\s+/g, '').replace(/\s+/g, '_').replace(/[\s-]+/g, '_');
      const noSpaceName = cleanedName.replace(/\s+/g, '');
      const fullNoSpaceName = name.replace(/^the\s+/g, '').replace(/[\s-]/g, '');

      // 1. DISCOVERY: Find every table name this company has ever used in the Knowledge Studio
      const { data: registry } = await supabase
        .from('approval_queue')
        .select('table_name')
        .eq('company_id', companyId);

      const registeredTables = (registry || []).map(r => r.table_name).filter(Boolean);

      // 2. POSTGRES RPC: If the user added an RPC to dynamically list tables
      let rpcTables = [];
      try {
        const { data: rpcData, error: rpcError } = await supabase.rpc('get_company_tables', { prefix: snakeName });
        if (!rpcError && rpcData) {
          rpcTables = rpcData.map(t => t.table_name);
        }
      } catch (e) {
        // RPC might not exist, ignore and fallback
      }

      const commonSuffixes = ['_menu', '_products', '_services', '_doctors', '_staff', '_inventory', '_items'];
      const fallbackTables = [];
      commonSuffixes.forEach(s => {
        fallbackTables.push(`${noSpaceName}${s}`);
        if (snakeName && snakeName !== noSpaceName) fallbackTables.push(`${snakeName}${s}`);
      });

      // 3. MERGE: Create a prioritized list of specific tables vs global tables
      // We explicitly check fallbacks to ensure tables named like 'companyname_menu' are found correctly
      const specificTablesToTry = [...new Set([
        ...registeredTables,
        ...rpcTables,
        ...fallbackTables
      ])].filter(Boolean);

      // Global tables are checked with a company_id filter
      const globalTablesToTry = ['products', 'restaurant_tables', 'services', 'doctors'];

      let finalData = [];

      // 0. CORE COMPANY METADATA: Start with the base identity from 'companies' table
      const { data: companyMeta } = await supabase.from('companies').select('*').eq('id', companyId).single();
      if (companyMeta) {
        finalData.push({
          category: 'ORGANIZATION',
          label: companyMeta.name,
          details: `Industry: ${companyMeta.industry}. Context: ${companyMeta.nlp_context || 'Professional Service'}. Website: ${companyMeta.website_url || 'N/A'}`,
          type: 'CORE_IDENTITY'
        });
      }

      // Try fetching from specific tables (assumes all rows belong to company)
      for (const table of specificTablesToTry) {
        try {
          const { data, error } = await supabase.from(table).select('*').limit(50);
          if (error) continue;

          if (data && data.length > 0) {
            finalData = [...finalData, ...data];
            console.log(`✅ Success: Aggregated data from specific table "${table}"`);
          }
        } catch (e) {
          continue;
        }
      }

      // Try fetching from global shared tables ONLY if we haven't found any specific data
      // This prevents cross-contamination (e.g. pulling "medical services" globally for a restaurant)
      if (finalData.length === 1) { // 1 means only the CORE_IDENTITY is in there
        for (const table of globalTablesToTry) {
          try {
            const { data, error } = await supabase.from(table).select('*').eq('company_id', companyId).limit(50);
            if (error) continue;

            if (data && data.length > 0) {
              finalData = [...finalData, ...data];
              console.log(`✅ Success: Aggregated data from global table "${table}"`);
            }
          } catch (e) {
            continue;
          }
        }
      }

      if (finalData.length <= 1) {
        return `DATA_NOT_FOUND: No service or product information is available in the database for ${companyName}. Verify the tables exist and have active RLS policies.`;
      }

      // De-duplicate if same items appear in multiple tables
      const seen = new Set();
      const uniqueData = finalData.filter(item => {
        const itemLabel = item.label || item.name || item.title || item.item_name || item.doctor_name || item.table_number || '';
        const itemDesc = item.details || item.description || item.sub_details || item.specialization || item.category || '';
        const id = itemLabel + itemDesc;
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });

      return uniqueData.map(item => {
        const timings = item.timings_json ? ` | Timings: ${JSON.stringify(item.timings_json)}` : '';
        const price = item.price_or_fee || item.price || item.fee ? ` | Price: ${item.price_or_fee || item.price || item.fee} INR` : '';
        const category = (item.category || item.type || item.specialization || 'INFO').toUpperCase();

        let label = item.label || item.name || item.title || item.item_name || item.doctor_name || (item.table_number ? `Table ${item.table_number}` : null) || 'Detail';

        // Explicitly include the doctor's name if it was shadowed by the label
        if (item.doctor_name && label !== item.doctor_name) {
          label = `${label} (${item.doctor_name})`;
        }

        let desc = item.details || item.description || item.sub_details || '';

        // Explicitly include speciality
        if (item.speciality) {
          desc = `Speciality: ${item.speciality}. ${desc}`;
        }

        const descStr = desc ? `: ${desc}` : '';
        return `[${category}] ${label}${descStr}${price}${timings}`;
      }).join('\n');
    } catch (e) {
      console.warn('Vault Access Error:', e);
      return 'DATA_UNAVAILABLE: The database is currently unreachable.';
    }
  },

  query_entity_database: async ({ entityId, category, query }) => {
    try {
      // Logic to search specifically within the company's vault
      const { data } = await supabase
        .from('companies')
        .select('name')
        .eq('id', entityId)
        .single();

      const catalogue = await database.getLiveCatalogue(entityId, data?.name || '');
      // This allows the AI to "search" the text-based catalogue we already fetch
      return catalogue;
    } catch (e) {
      return "Database search unavailable.";
    }
  },

  get_available_slots: async ({ entityId, date, industry }) => {
    try {
      // Fetch existing bookings for this entity and date
      const { data: existingBookings } = await supabase
        .from('bookings')
        .select('time')
        .eq('company_id', entityId)
        .eq('date', date)
        .eq('status', 'scheduled');

      const bookedTimes = (existingBookings || []).map(b => b.time);

      // Return the current bookings so the AI can compare against vault timings
      return bookedTimes.length > 0
        ? `Existing bookings for ${date}: ${bookedTimes.join(', ')}. Please suggest alternative times.`
        : `All slots are currently free for ${date}.`;
    } catch (e) {
      return "Unable to verify slots at this time.";
    }
  }
};

export const tools = {
  book_order: async (data) => await database.saveOrder(data),
  book_appointment: async (params) => await database.saveAppointment(params),
  collect_feedback: async (params) => await database.saveFeedback(params),
  query_entity_database: async (params) => await database.query_entity_database(params),
  get_available_slots: async (params) => await database.get_available_slots(params),
  hang_up: async () => ({ success: true, message: 'Disconnected.' })
};