import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Mail, Lock, User, Building2, Briefcase, ChevronRight, ShieldCheck, ArrowLeft, AlertCircle, Zap } from 'lucide-react';
import { database } from '../utils/database';

const AuthModal = ({ isOpen, onClose, onSuccess, initialMode = 'signin', initialRole = 'user', addToast }) => {
    // Initialize state directly from props since we use 'key' in App.jsx to force remounts
    const [authMode, setAuthMode] = useState(initialMode);
    const [userRole, setUserRole] = useState(initialRole);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [showVerificationInfo, setShowVerificationInfo] = useState(false);

    const [formData, setFormData] = useState({
        email: '',
        password: '',
        fullName: '',
        companyName: '',
        industry: 'Technology',
        phone: '',
        preferredLanguage: 'en-US'
    });

    // Sync state if props change (though key prop in App should handle this)
    useEffect(() => {
        setAuthMode(initialMode);
        setUserRole(initialRole);
    }, [initialMode, initialRole]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            if (authMode === 'signup') {
                if (userRole === 'admin') {
                    await database.signUpAdmin(formData.email, formData.password, formData.fullName, formData.companyName, formData.industry);
                    setShowVerificationInfo(true);
                } else {
                    await database.signUp(formData.email, formData.password, formData.fullName);
                    addToast('Registration successful! Please sign in.', 'success');
                    setAuthMode('signin');
                }
            } else {
                const user = await database.signIn(formData.email, formData.password);
                localStorage.setItem('user', JSON.stringify(user));
                onSuccess(user);
                onClose();
            }
        } catch (err) {
            console.error('Auth error:', err);
            let message = err.message || 'Authentication failed. Please verify your credentials.';
            if (message.includes('User already registered') || message.includes('already been registered')) {
                message = 'An account with this email already exists. Please sign in instead.';
            }
            setError(message);
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <AnimatePresence mode="wait">
            <motion.div
                className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-500/10 backdrop-blur-md p-3"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
            >
                <motion.div
                    className="relative w-full max-w-sm bg-slate-50 rounded-[32px] border border-slate-200 shadow-2xl shadow-indigo-100/50 overflow-hidden"
                    initial={{ scale: 0.98, opacity: 0, y: 10 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                >
                    <button onClick={onClose} className="absolute top-4 right-4 text-slate-500 hover:text-white transition-colors z-10">
                        <X size={16} />
                    </button>

                    <div className="p-6 flex flex-col relative text-center">
                        {/* Role Indicator Badge */}
                        <div className="flex justify-center mb-4">
                            <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-[0.2em] leading-none shadow-sm ${userRole === 'admin' ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'bg-indigo-100 text-indigo-700 border border-indigo-200'
                                }`}>
                                {userRole === 'admin' ? 'Administration Access' : 'User Account'}
                            </span>
                        </div>

                        <div className="mb-5">
                            <h2 className="text-lg font-black text-slate-900 tracking-widest uppercase">
                                {authMode === 'signin' ? 'Sign In' : userRole === 'admin' ? 'Admin Registration' : 'Create Account'}
                            </h2>
                            <p className="text-slate-500 text-[9px] font-bold mt-0.5 uppercase tracking-tighter opacity-50">
                                {authMode === 'signin' ? 'Please enter your account details' : 'Register your details to continue'}
                            </p>
                        </div>

                        {error && (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="mb-4 p-2.5 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-400 text-[9px] font-black flex items-center gap-2 text-left"
                            >
                                <AlertCircle size={12} className="shrink-0" />
                                <span>{error}</span>
                            </motion.div>
                        )}


                        {showVerificationInfo ? (
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="space-y-6 py-4"
                            >
                                <div className="space-y-4">
                                    <div className="w-20 h-20 bg-emerald-50 rounded-3xl flex items-center justify-center text-emerald-500 mx-auto border border-emerald-100 shadow-sm mb-4 relative">
                                        <ShieldCheck size={40} />
                                        <motion.div
                                            initial={{ scale: 0 }}
                                            animate={{ scale: 1 }}
                                            className="absolute -top-1 -right-1 w-6 h-6 bg-white rounded-full flex items-center justify-center border border-emerald-100 shadow-sm"
                                        >
                                            <div className="w-3 h-3 bg-emerald-500 rounded-full animate-pulse" />
                                        </motion.div>
                                    </div>
                                    <div>
                                        <h3 className="text-base font-black text-slate-900 uppercase tracking-[0.2em] mb-2">Request Transmitted</h3>
                                        <p className="text-[10px] text-slate-500 font-bold leading-relaxed uppercase tracking-wide">
                                            Administrative credentials for <span className="text-indigo-600 underline underline-offset-4 decoration-indigo-100">{formData.companyName}</span> are now in the verification queue.
                                        </p>
                                    </div>
                                </div>

                                <div className="bg-slate-50/80 p-5 rounded-2xl border border-slate-200 text-left relative overflow-hidden group">
                                    <div className="absolute top-0 right-0 p-2 opacity-5 italic text-[40px] font-black pointer-events-none uppercase">Admin</div>
                                    <div className="relative z-10">
                                        <p className="text-[9px] text-slate-900 font-black flex items-center gap-2 uppercase tracking-widest mb-2">
                                            <Zap size={14} className="text-amber-500" />
                                            Superadmin Authorization Required
                                        </p>
                                        <p className="text-[8px] text-slate-500 font-bold leading-relaxed uppercase tracking-tight">
                                            To maintain platform integrity, a <span className="text-slate-900">Superadmin</span> must manually audit and activate your workspace. You will receive access once the security handshake is complete.
                                        </p>
                                    </div>
                                </div>

                                <button
                                    onClick={() => {
                                        setShowVerificationInfo(false);
                                        setAuthMode('signin');
                                    }}
                                    className="w-full py-4 bg-slate-900 text-white rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] shadow-xl shadow-slate-200 hover:bg-black transition-all active:scale-[0.98] mt-4 h-[52px] flex items-center justify-center gap-2"
                                >
                                    Return to Authentication
                                </button>
                            </motion.div>
                        ) : (
                            <form onSubmit={handleSubmit} className="space-y-3 text-left">
                                {authMode === 'signup' && (
                                    <>
                                        <div className="space-y-0.5">
                                            <label className="text-[9px] font-black uppercase tracking-widest text-slate-900 ml-1">Full Name</label>
                                            <div className="relative">
                                                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-600" size={12} />
                                                <input
                                                    type="text"
                                                    required
                                                    value={formData.fullName}
                                                    onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                                                    className="w-full bg-white border border-slate-200 rounded-xl py-2.5 pl-9 pr-4 text-slate-900 text-[11px] focus:border-indigo-500 transition-all outline-none shadow-sm"
                                                    placeholder="First and Last Name"
                                                />
                                            </div>
                                        </div>

                                        {userRole === 'admin' && (
                                            <div className="grid grid-cols-2 gap-2">
                                                <div className="space-y-0.5">
                                                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-900 ml-1">Company Name</label>
                                                    <div className="relative">
                                                        <Building2 className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-600" size={12} />
                                                        <input
                                                            type="text"
                                                            required
                                                            value={formData.companyName}
                                                            onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                                                            className="w-full bg-white border border-slate-200 rounded-xl py-2.5 pl-9 pr-4 text-slate-900 text-[11px] focus:border-indigo-500 transition-all outline-none shadow-sm"
                                                            placeholder="Company Name"
                                                        />
                                                    </div>
                                                </div>
                                                <div className="space-y-0.5">
                                                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-900 ml-1">Industry</label>
                                                    <div className="space-y-2">
                                                        <select
                                                            required
                                                            value={['Healthcare', 'Food & Beverage', 'E-Commerce', 'Technology'].includes(formData.industry) ? formData.industry : 'Other'}
                                                            onChange={(e) => {
                                                                const val = e.target.value;
                                                                if (val === 'Other') {
                                                                    setFormData({ ...formData, industry: '' });
                                                                } else {
                                                                    setFormData({ ...formData, industry: val });
                                                                }
                                                            }}
                                                            className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 px-2 text-slate-900 text-[11px] focus:border-indigo-500 transition-all outline-none"
                                                        >
                                                            <option value="Healthcare">Healthcare</option>
                                                            <option value="Food & Beverage">Food & Beverage</option>
                                                            <option value="E-Commerce">E-Commerce</option>
                                                            <option value="Technology">Technology</option>
                                                            <option value="Other">Other...</option>
                                                        </select>

                                                        {!['Healthcare', 'Food & Beverage', 'E-Commerce', 'Technology'].includes(formData.industry) && (
                                                            <input
                                                                type="text"
                                                                required
                                                                placeholder="Specify industry"
                                                                value={formData.industry}
                                                                onChange={(e) => setFormData({ ...formData, industry: e.target.value })}
                                                                className="w-full bg-white border border-slate-200 rounded-xl py-2.5 px-3 text-slate-900 text-[11px] focus:border-indigo-500 transition-all outline-none shadow-sm"
                                                            />
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </>
                                )}

                                <div className="space-y-0.5">
                                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-900 ml-1">Email Address</label>
                                    <div className="relative">
                                        <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-600" size={12} />
                                        <input
                                            type="email"
                                            required
                                            value={formData.email}
                                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                            className="w-full bg-white border border-slate-200 rounded-xl py-2.5 pl-9 pr-4 text-slate-900 text-[11px] focus:border-indigo-500 transition-all outline-none shadow-sm"
                                            placeholder="email@example.com"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-0.5">
                                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-900 ml-1">Password</label>
                                    <div className="relative">
                                        <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-600" size={12} />
                                        <input
                                            type="password"
                                            required
                                            value={formData.password}
                                            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                            className="w-full bg-white border border-slate-200 rounded-xl py-2.5 pl-9 pr-4 text-slate-900 text-[11px] focus:border-indigo-500 transition-all outline-none shadow-sm"
                                            placeholder="••••••••"
                                            minLength={6}
                                            autoComplete="current-password"
                                        />
                                    </div>
                                </div>

                                <div className="pt-2">
                                    <motion.button
                                        type="submit"
                                        disabled={loading}
                                        className={`w-full py-4 bg-slate-900 text-white rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] shadow-xl shadow-slate-200 hover:bg-black transition-all active:scale-[0.98] disabled:opacity-50 mt-4 h-[52px] flex items-center justify-center gap-2 ${userRole === 'admin' ? 'bg-amber-600 hover:bg-amber-500' : 'bg-indigo-600 hover:bg-indigo-500'
                                            }`}
                                        whileHover={{ y: -1 }}
                                        whileTap={{ scale: 0.99 }}
                                    >
                                        {loading ? (
                                            <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                                        ) : (
                                            <>
                                                <span>{authMode === 'signin' ? 'Sign In' : 'Create Account'}</span>
                                                <ChevronRight size={16} />
                                            </>
                                        )}
                                    </motion.button>

                                    <div className="mt-8 text-center bg-white/50 py-3 rounded-2xl border border-slate-200/50">
                                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-tight">
                                            {authMode === 'signin' ? "Need an account?" : "Already have an account?"}{' '}
                                            <button
                                                type="button"
                                                onClick={() => setAuthMode(authMode === 'signin' ? 'signup' : 'signin')}
                                                className="text-indigo-600 font-black hover:underline underline-offset-4 decoration-indigo-200"
                                            >
                                                {authMode === 'signin' ? 'Sign Up' : 'Sign In'}
                                            </button>
                                        </p>
                                    </div>
                                </div>
                            </form>
                        )}
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
};

export default AuthModal;
