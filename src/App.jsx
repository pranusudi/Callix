import { useState, useEffect } from 'react';
import Header from './components/Header';
import BackgroundEffects from './components/BackgroundEffects';
import HeroSection from './components/HeroSection';
import VoiceOverlay from './components/VoiceOverlay';
import CompanyOnboarding from './components/CompanyOnboarding';
import AccountPortfolio from './components/AccountPortfolio';
import ProblemsAndSolutions from './components/ProblemsAndSolutions';
import PricingSection from './components/PricingSection';
import AuthModal from './components/AuthModal';
import UserDashboard from './components/UserDashboard';
import AdminDashboard from './components/AdminDashboard';
import SuperAdminDashboard from './components/SuperAdminDashboard';
import { database } from './utils/database';
import { initializeGroq } from './utils/groq';
import { supabase } from './utils/supabase';
import { ToastContainer } from './components/Toast';
import { ShieldCheck, Loader, Package, Users, Activity, LogOut, ChevronRight, MessageSquare, Database, TrendingUp, CheckCircle } from 'lucide-react';

function App() {
  const [isVoiceOverlayOpen, setIsVoiceOverlayOpen] = useState(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authModalConfig, setAuthModalConfig] = useState({ mode: 'signin', role: 'user' });
  const [showDashboard, setShowDashboard] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [user, setUser] = useState(null);
  const [apiKey, setApiKey] = useState('');
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState([]);

  const addToast = (message, type = 'success') => {
    const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => removeToast(id), 5000);
  };

  const removeToast = (id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  // Scroll to top on navigation/dashboard toggle
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [showDashboard]);

  useEffect(() => {
    let subscription;

    const init = async () => {
      // Check for existing Supabase session
      await checkSession();

      // Listen for Auth State Changes (important for email confirmation redirects)
      const { data } = supabase.auth.onAuthStateChange(async (event, session) => {
        console.log("Auth Event Triggered:", event);

        // 1. Handle URL Hash Fragments (Errors or Success from Email)
        const hash = window.location.hash;
        if (hash) {
          const params = new URLSearchParams(hash.substring(1));
          const error = params.get('error_description');
          const type = params.get('type');

          if (error) {
            addToast(`Auth Error: ${error.replace(/\+/g, ' ')}`, 'error');
            window.history.replaceState({}, document.title, window.location.pathname);
          } else if (type === 'signup' || params.get('access_token')) {
            addToast('Email confirmed successfully!', 'success');
            window.history.replaceState({}, document.title, window.location.pathname);
          }
        }

        // 2. Sync User State
        if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
          if (session?.user) {
            // Small delay to allow Supabase DB Trigger to finish profile creation
            setTimeout(async () => {
              const { data: profile } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
              setUser({ ...session.user, profile });
            }, 500);
          }
        }

        if (event === 'SIGNED_OUT') {
          setUser(null);
          setShowDashboard(false);
          localStorage.removeItem('user');
        }
      });
      subscription = data.subscription;

      // Load API key from environment or localStorage
      const envKey = import.meta.env.VITE_GROQ_API_KEY;
      const storedKey = localStorage.getItem('groq_api_key');
      const key = envKey || storedKey || '';

      if (key) {
        setApiKey(key);
        initializeGroq(key);
      }

      // Load companies
      await loadCompanies();
    };

    init();

    return () => {
      if (subscription) subscription.unsubscribe();
    };
  }, []);

  const checkSession = async () => {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) console.error('Session error:', error);

    if (session) {
      console.log('Session User ID:', session.user.id);
      const { data: profile, error: pError } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();

      if (pError) {
        console.error('Profile Fetch Error:', pError);
        addToast('Profile data could not be synchronized.', 'error');
      } else {
        // Enforce Admin Approval
        if (profile?.role === 'admin' && profile?.status === 'pending') {
          await database.signOut();
          setUser(null);
          addToast('Your account is awaiting Superadmin approval. Please check back later.', 'info');
          return;
        }
        console.log('Profile Sync Success:', profile);
      }

      setUser({ ...session.user, profile });
    }
  };

  const loadCompanies = async () => {
    try {
      setLoading(true);
      const data = await database.getCompanies();

      if (data) {
        const formattedCompanies = data
          .map(c => ({
            id: c.id,
            name: c.name,
            industry: c.industry || 'Technology',
            logo: c.logo || (c.industry === 'Healthcare' ? '🏥' : (c.industry === 'Food & Beverage' ? '🍽' : (c.industry === 'E-Commerce' ? '🛒' : '🏢'))),
            contextSummary: c.context_summary || c.nlp_context || 'Standard AI Intelligence Pattern',
            nlpContext: c.nlp_context || '',
            status: c.status || 'active',
            apiLinked: true
          }));

        if (formattedCompanies.length > 0) {
          setCompanies(formattedCompanies);
          return;
        }
      }

      // Fallback for demo when database is unreachable or empty
      setCompanies([
        { id: 'h1', name: 'Aarogya Multi-Specialty Hospital', industry: 'Healthcare', logo: '🏥', contextSummary: 'AI-Driven 24/7 Patient Concierge and Appointment Management.', nlpContext: 'Manage appointments, check availability.', apiLinked: true },
        { id: 'r1', name: 'Spice Garden Premium Fine-Dining', industry: 'Food & Beverage', logo: '🍽', contextSummary: 'Automated Reservations, Menu Inquiries, and Home Delivery.', nlpContext: 'Book tables and take food orders.', apiLinked: true },
        { id: 't1', name: 'TechNova Global IT Solutions', industry: 'Technology', logo: '🏢', contextSummary: 'Level-1 Technical Support and SaaS Deployment Assistance.', nlpContext: 'IT support and lead generation.', apiLinked: true }
      ]);
    } catch (error) {
      console.error('Error loading companies:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCallAgent = () => {
    const voxSphere = companies.find(c => c.name.includes('VoxSphere'));
    if (voxSphere) setSelectedCompany(voxSphere);
    setIsVoiceOverlayOpen(true);
  };

  const handleDeployAgent = (company) => {
    setSelectedCompany(company);
    setIsVoiceOverlayOpen(true);
  };

  const handleLogout = async () => {
    await database.signOut();
    localStorage.removeItem('user');
    setUser(null);
    setShowDashboard(false);
    addToast('Successfully signed out of the platform.', 'info');
  };

  const handleAuthSuccess = (authenticatedUser) => {
    setUser(authenticatedUser);
    setShowDashboard(false);
    addToast(`Welcome back, ${authenticatedUser.profile?.full_name || 'User'}! Authentication successful.`);
  };

  const renderDashboard = () => {
    if (!user) return null;

    // Check both profile and user metadata for the role
    const profileRole = user.profile?.role;
    const metaRole = user.user_metadata?.role;
    const role = profileRole || metaRole || user.role || 'user';

    console.log('--- DASHBOARD ROUTING ---');
    console.log('Detected Role:', role);
    console.log('Profile Role:', profileRole);
    console.log('Metadata Role:', metaRole);
    console.log('Email:', user.email);

    const isPending = user.profile?.status === 'pending';

    if (role === 'superadmin') {
      return <SuperAdminDashboard user={user} onLogout={handleLogout} addToast={addToast} onHome={() => setShowDashboard(false)} />;
    } else if (role === 'admin') {
      if (isPending) {
        return (
          <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 text-center">
            <div className="max-w-md">
              <div className="w-20 h-20 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-6 border border-amber-200 shadow-sm">
                <ShieldCheck size={40} className="text-amber-600" />
              </div>
              <h2 className="text-2xl font-black text-slate-900 mb-2 uppercase tracking-tighter">Access Deferred</h2>
              <p className="text-slate-500 text-sm mb-8 leading-relaxed font-medium">
                Your company registration for <span className="text-indigo-600 font-bold">{user.profile?.company_name || 'your organization'}</span> is currently being reviewed by our Global Compliance team.
              </p>
              <button
                onClick={handleLogout}
                className="px-8 py-3 bg-white hover:bg-slate-50 text-slate-900 rounded-xl font-bold text-xs uppercase tracking-widest transition-all border border-slate-200 shadow-sm"
              >
                Sign Out & Return Home
              </button>
            </div>
          </div>
        );
      }
      return <AdminDashboard user={user} onLogout={handleLogout} addToast={addToast} onHome={() => setShowDashboard(false)} />;
    } else {
      return <UserDashboard user={user} onClose={() => setShowDashboard(false)} onLogout={handleLogout} addToast={addToast} />;
    }
  };

  const openAuthModal = (mode = 'signin', role = 'user') => {
    setAuthModalConfig({ mode, role });
    setIsAuthModalOpen(true);
  };

  return (
    <div className="min-h-screen bg-white relative overflow-x-hidden">
      <BackgroundEffects />
      {!showDashboard && (
        <Header
          onSignUpClick={() => openAuthModal('signin', 'user')}
          onAdminLoginClick={() => openAuthModal('signin', 'admin')}
          user={user}
          onLogout={handleLogout}
          onViewDashboard={() => setShowDashboard(true)}
          onNavigateHome={() => setShowDashboard(false)}
        />
      )}
      <main className="relative z-10">
        {showDashboard && user ? (
          renderDashboard()
        ) : (
          <>
            <HeroSection onCallAgent={handleCallAgent} />
            <div className="py-20 bg-slate-50 flex flex-col items-center border-y border-slate-200">
              <h3 className="text-3xl font-black tracking-tighter text-slate-800 mb-6">Scale your business with AI.</h3>
              <button
                onClick={() => openAuthModal('signup', 'admin')}
                className="px-8 py-4 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-indigo-600/20 hover:scale-105 transition-all"
              >
                Register as Company Admin
              </button>
            </div>
            <ProblemsAndSolutions />
            <AccountPortfolio
              onDeployAgent={handleDeployAgent}
              companies={companies}
              loading={loading}
              isLoggedIn={!!user}
              onLoginRequired={() => openAuthModal('signin', 'user')}
              onAddCompany={() => setIsOnboardingOpen(true)}
            />
            <PricingSection />
          </>
        )}
      </main>
      <VoiceOverlay
        isOpen={isVoiceOverlayOpen}
        onClose={() => {
          setIsVoiceOverlayOpen(false);
          setSelectedCompany(null);
        }}
        selectedCompany={selectedCompany}
        user={user}
        addToast={addToast}
      />
      <AuthModal
        key={`${authModalConfig.mode}-${authModalConfig.role}`}
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onSuccess={handleAuthSuccess}
        initialMode={authModalConfig.mode}
        initialRole={authModalConfig.role}
        addToast={addToast}
      />
      <CompanyOnboarding
        isOpen={isOnboardingOpen}
        onClose={() => setIsOnboardingOpen(false)}
        onSuccess={() => loadCompanies()}
      />
      <footer className="relative z-10 py-12 px-4 border-t border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto text-center">
          <p className="text-slate-500 text-sm font-medium">
            © {new Date().getFullYear()} Callix. All rights reserved.
          </p>
          <p className="text-slate-400 text-[10px] mt-2 tracking-wider">
            Powered by Praneetha, Rishitha and Hasmitha.
          </p>
        </div>
      </footer>
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </div>
  );
}

export default App;