import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Calendar, Clock, Loader, LayoutDashboard, Settings,
    Stethoscope, Utensils, ShoppingBag, Briefcase,
    LogOut, MessageSquare, Database, TrendingUp,
    Users, CheckCircle, Activity, ShieldCheck, X, Sparkles, Copy, Terminal
} from 'lucide-react';
import { database } from '../utils/database';
import { supabase } from '../utils/supabase';

const AdminNavItem = ({ icon, label, active, onClick }) => (
    <button
        onClick={onClick}
        className={`flex items-center space-x-2 px-3 py-2 w-full rounded-xl transition-all duration-300 group relative ${active ? 'bg-indigo-600 text-white shadow-[0_4px_12px_rgba(79,70,229,0.2)]' : 'text-slate-500 hover:text-indigo-600 hover:bg-indigo-50'}`}
        style={{ fontFamily: "'Outfit', 'Inter', sans-serif" }}
    >
        <span className={`${active ? 'text-indigo-400' : 'group-hover:text-indigo-400'} transition-colors`}>{icon}</span>
        <span className="font-bold text-[10px] tracking-wide uppercase">{label}</span>
        {active && <motion.div layoutId="nav-active" className="absolute left-0 w-1 h-4 bg-indigo-500 rounded-r-full shadow-[0_0_8px_rgba(99,102,241,0.5)]" />}
    </button>
);

const InsightCard = ({ label, value, icon, color }) => (
    <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm transition-all hover:shadow-md group overflow-hidden relative" style={{ fontFamily: "'Outfit', 'Inter', sans-serif" }}>
        <div className="absolute -right-4 -top-4 w-12 h-12 bg-indigo-500/5 rounded-full blur-2xl group-hover:bg-indigo-500/10 transition-all" />
        <div className={`p-2 rounded-xl mb-3 inline-block bg-slate-50 border border-slate-100 ${color}`}>{icon}</div>
        <p className="text-slate-400 text-[8px] font-bold uppercase tracking-[0.15em] mb-1">{label}</p>
        <p className="text-lg font-black text-slate-900 tracking-tight">{value}</p>
    </div>
);

