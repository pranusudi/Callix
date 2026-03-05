import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Mail, Lock, User, Building2, Briefcase, ChevronRight, ShieldCheck, ArrowLeft, AlertCircle, Zap } from 'lucide-react';
import { database } from '../utils/database';

const AuthModal = ({ isOpen, onClose, onSuccess, initialMode = 'signin', initialRole = 'user' }) => {
    // Initialize state directly from props since we use 'key' in App.jsx to force remounts
    const [authMode, setAuthMode] = useState(initialMode);
    const [userRole, setUserRole] = useState(initialRole);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

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
                    // Registration success message
                } else {
                    await database.signUp(formData.email, formData.password, formData.fullName);
                    // Registration success message
                }
                setAuthMode('signin');
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
                className="fixed inset-0 z-[10000] flex items-center justify-center bg-white/95 backdrop-blur-sm p-3"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
            >
                <motion.div
                    className="relative w-full max-w-sm bg-white rounded-[20px] border border-slate-200 shadow-3xl overflow-hidden"
                    initial={{ scale: 0.98, opacity: 0, y: 10 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                >
                    <button onClick={onClose} className="absolute top-4 right-4 text-slate-500 hover:text-white transition-colors z-10">
                        <X size={16} />
                    </button>

                    <div className="p-6 flex flex-col relative text-center">
                        {/* Role Indicator Badge */}
                        <div className="flex justify-center mb-4">
                            <span className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-[0.2em] leading-none ${userRole === 'admin' ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20' : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/10'
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


                        <form onSubmit={handleSubmit} className="space-y-3 text-left">
                            {authMode === 'signup' && (
                                <>
                                    <div className="space-y-0.5">
                                        <label className="text-[8px] font-black uppercase tracking-widest text-slate-600 ml-1">Full Name</label>
                                        <div className="relative">
                                            <User className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-600" size={12} />
                                            <input
                                                type="text"
                                                required
                                                value={formData.fullName}
                                                onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                                                className="w-full bg-[#161C2C] border border-white/5 rounded-lg py-2 pl-9 pr-4 text-white text-[11px] focus:border-indigo-500 transition-all outline-none"
                                                placeholder="First and Last Name"
                                            />
                                        </div>
                                    </div>

                                    {userRole === 'admin' && (
                                        <div className="grid grid-cols-2 gap-2">
                                            <div className="space-y-0.5">
                                                <label className="text-[8px] font-black uppercase tracking-widest text-slate-600 ml-1">Company Name</label>
                                                <div className="relative">
                                                    <Building2 className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-600" size={12} />
                                                    <input
                                                        type="text"
                                                        required
                                                        value={formData.companyName}
                                                        onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                                                        className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 pl-9 pr-4 text-slate-900 text-[11px] focus:border-indigo-500 transition-all outline-none"
                                                        placeholder="Company Name"
                                                    />
                                                </div>
                                            </div>
                                            <div className="space-y-0.5">
                                                <label className="text-[8px] font-black uppercase tracking-widest text-slate-600 ml-1">Industry</label>
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
                                                        className="w-full bg-[#161C2C] border border-white/5 rounded-lg py-2 px-2 text-white text-[11px] focus:border-indigo-500 transition-all outline-none"
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
                                                            className="w-full bg-[#161C2C] border border-white/5 rounded-lg py-2 px-3 text-white text-[11px] focus:border-indigo-500 transition-all outline-none"
                                                        />
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}

                            <div className="space-y-0.5">
                                <label className="text-[8px] font-black uppercase tracking-widest text-slate-600 ml-1">Email Address</label>
                                <div className="relative">
                                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-600" size={12} />
                                    <input
                                        type="email"
                                        required
                                        value={formData.email}
                                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                        className="w-full bg-[#161C2C] border border-white/5 rounded-lg py-2 pl-9 pr-4 text-white text-[11px] focus:border-indigo-500 transition-all outline-none"
                                        placeholder="email@example.com"
                                    />
                                </div>
                            </div>

                            <div className="space-y-0.5">
                                <label className="text-[8px] font-black uppercase tracking-widest text-slate-600 ml-1">Password</label>
                                <div className="relative">
                                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-600" size={12} />
                                    <input
                                        type="password"
                                        required
                                        value={formData.password}
                                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 pl-9 pr-4 text-slate-900 text-[11px] focus:border-indigo-500 transition-all outline-none"
                                        placeholder="••••••••"
                                        minLength={6}
                                        autoComplete="current-password"
                                    />
                                </div>
                            </div>

                            <div className="pt-2">
                                <motion.button
                                    type="submit"
                                    className={`w-full text-white font-black text-[9px] uppercase tracking-[0.3em] py-3 rounded-lg shadow-xl transition-all flex items-center justify-center gap-2 group mb-4 disabled:opacity-50 ${userRole === 'admin' ? 'bg-amber-600 hover:bg-amber-500' : 'bg-indigo-600 hover:bg-indigo-500'
                                        }`}
                                    whileHover={{ y: -1 }}
                                    whileTap={{ scale: 0.99 }}
                                >
                                    {loading ? 'Processing...' : (authMode === 'signin' ? 'Sign In' : 'Create Account')}
                                    <ChevronRight size={10} className="group-hover:translate-x-1 transition-transform" />
                                </motion.button>

                                <div className="text-center">
                                    <p className="text-slate-600 text-[8px] font-black uppercase tracking-widest">
                                        {authMode === 'signin' ? "Need an account? " : 'Already have an account? '}
                                        <button
                                            type="button"
                                            onClick={() => setAuthMode(authMode === 'signin' ? 'signup' : 'signin')}
                                            className="text-slate-900 hover:text-indigo-600 underline decoration-slate-200 underline-offset-4 transition-colors ml-1"
                                        >
                                            {authMode === 'signin' ? 'Sign Up' : 'Sign In'}
                                        </button>
                                    </p>
                                </div>
                            </div>
                        </form>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
};

export default AuthModal;