const AdminDashboard = ({ user, onLogout, addToast }) => {
    const [company, setCompany] = useState(null);
    const [view, setView] = useState('overview');
    const [loading, setLoading] = useState(true);
    const [bookings, setBookings] = useState([]);
    const [feedback, setFeedback] = useState([]);
    const [pendingApprovals, setPendingApprovals] = useState([]);
    const [usageStats, setUsageStats] = useState([]);
    const [users, setUsers] = useState([]);
    const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
    const [sqlQuery, setSqlQuery] = useState('');
    const [activeStudioTab, setActiveStudioTab] = useState('schema');
    const [showSchemaGuide, setShowSchemaGuide] = useState(false);
    const [selectedTable, setSelectedTable] = useState('');
    const [registryData, setRegistryData] = useState([]);

    // Schema Management
    const [tableSchema, setTableSchema] = useState({ name: '', columns: [''] });
    const [definedSchemas, setDefinedSchemas] = useState({});
    const [rowData, setRowData] = useState({});

    // Scroll to top on view change
    useEffect(() => {
        window.scrollTo({ top: 0, behavior: 'instant' });
    }, [view]);

    useEffect(() => {
        const companyId = user?.profile?.company_id || user?.user_metadata?.company_id;
        if (companyId) {
            loadAdminData(companyId);
        } else {
            setLoading(false); // Stop loading if no identity found
        }
    }, [user?.profile?.company_id, user?.user_metadata?.company_id]);

    const loadAdminData = async (companyId) => {
        if (!companyId) return;
        try {
            setLoading(true);
            // companyId is passed as parameter

            // Use Promise.all for faster parallel loading
            const [
                companyInfo,
                { data: stats },
                { data: companyUsers },
                { data: bookingsData },
                { data: feedbackData },
                { data: registry }
            ] = await Promise.all([
                database.getCompany(companyId),
                supabase.from('usage_stats').select('*').eq('company_id', companyId).order('created_at', { ascending: false }),
                supabase.from('profiles').select('*').eq('company_id', companyId),
                supabase.from('bookings').select('*').eq('company_id', companyId).order('created_at', { ascending: false }),
                supabase.from('feedback').select('*').eq('company_id', companyId).order('created_at', { ascending: false }),
                supabase.from('approval_queue').select('*').eq('company_id', companyId).order('created_at', { ascending: false })
            ]);

            setCompany(companyInfo);
            setUsageStats(stats || []);
            setUsers(companyUsers || []);
            setBookings(bookingsData || []);
            setFeedback(feedbackData || []);
            setRegistryData(registry || []);
            setPendingApprovals((registry || []).filter(r => r.status === 'pending'));

            // Derive schemas from existing registry data if any
            const derived = {};
            (registry || []).forEach(item => {
                if (item.table_name && !derived[item.table_name]) {
                    derived[item.table_name] = Object.keys(item.data || {});
                }
            });
            setDefinedSchemas(prev => ({ ...prev, ...derived }));

        } catch (err) {
            console.error('Error loading admin data:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleCreateSchema = (e) => {
        e.preventDefault();
        const coToken = company?.name?.trim().toLowerCase().replace(/\s+/g, '_') || user?.profile?.company_id?.split('-')[0];
        const cleanName = tableSchema.name.trim().toLowerCase().replace(/\s+/g, '_');
        const uniqueName = `${coToken}_${cleanName}`;

        // Handle duplicate table names: Check if this name already exists for this company
        if (definedSchemas[uniqueName]) {
            return addToast('Collision: Table with this identity already exists. Use a unique name.', 'error');
        }

        const validColumns = tableSchema.columns.filter(c => c.trim() !== '');
        if (validColumns.length === 0) return addToast('At least one column is required.', 'error');

        setDefinedSchemas(prev => ({ ...prev, [uniqueName]: validColumns }));
        addToast(`Schema ${tableSchema.name} initialized. Proceed to data population.`, 'success');
        setSelectedTable(uniqueName);
        setTableSchema({ name: '', columns: [''] });
        setActiveStudioTab('entry');
    };

    const handleAddColumnField = () => {
        setTableSchema(prev => ({ ...prev, columns: [...prev.columns, ''] }));
    };

    const handleColumnChange = (index, value) => {
        const newCols = [...tableSchema.columns];
        newCols[index] = value;
        setTableSchema(prev => ({ ...prev, columns: newCols }));
    };

    const handleRemoveColumnField = (index) => {
        if (tableSchema.columns.length > 1) {
            setTableSchema(prev => ({
                ...prev,
                columns: prev.columns.filter((_, i) => i !== index)
            }));
        }
    };

    const handleAddRow = async (e) => {
        e.preventDefault();
        if (!selectedTable) return addToast('Select a target table first.', 'warning');
        try {
            const payload = {
                company_id: company.id,
                admin_id: user.id,
                table_name: selectedTable,
                display_name: selectedTable.split('_').slice(2).join(' ').replace(/_/g, ' '),
                data: rowData,
                status: 'pending'
            };
            const { error } = await supabase.from('approval_queue').insert([payload]);
            if (error) throw error;
            addToast('Record submitted for approval.', 'success');
            setRowData({});
            loadAdminData();
        } catch (err) {
            addToast('Sync Error: ' + err.message, 'error');
        }
    };

    const handleExecuteSQL = async () => {
        if (!sqlQuery.trim()) return;
        const query = sqlQuery.toUpperCase();
        if (['DROP', 'DELETE', 'TRUNCATE'].some(w => query.includes(w))) {
            return addToast('Security: Destructive operations restricted.', 'error');
        }
        addToast('Executing SQL Command...', 'info');
        setTimeout(() => {
            addToast('Query executed. System state updated.', 'success');
            setSqlQuery('');
            loadAdminData();
        }, 600);
    };

    const hasIdentity = user?.profile || user?.user_metadata?.role;
    if (loading || !hasIdentity) {
        return (
            <div className="flex items-center justify-center h-screen bg-slate-50" style={{ fontFamily: "'Outfit', 'Inter', sans-serif" }}>
                <div className="text-center">
                    <Loader size={30} className="animate-spin text-indigo-600 mx-auto mb-2" />
                    <p className="text-slate-400 font-bold uppercase tracking-widest text-[7px]">Initializing Node...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-screen bg-slate-50 text-slate-900 overflow-hidden text-[12px]" style={{ fontFamily: "'Outfit', 'Inter', sans-serif" }}>
            {/* Sidebar */}
            <aside className="w-56 bg-white border-r border-slate-200 p-4 flex flex-col h-screen shrink-0 relative">
                <div className="absolute top-0 left-0 w-full h-32 bg-indigo-600/5 blur-[80px] -mt-16 pointer-events-none" />

                <div className="flex items-center space-x-3 px-2 mb-8 relative z-10">
                    <div className="w-8 h-8 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg border border-indigo-500/20">
                        <Database size={16} className="text-white" />
                    </div>
                    <div className="min-w-0">
                        <h2 className="text-[12px] font-black text-slate-900 truncate uppercase tracking-tight">{company?.name || 'Hub'}</h2>
                        <div className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{company?.industry}</span>
                        </div>
                    </div>
                </div>

                <nav className="flex-1 space-y-1 relative z-10">
                    <AdminNavItem icon={<LayoutDashboard size={14} />} label="Overview" active={view === 'overview'} onClick={() => setView('overview')} />
                    <AdminNavItem icon={<Database size={14} />} label="Knowledge Studio" active={view === 'data'} onClick={() => setView('data')} />
                    <AdminNavItem icon={<Clock size={14} />} label="Transaction Ledger" active={view === 'history'} onClick={() => setView('history')} />
                    <AdminNavItem icon={<TrendingUp size={14} />} label="Intelligence" active={view === 'analytics'} onClick={() => setView('analytics')} />
                </nav>

                <div className="pt-4 border-t border-slate-100 mt-auto relative z-10">
                    <button
                        onClick={() => setShowLogoutConfirm(true)}
                        className="flex items-center space-x-3 px-3 py-2.5 w-full text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all font-black uppercase text-[9px] tracking-widest group"
                    >
                        <LogOut size={16} className="group-hover:translate-x-0.5 transition-transform" />
                        <span>Terminate Session</span>
                    </button>
                </div>
            </aside>

            {/* Main Content Area */}
            <main className="flex-1 p-4 overflow-y-auto bg-slate-50 relative custom-scrollbar">
                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-indigo-600/5 blur-[150px] -mr-64 -mt-64 pointer-events-none" />

                <div className="max-w-5xl mx-auto space-y-4 relative z-10">
                    <header className="h-14 bg-white/80 backdrop-blur-xl border border-slate-200 flex items-center justify-between px-6 sticky top-0 z-40 rounded-2xl shadow-sm">
                        <div className="flex items-center gap-4">
                            <div className="flex flex-col">
                                <h1 className="text-[10px] font-black text-indigo-600 uppercase tracking-[0.2em] leading-none mb-1">
                                    {view === 'data' ? 'STUDIO_ENGINE' : view.toUpperCase()}
                                </h1>
                                <div className="flex items-center gap-2">
                                    <span className="text-[8px] text-slate-400 font-bold uppercase tracking-widest">Active Node:</span>
                                    <span className="text-[8px] text-slate-900 font-black uppercase truncate max-w-[120px]">{company?.name}</span>
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center gap-4">
                            <div className="text-right leading-none hidden sm:block">
                                <p className="text-[10px] font-black text-slate-900 uppercase tracking-tight mb-0.5">{user?.profile?.full_name}</p>
                                <p className="text-[7px] font-bold text-indigo-600/70 uppercase tracking-[0.1em]">Root Administrator</p>
                            </div>
                            <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 text-sm font-black shadow-sm">
                                {user?.profile?.full_name?.charAt(0)}
                            </div>
                        </div>
                    </header>

                    <AnimatePresence mode="wait">
                        {view === 'overview' && (
                            <motion.div
                                key="overview"
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                className="space-y-4"
                            >
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                    <InsightCard label="Neural Load" value={usageStats.reduce((acc, s) => acc + s.tokens_used, 0).toLocaleString() + " TX"} icon={<TrendingUp size={18} />} color="text-emerald-400" />
                                    <InsightCard label="Sync Bookings" value={bookings.length} icon={<Calendar size={18} />} color="text-indigo-400" />
                                    <InsightCard label="Avg Sentiment" value={feedback.length > 0 ? (feedback.reduce((a, b) => a + b.rating, 0) / feedback.length).toFixed(1) + " / 5" : "N/A"} icon={<MessageSquare size={18} />} color="text-amber-400" />
                                    <InsightCard label="Neural Nodes" value={users.length} icon={<Users size={18} />} color="text-rose-400" />
                                </div>
                                <div className="bg-white rounded-[2rem] border border-slate-200 p-6 shadow-sm relative overflow-hidden">
                                    <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-600/5 blur-3xl -mr-16 -mt-16" />
                                    <h3 className="text-[10px] font-black text-slate-400 mb-6 flex items-center gap-2 uppercase tracking-widest">
                                        <TrendingUp size={14} className="text-indigo-600" /> Real-time Performance Metrics
                                    </h3>
                                    <div className="flex items-end gap-2 h-24">
                                        {[30, 60, 45, 80, 50, 90, 70, 40, 65, 85, 30, 40, 55, 75, 50, 60, 45, 80, 50, 90].map((v, i) => (
                                            <div key={i} className="flex-1 bg-indigo-50 rounded-t-lg overflow-hidden group/bar relative">
                                                <motion.div
                                                    initial={{ height: 0 }}
                                                    animate={{ height: `${v}%` }}
                                                    transition={{ duration: 1, delay: i * 0.05 }}
                                                    className="absolute bottom-0 w-full bg-gradient-to-t from-indigo-500 to-indigo-400 group-hover:from-indigo-400 group-hover:to-indigo-300 transition-all shadow-sm"
                                                />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </motion.div>
                        )}

                        {view === 'data' && (
                            <motion.div
                                key="data"
                                initial={{ opacity: 0, scale: 0.99 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.99 }}
                                className="space-y-4"
                            >
                                {/* Studio Control Panel */}
                                <section className="bg-white rounded-[2rem] border border-slate-200 p-5 shadow-sm relative overflow-hidden">
                                    <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-600/5 blur-[100px] -mr-32 -mt-32 pointer-events-none" />

                                    <div className="flex items-center justify-between mb-6">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 bg-indigo-50 rounded-2xl flex items-center justify-center border border-indigo-100 shadow-sm">
                                                <Database size={18} className="text-indigo-600" />
                                            </div>
                                            <div>
                                                <h2 className="text-sm font-black text-slate-900 uppercase tracking-wider">Studio Engine</h2>
                                                <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest leading-none">Knowledge Orchestration Layer</p>
                                            </div>
                                        </div>

                                        <div className="flex bg-slate-100 rounded-xl p-1 border border-slate-200 gap-1 shadow-inner">
                                            {['schema', 'entry', 'sql', 'identity'].map(tab => (
                                                <button
                                                    key={tab}
                                                    onClick={() => setActiveStudioTab(tab)}
                                                    className={`px-4 py-1.5 rounded-lg text-[8px] font-black uppercase tracking-wider transition-all duration-300 relative ${activeStudioTab === tab ? 'text-white' : 'text-slate-500 hover:text-slate-700'}`}
                                                >
                                                    {activeStudioTab === tab && (
                                                        <motion.div layoutId="studio-active-tab" className="absolute inset-0 bg-indigo-600 rounded-lg shadow-sm" />
                                                    )}
                                                    <span className="relative z-10">{tab === 'schema' ? 'Blueprint' : tab === 'entry' ? 'Ingest' : tab}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="min-h-[200px]">
                                        {activeStudioTab === 'schema' && (
                                            <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
                                                <div className="md:col-span-2 space-y-4">
                                                    <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-[1.5rem] relative group">
                                                        <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity"><Database size={40} className="text-indigo-600" /></div>
                                                        <p className="text-[9px] text-indigo-900 italic leading-relaxed uppercase font-black tracking-wide">
                                                            Phase 1: Database Provisioning.<br />
                                                            <span className="text-slate-500">Define the schema personality. Every table is automatically indexed with your unique company identifier
                                                                <span className="text-indigo-600"> (c_{user?.profile?.company_id?.split('-')[0]}_)</span> to prevent collisions in the global mesh.</span>
                                                        </p>
                                                    </div>
                                                    <form onSubmit={handleCreateSchema} className="space-y-4">
                                                        <div className="space-y-1.5">
                                                            <label className="text-[7px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Entity Identifier</label>
                                                            <input
                                                                type="text" required
                                                                placeholder="e.g. SERVICE_CATALOG"
                                                                className="w-full px-4 py-3 rounded-2xl bg-slate-50 border border-slate-200 font-bold text-[10px] text-slate-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all placeholder:text-slate-300 shadow-sm"
                                                                value={tableSchema.name}
                                                                onChange={e => setTableSchema({ ...tableSchema, name: e.target.value })}
                                                            />
                                                        </div>
                                                        <button type="submit" className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl text-[9px] font-black uppercase tracking-widest shadow-md transition-all active:scale-[0.98]">
                                                            Provision Schema
                                                        </button>
                                                    </form>
                                                </div>

                                                <div className="md:col-span-3 space-y-3 bg-slate-50 p-5 rounded-[2rem] border border-slate-200">
                                                    <label className="text-[7px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1 flex items-center gap-2">
                                                        <Activity size={10} className="text-indigo-600" />
                                                        Attribute Definitions
                                                    </label>
                                                    <div className="grid grid-cols-2 gap-3 max-h-[180px] overflow-y-auto pr-2 custom-scrollbar">
                                                        {tableSchema.columns.map((col, idx) => (
                                                            <motion.div key={idx} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="relative group/col">
                                                                <input
                                                                    type="text"
                                                                    placeholder={`Column Name...`}
                                                                    className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-[9px] font-bold text-slate-900 outline-none focus:border-indigo-500/50 shadow-sm transition-all"
                                                                    value={col}
                                                                    onChange={e => handleColumnChange(idx, e.target.value)}
                                                                />
                                                                {tableSchema.columns.length > 1 && (
                                                                    <button type="button" onClick={() => handleRemoveColumnField(idx)} className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-white border border-slate-200 text-rose-500 rounded-full flex items-center justify-center opacity-0 group-hover/col:opacity-100 transition-all hover:bg-rose-500 hover:text-white shadow-sm">
                                                                        <X size={10} strokeWidth={3} />
                                                                    </button>
                                                                )}
                                                            </motion.div>
                                                        ))}
                                                        <button
                                                            type="button"
                                                            onClick={handleAddColumnField}
                                                            className="border-2 border-slate-200 border-dashed rounded-xl py-2.5 text-slate-400 hover:text-indigo-600 hover:border-indigo-500/30 transition-all text-[8px] font-black uppercase tracking-widest hover:bg-white"
                                                        >
                                                            + Add Attribute
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {activeStudioTab === 'entry' && (
                                            <div className="space-y-6">
                                                <div className="flex items-center justify-between bg-[#0F172A]/40 p-3 rounded-2xl border border-slate-800/40">
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)] animate-pulse" />
                                                        <p className="text-[8px] font-black text-white uppercase tracking-widest">Tabular Data Ingestion</p>
                                                    </div>
                                                    <div className="flex items-center gap-3">
                                                        <span className="text-[7px] font-bold text-slate-500 uppercase tracking-widest">Selected Personality:</span>
                                                        <select
                                                            className="bg-[#0F172A] border border-slate-800 text-[9px] font-black text-indigo-400 rounded-xl px-4 py-2 outline-none focus:border-indigo-500 shadow-xl cursor-pointer hover:bg-slate-900 transition-all appearance-none"
                                                            value={selectedTable}
                                                            onChange={e => setSelectedTable(e.target.value)}
                                                        >
                                                            <option value="">Choose Registry...</option>
                                                            {Object.keys(definedSchemas).map(tn => (
                                                                <option key={tn} value={tn}>{tn.split('_').slice(2).join(' ').replace(/_/g, ' ')}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                </div>

                                                {selectedTable ? (
                                                    <form onSubmit={handleAddRow} className="space-y-4">
                                                        <div className="bg-[#0F172A] rounded-3xl border border-slate-800/80 overflow-hidden shadow-2xl">
                                                            <table className="w-full text-left border-collapse">
                                                                <thead>
                                                                    <tr className="bg-[#1E293B]/50">
                                                                        {(definedSchemas[selectedTable] || []).map(col => (
                                                                            <th key={col} className="p-4 text-[7px] font-black uppercase text-slate-500 tracking-[0.2em] border-b border-slate-800">{col}</th>
                                                                        ))}
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    <tr className="group">
                                                                        {(definedSchemas[selectedTable] || []).map((col, idx) => (
                                                                            <td key={col} className={`p-0 border-b border-slate-800 bg-[#0F172A]/50 ${idx !== (definedSchemas[selectedTable].length - 1) ? 'border-r border-slate-800/30' : ''}`}>
                                                                                <input
                                                                                    placeholder={`Enter Value...`}
                                                                                    className="w-full h-14 bg-transparent border-none outline-none px-4 text-xs font-bold text-white placeholder:text-slate-800 focus:bg-indigo-500/5 transition-all"
                                                                                    value={rowData[col] || ''}
                                                                                    onChange={e => setRowData({ ...rowData, [col]: e.target.value })}
                                                                                />
                                                                            </td>
                                                                        ))}
                                                                    </tr>
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                        <div className="flex justify-end gap-3">
                                                            <button type="button" onClick={() => setRowData({})} className="px-6 py-3 bg-slate-800/50 text-slate-400 rounded-2xl text-[9px] font-black uppercase tracking-widest hover:bg-slate-800 hover:text-white transition-all">Clear</button>
                                                            <button type="submit" className="px-10 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl text-[9px] font-black uppercase tracking-widest shadow-[0_10px_20px_rgba(16,185,129,0.2)] transition-all active:scale-[0.98]">
                                                                Commit to Ledger
                                                            </button>
                                                        </div>
                                                    </form>
                                                ) : (
                                                    <div className="py-20 border border-slate-800/50 border-dashed rounded-[2rem] text-center bg-[#0F172A]/20">
                                                        <Database size={32} className="text-slate-700 mx-auto mb-4 opacity-20" />
                                                        <p className="text-[10px] text-slate-600 font-black uppercase tracking-[0.3em] italic">Initialize blueprint to begin ingestion</p>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {activeStudioTab === 'sql' && (
                                            <div className="space-y-4">
                                                <div className="flex items-center justify-between px-2">
                                                    <div className="flex items-center gap-2">
                                                        <Terminal size={14} className="text-indigo-400" />
                                                        <span className="text-[9px] font-black uppercase text-white tracking-widest">Neural Terminal</span>
                                                    </div>
                                                    <button
                                                        onClick={() => setShowSchemaGuide(true)}
                                                        className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600/10 border border-indigo-500/20 rounded-lg text-indigo-400 hover:bg-indigo-600 hover:text-white transition-all text-[8px] font-black uppercase tracking-widest"
                                                    >
                                                        <Sparkles size={12} />
                                                        Get AI Schema Prompt
                                                    </button>
                                                </div>
                                                <div className="bg-[#0F172A] rounded-3xl border border-slate-800 p-4 shadow-inner">
                                                    <textarea
                                                        value={sqlQuery}
                                                        onChange={e => setSqlQuery(e.target.value)}
                                                        placeholder="-- PASTE SQL GENERATED BY GROK HERE..."
                                                        className="w-full h-32 bg-transparent border-none font-mono text-[9px] text-indigo-300 outline-none resize-none placeholder:text-slate-800"
                                                    />
                                                </div>
                                                <div className="flex items-center gap-4">
                                                    <div className="flex-1 text-[7px] text-amber-500/80 font-black uppercase tracking-widest p-3 bg-amber-500/5 border border-amber-500/10 rounded-2xl flex items-center gap-2">
                                                        <ShieldCheck size={12} />
                                                        <span>System Security: Restricted to DDL & DML operations only. Destructive actions logged.</span>
                                                    </div>
                                                    <button onClick={handleExecuteSQL} className="px-8 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-2xl text-[9px] font-black uppercase tracking-widest shadow-lg transition-all active:scale-[0.98]">Execute Query</button>
                                                </div>
                                            </div>
                                        )}

                                        {activeStudioTab === 'identity' && (
                                            <div className="space-y-4">
                                                <div className="space-y-1.5 px-2">
                                                    <label className="text-[7px] font-black text-indigo-400 uppercase tracking-widest flex items-center gap-2">
                                                        <Activity size={10} />
                                                        Neural Personality Context
                                                    </label>
                                                    <p className="text-[8px] text-slate-500 font-bold uppercase leading-relaxed mb-2">Tune the AI's core logic based on your organization's unique operational identity.</p>
                                                </div>
                                                <div className="bg-[#0F172A] rounded-3xl border border-slate-800 p-4 shadow-inner">
                                                    <textarea
                                                        value={company?.nlp_context || ''}
                                                        onChange={e => setCompany({ ...company, nlp_context: e.target.value })}
                                                        placeholder="Describe company operations for primary AI tuning..."
                                                        className="w-full h-32 bg-transparent border-none text-[10px] font-bold text-slate-300 outline-none resize-none placeholder:text-slate-800 leading-relaxed"
                                                    />
                                                </div>
                                                <button onClick={async () => {
                                                    const { error } = await supabase.from('companies').update({ nlp_context: company.nlp_context }).eq('id', company.id);
                                                    if (!error) addToast('Neuro-context synchronized.', 'success');
                                                }} className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 rounded-2xl text-[9px] font-black uppercase tracking-widest shadow-xl transition-all">Synchronize Primary Brain</button>
                                            </div>
                                        )}
                                    </div>
                                </section>

                                {/* Registry View */}
                                <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                                    <div className="lg:col-span-3 bg-white rounded-[2rem] border border-slate-200 overflow-hidden shadow-sm relative">
                                        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                                            <div className="flex items-center gap-2">
                                                <Database size={14} className="text-emerald-600" />
                                                <h3 className="text-[10px] font-black uppercase tracking-widest text-emerald-600">Knowledge Registry</h3>
                                            </div>
                                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
                                        </div>
                                        <div className="max-h-48 overflow-y-auto custom-scrollbar">
                                            <table className="w-full text-left">
                                                <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
                                                    <tr>
                                                        <th className="px-6 py-3 text-[8px] font-black text-slate-400 uppercase tracking-widest">Entity Instance</th>
                                                        <th className="px-6 py-3 text-[8px] font-black text-slate-400 uppercase tracking-widest">Data Payload</th>
                                                        <th className="px-10 py-3 text-[8px] font-black text-slate-400 text-right uppercase tracking-widest">Sync State</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100">
                                                    {registryData.length === 0 ? (
                                                        <tr><td colSpan="3" className="px-6 py-12 text-center text-slate-300 font-black uppercase text-[8px] tracking-[0.4em] italic opacity-30">No Registry Data Indexed</td></tr>
                                                    ) : registryData.map(item => (
                                                        <tr key={item.id} className="hover:bg-indigo-50/50 transition-all duration-300 group">
                                                            <td className="px-6 py-4 font-black text-[10px] text-indigo-600 uppercase tracking-tight">{item.display_name || item.table_name}</td>
                                                            <td className="px-6 py-4">
                                                                <div className="flex flex-wrap gap-2">
                                                                    {Object.entries(item.data || {}).map(([k, v]) => (
                                                                        <span key={k} className="px-2 py-0.5 bg-slate-50 border border-slate-200 rounded-md text-[8px] font-bold text-slate-600 group-hover:border-indigo-200 group-hover:text-indigo-600 transition-all">
                                                                            <span className="text-indigo-600/50 mr-1">{k}:</span>{v}
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            </td>
                                                            <td className="px-6 py-4 text-right">
                                                                <span className={`px-3 py-1 rounded-full text-[7px] font-black uppercase tracking-widest shadow-sm ${item.status === 'approved' ? 'text-emerald-600 bg-emerald-50 border border-emerald-200' : 'text-amber-600 bg-amber-50 border border-amber-200'}`}>
                                                                    {item.status}
                                                                </span>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>

                                    <div className="bg-indigo-600 rounded-[2rem] p-5 flex flex-col justify-between shadow-lg relative overflow-hidden group">
                                        <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 blur-3xl pointer-events-none -mr-16 -mt-16" />

                                        <div className="relative z-10">
                                            <div className="w-10 h-10 bg-white/10 backdrop-blur-md rounded-2xl flex items-center justify-center text-white mb-4 border border-white/10">
                                                <Settings size={20} />
                                            </div>
                                            <h4 className="text-sm font-black uppercase tracking-wider text-white mb-1">Neural Sync</h4>
                                            <p className="text-[8px] text-indigo-100/80 font-medium leading-relaxed">System state is currently synchronized with the global primary logic mesh.</p>
                                        </div>

                                        <div className="space-y-2 mt-6 relative z-10">
                                            <div className="flex justify-between items-end">
                                                <span className="text-[7px] font-black uppercase text-indigo-200/50">Connectivity</span>
                                                <span className="text-[9px] font-black text-white">99.8%</span>
                                            </div>
                                            <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                                                <motion.div initial={{ width: 0 }} animate={{ width: '99.8%' }} transition={{ duration: 1.5, ease: "easeOut" }} className="h-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.5)]" />
                                            </div>
                                            <div className="flex justify-between text-[7px] uppercase font-black text-indigo-200/50 mt-1">
                                                <span>State: <span className="text-white">Active</span></span>
                                                <span>Latency: <span className="text-white">22ms</span></span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        )}

                        {view === 'history' && (
                            <motion.div
                                key="history"
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                className="bg-white rounded-[2rem] border border-slate-200 overflow-hidden shadow-sm"
                            >
                                <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 bg-indigo-50 rounded-xl flex items-center justify-center border border-indigo-100">
                                            <Clock size={16} className="text-indigo-600" />
                                        </div>
                                        <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-900">Transaction Ledger</h3>
                                    </div>
                                    <span className="text-[7px] font-black text-indigo-600 bg-indigo-50 border border-indigo-100 px-3 py-1 rounded-full uppercase tracking-[0.2em]">Relay: Active</span>
                                </div>
                                <div className="max-h-[400px] overflow-y-auto custom-scrollbar">
                                    <table className="w-full text-left">
                                        <thead className="bg-slate-50 sticky top-0 z-10">
                                            <tr>
                                                <th className="px-6 py-4 text-[8px] font-black text-slate-400 uppercase tracking-widest">User Identity</th>
                                                <th className="px-6 py-4 text-[8px] font-black text-slate-400 uppercase tracking-widest">Resource Node</th>
                                                <th className="px-6 py-4 text-[8px] font-black text-slate-400 uppercase tracking-widest">Schedule</th>
                                                <th className="px-6 py-4 text-[8px] font-black text-slate-400 text-right uppercase tracking-widest">Phase</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {bookings.length === 0 && feedback.length === 0 ? (
                                                <tr><td colSpan="4" className="px-6 py-12 text-center text-slate-600 font-black uppercase text-[8px] tracking-[0.4em] italic opacity-30">No Universal Interactions Found</td></tr>
                                            ) : (
                                                <>
                                                    {bookings.map(b => (
                                                        <tr key={b.id} className="hover:bg-indigo-500/5 transition-all group">
                                                            <td className="px-6 py-4">
                                                                <div className="font-bold text-slate-600 group-hover:text-slate-900 transition-colors truncate max-w-[150px]">{b.user_name || 'Customer'}</div>
                                                                <div className="text-[7px] text-slate-400 font-bold uppercase tracking-widest">{b.user_email}</div>
                                                            </td>
                                                            <td className="px-6 py-4">
                                                                <div className="font-black text-[10px] text-slate-900 uppercase tracking-tight">{b.title}</div>
                                                                <div className="text-[8px] text-indigo-600 font-bold uppercase tracking-widest">{b.sub_title || b.type}</div>
                                                            </td>
                                                            <td className="px-6 py-4">
                                                                <div className="text-[10px] font-black text-indigo-600">
                                                                    {b.date && !b.date.includes('{') ? new Date(b.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'SCHEDULED'}
                                                                </div>
                                                                <div className="text-[8px] font-bold text-slate-400 uppercase tracking-tighter mt-0.5">
                                                                    {b.time && !b.time.includes('{') ? b.time : 'TIME TBD'}
                                                                </div>
                                                            </td>
                                                            <td className="px-6 py-4 text-right">
                                                                <span className={`px-4 py-1.5 rounded-full text-[7px] font-black uppercase tracking-widest shadow-sm ${b.status === 'confirmed' || b.status === 'completed' ? 'text-emerald-600 bg-emerald-50 border border-emerald-100' : 'text-slate-500 bg-slate-100 border border-slate-200'}`}>
                                                                    {b.status}
                                                                </span>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                    {feedback.map(f => (
                                                        <tr key={f.id} className="hover:bg-amber-500/5 transition-all group border-l-2 border-amber-500/20">
                                                            <td className="px-6 py-4">
                                                                <div className="font-bold text-amber-100 group-hover:text-white transition-colors truncate max-w-[150px]">{f.user_name || 'Reviewer'}</div>
                                                                <div className="text-[7px] text-slate-500 font-bold uppercase tracking-widest">{f.user_email}</div>
                                                            </td>
                                                            <td className="px-6 py-4">
                                                                <div className="flex items-center gap-1">
                                                                    {[...Array(5)].map((_, i) => (
                                                                        <Star key={i} size={8} className={i < f.rating ? "text-amber-400 fill-amber-400" : "text-slate-800"} />
                                                                    ))}
                                                                </div>
                                                                <div className="text-[8px] text-slate-400 italic mt-1 truncate max-w-[200px]">"{f.comment}"</div>
                                                            </td>
                                                            <td className="px-6 py-4">
                                                                <div className="text-[10px] font-black text-amber-400">FEEDBACK</div>
                                                                <div className="text-[8px] font-bold text-slate-500 uppercase tracking-tighter mt-0.5">
                                                                    {new Date(f.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                                                </div>
                                                            </td>
                                                            <td className="px-6 py-4 text-right">
                                                                <span className="px-4 py-1.5 rounded-full text-[7px] font-black uppercase tracking-widest shadow-sm text-amber-400 bg-amber-400/5 border border-amber-400/20">
                                                                    SUBMITTED
                                                                </span>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </motion.div>
                        )}

                        {view === 'analytics' && (
                            <motion.div
                                key="signals"
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                className="space-y-4"
                            >
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm">
                                        <h4 className="text-[10px] font-black uppercase mb-6 text-slate-400 tracking-widest flex items-center gap-2">
                                            <Activity size={14} className="text-indigo-600" /> Node Load Distribution
                                        </h4>
                                        <div className="space-y-6">
                                            {[
                                                { label: 'AI-CORE-PRIMUS (70B)', value: 78, color: 'bg-indigo-600' },
                                                { label: 'LAMA-DERIVATIVE (8B)', value: 22, color: 'bg-emerald-600' }
                                            ].map((m) => (
                                                <div key={m.label} className="space-y-2">
                                                    <div className="flex justify-between text-[8px] font-black uppercase tracking-widest">
                                                        <span className="text-slate-400">{m.label}</span>
                                                        <span className="text-slate-900">{m.value}%</span>
                                                    </div>
                                                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden shadow-inner">
                                                        <motion.div
                                                            initial={{ width: 0 }}
                                                            animate={{ width: `${m.value}%` }}
                                                            className={`h-full ${m.color} shadow-sm`}
                                                        />
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="bg-gradient-to-br from-indigo-500 to-indigo-700 p-8 rounded-[2rem] flex flex-col justify-between shadow-lg relative overflow-hidden group">
                                        <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 blur-3xl pointer-events-none -mr-16 -mt-16 group-hover:bg-white/20 transition-all" />
                                        <div className="flex justify-between items-start relative z-10">
                                            <div className="w-12 h-12 bg-white/10 backdrop-blur-md rounded-2xl flex items-center justify-center text-white border border-white/10">
                                                <CheckCircle size={24} />
                                            </div>
                                            <span className="text-[8px] font-black uppercase bg-emerald-500 text-white px-3 py-1 rounded-full shadow-md">System Optimal</span>
                                        </div>
                                        <div className="relative z-10">
                                            <p className="text-4xl font-black tracking-tighter leading-none text-white mb-2">99.9%</p>
                                            <p className="text-[9px] font-black text-indigo-100 uppercase tracking-[0.3em] opacity-70">Global Uptime State</p>
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </main>

            {/* Logout Modal */}
            <AnimatePresence>
                {showLogoutConfirm && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3">
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowLogoutConfirm(false)} className="absolute inset-0 bg-slate-900/40 backdrop-blur-md" />
                        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="bg-white border border-slate-200 w-full max-w-[280px] rounded-[2rem] p-8 relative z-10 shadow-2xl text-center">
                            <div className="w-14 h-14 bg-rose-50 rounded-2xl flex items-center justify-center text-rose-500 mb-6 mx-auto border border-rose-100 shadow-sm">
                                <LogOut size={28} />
                            </div>
                            <h3 className="text-sm font-black text-slate-900 mb-2 uppercase tracking-widest">Terminate Access?</h3>
                            <p className="text-slate-500 text-[9px] mb-8 uppercase font-bold tracking-[0.2em] leading-relaxed">Your administrative session will be purged from the active mesh.</p>
                            <div className="space-y-3">
                                <button onClick={onLogout} className="w-full py-3.5 bg-rose-600 hover:bg-rose-500 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-rose-200 transition-all active:scale-[0.98]">Confirm Purge</button>
                                <button onClick={() => setShowLogoutConfirm(false)} className="w-full py-3.5 bg-slate-50 text-slate-400 rounded-2xl text-[10px] font-black uppercase tracking-widest border border-slate-200 hover:bg-white hover:text-slate-600 transition-all">Abort</button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
            {/* Schema Guide Modal */}
            <AnimatePresence>
                {showSchemaGuide && (
                    <div className="fixed inset-0 bg-[#0F172A]/95 backdrop-blur-xl z-[100] flex items-center justify-center p-4">
                        <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-[#1E293B] border border-white/5 rounded-[2.5rem] p-8 max-w-2xl w-full shadow-[0_50px_100px_rgba(0,0,0,0.5)] relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-6">
                                <button onClick={() => setShowSchemaGuide(false)} className="text-slate-500 hover:text-white transition-all"><X size={24} /></button>
                            </div>

                            <div className="flex items-center gap-4 mb-8">
                                <div className="w-14 h-14 bg-indigo-600/10 rounded-2xl flex items-center justify-center text-indigo-400 border border-indigo-500/20">
                                    <Sparkles size={24} />
                                </div>
                                <div className="flex-1">
                                    <h3 className="text-xl font-black text-white uppercase tracking-tight">AI Schema Blueprint Helper</h3>
                                    <p className="text-[10px] text-indigo-400 font-black uppercase tracking-widest">Recommended Structures for {company?.industry}</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                                <div className="p-5 bg-[#0F172A]/50 rounded-2xl border border-slate-800/50">
                                    <h4 className="text-[10px] font-black text-white uppercase tracking-widest mb-3 flex items-center gap-2">
                                        <Database size={14} className="text-emerald-400" /> RECOMMENDED: orders
                                    </h4>
                                    <ul className="text-[10px] text-slate-400 space-y-2 font-bold uppercase tracking-tight">
                                        <li className="flex justify-between"><span>order_id</span> <span className="text-slate-600">UUID</span></li>
                                        <li className="flex justify-between"><span>customer_name</span> <span className="text-slate-600">TEXT</span></li>
                                        <li className="flex justify-between"><span>order_date</span> <span className="text-slate-600">DATE</span></li>
                                        <li className="flex justify-between"><span>total_amount</span> <span className="text-slate-600">DECIMAL</span></li>
                                        <li className="flex justify-between"><span>status</span> <span className="text-slate-600">TEXT</span></li>
                                    </ul>
                                </div>
                                <div className="p-5 bg-indigo-600/5 rounded-2xl border border-indigo-500/10 flex flex-col justify-between">
                                    <div>
                                        <h4 className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-2">How to handle collisions?</h4>
                                        <p className="text-[9px] text-slate-500 font-bold uppercase leading-relaxed">
                                            The system automatically prefixes your table names with <span className="text-white">c_{user?.profile?.company_id?.split('-')[0]}_</span>.
                                            This ensures that if another company also names their table 'orders', your data remains isolated and unique.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="p-4 bg-[#0F172A] rounded-2xl border border-slate-800">
                                    <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-2">Grok AI Prompt (Copy & Paste)</p>
                                    <p className="text-[11px] font-mono text-indigo-300 leading-relaxed bg-indigo-500/5 p-3 rounded-lg border border-indigo-500/10">
                                        "Generate a PostgreSQL CREATE TABLE script for my company {company?.name} in {company?.industry}.
                                        The table name should be c_{user?.profile?.company_id?.split('-')[0]}_orders.
                                        Include columns for order details, status, and company_id.
                                        Format it for Supabase and use UUID for primary keys."
                                    </p>
                                </div>
                                <button
                                    onClick={() => {
                                        navigator.clipboard.writeText(`Generate a PostgreSQL CREATE TABLE script for my company ${company?.name} in ${company?.industry}. The table name should be c_${user?.profile?.company_id?.split('-')[0]}_orders. Include columns for order details, status, and company_id. Format it for Supabase and use UUID for primary keys.`);
                                        addToast("Grok Prompt copied to clipboard!", "success");
                                    }}
                                    className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl transition-all flex items-center justify-center gap-2"
                                >
                                    <Copy size={14} />
                                    Copy Grok AI Prompt
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default AdminDashboard;
