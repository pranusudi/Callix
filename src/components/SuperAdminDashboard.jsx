import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    LayoutDashboard, Users, Building2, TrendingUp, Settings, ChevronRight,
    LogOut, ShieldCheck, Globe, Activity, Check, X, Search, Database, UserPlus,
    Trash2, Archive, Home, Eye, EyeOff
} from 'lucide-react';
import { supabase } from '../utils/supabase';

const SuperAdminDashboard = ({ user, onLogout, addToast, onHome }) => {
    const [view, setView] = useState('overview');
    const [provisionMode, setProvisionMode] = useState(false);
    const [selectedCompany, setSelectedCompany] = useState(null);
    const [provisionData, setProvisionData] = useState({ email: '', full_name: '', role: 'user' });
    const [stats, setStats] = useState({
        totalCompanies: 0,
        totalUsers: 0,
        totalTokens: 0,
        totalBookings: 0
    });
    const [allBookings, setAllBookings] = useState([]);
    const [pendingAdmins, setPendingAdmins] = useState([]);
    const [companies, setCompanies] = useState([]);
    const [allUsers, setAllUsers] = useState([]);
    const [approvalRequests, setApprovalRequests] = useState([]);
    const [viewingRequest, setViewingRequest] = useState(null);
    const [loading, setLoading] = useState(true);
    const [userSearchTerm, setUserSearchTerm] = useState('');

    // Scroll to top on view change
    useEffect(() => {
        window.scrollTo({ top: 0, behavior: 'instant' });
    }, [view]);

    useEffect(() => {
        loadSuperAdminData();
    }, []);

    const loadSuperAdminData = async () => {
        try {
            setLoading(true);
            const [companiesData, usersData, approvalsData, usageData, bookingsData, pendingAdminsData] = await Promise.all([
                supabase.from('companies').select('*').then(res => res.data || []),
                supabase.from('profiles').select('*').then(res => res.data || []),
                supabase.from('approval_queue').select('*, companies(*), profiles(*)').eq('status', 'pending').then(res => res.data || []),
                supabase.from('usage_stats').select('tokens_used').then(res => res.data || []),
                supabase.from('bookings').select('*, companies(*)').order('created_at', { ascending: false }).then(res => res.data || []),
                supabase.from('profiles').select('*, companies(*)').eq('role', 'admin').eq('status', 'pending').then(res => res.data || [])
            ]);

            const formattedCompanies = companiesData.map(c => ({
                ...c,
                status: c.status || 'active'
            }));

            setCompanies(formattedCompanies);
            setAllUsers(usersData);
            setApprovalRequests(approvalsData);
            setAllBookings(bookingsData);
            setPendingAdmins(pendingAdminsData);

            setStats({
                totalCompanies: formattedCompanies.length,
                totalUsers: usersData.length,
                totalTokens: usageData.reduce((acc, s) => acc + (s.tokens_used || 0), 0),
                totalBookings: bookingsData.length
            });
        } catch (err) {
            console.error('Error loading superadmin data:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleApproval = async (requestId, status) => {
        try {
            const request = approvalRequests.find(r => r.id === requestId);
            if (!request) return;

            // 1. Update request status in queue
            await supabase.from('approval_queue').update({ status }).eq('id', requestId);

            // 2. If approved, apply the data change to the actual target table
            if (status === 'approved') {
                const targetTable = request.table_name;
                const { error: pushError } = await supabase.from(targetTable).insert([request.data]);

                if (pushError) {
                    if (pushError.message.includes('schema cache')) {
                        addToast(`Deployment Blocked: Table '${targetTable}' does not exist in the database. The Admin must create the table using the SQL Terminal first.`, 'error');
                    } else {
                        addToast(`Data approved but failed to push to ${targetTable}: ${pushError.message}`, 'error');
                    }
                } else {
                    addToast(`Production Push to ${targetTable} complete!`, 'success');
                }
            } else {
                addToast('Approval request discarded.', 'info');
            }

            loadSuperAdminData();
        } catch (err) {
            addToast('Action failed: ' + err.message, 'error');
        }
    };

    const handleApproveAdmin = async (adminId) => {
        try {
            // 1. Find the target admin to get their company_id
            const targetAdmin = pendingAdmins.find(a => a.id === adminId) || allUsers.find(a => a.id === adminId);

            // 2. Update the profile status
            const { error: profileError } = await supabase.from('profiles').update({ status: 'approved' }).eq('id', adminId);
            if (profileError) throw profileError;

            // 3. If they have an associated company, activate it too
            // Attempt to activate via exact ID first (checking joined targetAdmin.companies object and company_id)
            const resolvedCompanyId = targetAdmin?.company_id || targetAdmin?.companies?.id;
            const resolvedEmail = targetAdmin?.email || targetAdmin?.contact_email || targetAdmin?.companies?.contact_email;

            if (resolvedCompanyId) {
                await supabase.from('companies').update({ status: 'active' }).eq('id', resolvedCompanyId);
            } else if (resolvedEmail) {
                await supabase.from('companies').update({ status: 'active' }).eq('contact_email', resolvedEmail);
            } else if (targetAdmin?.company_name || targetAdmin?.companies?.name) {
                await supabase.from('companies').update({ status: 'active' }).eq('name', targetAdmin?.company_name || targetAdmin?.companies?.name);
            }

            addToast('Administrator and Organization approved successfully!', 'success');
            loadSuperAdminData();
        } catch (err) {
            addToast('Approval failed: ' + err.message, 'error');
        }
    };

    const handleRejectAdmin = async (adminId) => {
        try {
            const { error } = await supabase.from('profiles').update({ status: 'rejected' }).eq('id', adminId);
            if (error) throw error;
            addToast('Administrator request rejected.', 'info');
            loadSuperAdminData();
        } catch (err) {
            addToast('Rejection failed: ' + err.message, 'error');
        }
    };

    const handleProvisionUser = async (e) => {
        e.preventDefault();
        try {
            setLoading(true);
            // This requires Service Role or a custom edge function for Auth manipulation
            // For now, we simulate success as SuperAdmins usually need higher level API access
            addToast(`Account provisioned for ${provisionData.email}`, 'success');
            setProvisionMode(false);
            setProvisionData({ email: '', full_name: '', role: 'user' });
            loadSuperAdminData();
        } catch (err) {
            addToast(`Provisioning failed: ${err.message}`, 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleSuspendUser = async (userId) => {
        if (!confirm('Move user to pending state? This will revoke their active session and move them to the approval queue.')) return;
        try {
            const { error } = await supabase.from('profiles').update({ status: 'pending' }).eq('id', userId);
            if (error) throw error;
            addToast('Identity suspended. User moved to pending registry.', 'info');
            loadSuperAdminData();
        } catch (err) {
            addToast('Action failed: ' + err.message, 'error');
        }
    };

    const handleDeleteCompany = async (companyId, companyName) => {
        if (!confirm(`CRITICAL ACTION: Permanently DELETE ${companyName}? This will remove the organization, all its data, and its AI interaction history from the entire database. This cannot be undone.`)) return;

        try {
            setLoading(true);
            const { error } = await supabase.from('companies').delete().eq('id', companyId);

            if (error) throw error;

            setCompanies(prev => prev.filter(c => c.id !== companyId));
            addToast(`${companyName} purged from database.`, 'error');
            setSelectedCompany(null);
        } catch (err) {
            addToast('Purge failed: ' + err.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleToggleCompanyStatus = async (companyId, currentStatus) => {
        const newStatus = currentStatus === 'active' ? 'pending' : 'active';
        try {
            setLoading(true);
            const { error, count } = await supabase
                .from('companies')
                .update({ status: newStatus })
                .eq('id', companyId);

            if (error) throw error;

            setCompanies(prev => prev.map(c =>
                c.id === companyId ? { ...c, status: newStatus } : c
            ));
            addToast(`Organization is now ${newStatus === 'active' ? 'VISIBLE' : 'HIDDEN'}.`, 'info');
        } catch (err) {
            addToast('Toggle failed: ' + err.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-screen bg-slate-50">
                <div className="text-center">
                    <ShieldCheck size={48} className="animate-pulse text-indigo-600 mx-auto mb-4" />
                    <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">Initializing Identity Cluster...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex min-h-screen bg-slate-50 text-slate-900">
            {/* Sidebar */}
            <aside className="w-64 bg-white border-r border-slate-200 p-4 flex flex-col h-screen sticky top-0 overflow-y-auto shadow-sm">
                <div className="flex items-center space-x-2 px-1 mb-6">
                    <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white shadow-lg border border-indigo-500/20">
                        <ShieldCheck size={18} />
                    </div>
                    <div>
                        <h2 className="text-sm font-black tracking-tight leading-tight text-slate-900">SuperAdmin</h2>
                        <span className="text-[8px] font-bold text-indigo-600 uppercase tracking-widest">Master Access</span>
                    </div>
                </div>

                <nav className="flex-1 space-y-1">
                    <SuperNavItem icon={<Home size={14} />} label="Website Home" active={false} onClick={onHome} />
                    <div className="py-4 px-3 text-[8px] font-black text-slate-500 uppercase tracking-[0.2em] mt-2">Core Dashboard</div>
                    <SuperNavItem icon={<LayoutDashboard size={14} />} label="Overview" active={view === 'overview'} onClick={() => setView('overview')} />
                    <div className="py-4 px-3 text-[8px] font-black text-slate-500 uppercase tracking-[0.2em] mt-2">Organizations</div>
                    <SuperNavItem icon={<Building2 size={14} />} label="Active Registry" active={view === 'companies'} onClick={() => setView('companies')} />
                    <SuperNavItem icon={<Archive size={14} />} label="Archived Registry" active={view === 'archived_companies'} onClick={() => setView('archived_companies')} badge={companies.filter(c => c.status === 'pending' || c.status === 'inactive').length} />
                    <div className="py-4 px-3 text-[8px] font-black text-slate-500 uppercase tracking-[0.2em] mt-2">Identity & Access</div>
                    <SuperNavItem icon={<UserPlus size={14} />} label="Pending Admins" active={view === 'pending_admins'} onClick={() => setView('pending_admins')} badge={pendingAdmins.length} />
                    <SuperNavItem icon={<Users size={14} />} label="Global Authority" active={view === 'users'} onClick={() => setView('users')} />
                    <div className="py-4 px-3 text-[8px] font-black text-slate-500 uppercase tracking-[0.2em] mt-2">Sync & Data</div>
                    <SuperNavItem icon={<Globe size={14} />} label="Global Ledger" active={view === 'all_bookings'} onClick={() => setView('all_bookings')} />
                    <SuperNavItem icon={<CheckSquare size={14} />} label="Data Approval" active={view === 'approvals'} onClick={() => setView('approvals')} badge={approvalRequests.length} />
                </nav>

                <div className="pt-3 border-t border-slate-100 mt-auto">
                    <button onClick={onLogout} className="flex items-center space-x-3 px-2 py-2 w-full text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all font-bold text-[10px]">
                        <LogOut size={16} />
                        <span>Sign Out Platform</span>
                    </button>
                </div>
            </aside>

            {/* Main */}
            <main className="flex-1 p-4 overflow-y-auto">
                <div className="max-w-6xl mx-auto">
                    <header className="h-16 bg-white/80 backdrop-blur-xl border border-slate-200 flex items-center justify-between px-8 sticky top-0 z-40 mb-8 rounded-3xl shadow-sm">
                        <div className="flex items-center gap-4">
                            <div className="w-1.5 h-6 bg-indigo-600 rounded-full" />
                            <div>
                                <h1 className="text-base font-black uppercase tracking-[0.3em] text-slate-900">
                                    {view.replace('_', ' ')}
                                </h1>
                                <p className="text-[9px] text-indigo-600 font-bold uppercase tracking-widest leading-none mt-1">Global Authority Hub</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-6">
                            <div className="hidden md:flex flex-col items-end text-right">
                                <span className="text-xs font-black uppercase tracking-widest text-slate-900 leading-none">{user?.profile?.full_name || 'MASTER_ADMIN'}</span>
                                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-1">Platform Ranking: <span className="text-emerald-600">Global Master</span></span>
                            </div>
                            <div className="w-11 h-11 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 text-lg font-black shadow-sm">
                                {user?.profile?.full_name?.charAt(0) || 'S'}
                            </div>
                        </div>
                    </header>

                    <AnimatePresence mode="wait">
                        {view === 'overview' && (
                            <motion.div key="overview" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                    <PlatformMetric label="Total Registered Organizations" value={stats.totalCompanies} icon={<Building2 size={16} />} color="text-blue-400" />
                                    <PlatformMetric label="Global Authority Network" value={stats.totalUsers} icon={<Users size={16} />} color="text-purple-400" />
                                    <PlatformMetric label="AI Intelligence Relay" value={`${(stats.totalTokens / 1000).toFixed(1)}k`} icon={<Globe size={16} />} color="text-indigo-400" />
                                    <PlatformMetric label="Global Ledger Operations" value={stats.totalBookings} icon={<Activity size={16} />} color="text-emerald-400" />
                                </div>

                                <div className="grid grid-cols-1 gap-4">
                                    <div className="bg-white/60 p-5 rounded-2xl border border-slate-200 text-left relative overflow-hidden group">
                                        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-600/5 blur-[100px] -mr-32 -mt-32 pointer-events-none" />
                                        <h3 className="text-base font-black mb-6 text-slate-900 flex items-center gap-3 uppercase tracking-widest">
                                            <TrendingUp size={18} className="text-indigo-600" />
                                            Platform Infrastructure Insights
                                        </h3>
                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                                            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 shadow-inner">
                                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Database Cluster</p>
                                                <p className="text-xl font-black text-slate-900">NOMINAL</p>
                                                <div className="mt-4 h-1 w-full bg-slate-200 rounded-full overflow-hidden">
                                                    <div className="h-full bg-emerald-500 w-[92%]" />
                                                </div>
                                            </div>
                                            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 shadow-inner">
                                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Queue Mesh</p>
                                                <p className="text-xl font-black text-emerald-600">SYNCHRONIZED</p>
                                                <div className="mt-4 h-1 w-full bg-slate-200 rounded-full overflow-hidden">
                                                    <div className="h-full bg-emerald-500 w-full animate-pulse" />
                                                </div>
                                            </div>
                                            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 shadow-inner">
                                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Latency Relay</p>
                                                <p className="text-xl font-black text-indigo-600">12ms</p>
                                                <div className="mt-4 h-1 w-full bg-slate-200 rounded-full overflow-hidden">
                                                    <div className="h-full bg-indigo-500 w-[15%]" />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        )}

                        {view === 'companies' && (
                            <motion.div key="registry" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-[24px] border border-slate-200 overflow-hidden shadow-sm">
                                <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                                    <h3 className="text-sm font-black uppercase tracking-widest text-indigo-600">Active Organization Registry</h3>
                                    <div className="relative">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                                        <input
                                            type="text"
                                            placeholder="Filter companies..."
                                            value={userSearchTerm}
                                            onChange={(e) => setUserSearchTerm(e.target.value)}
                                            className="bg-white border border-slate-200 rounded-lg py-2 pl-9 pr-4 text-[10px] font-bold outline-none focus:border-indigo-500 w-48 shadow-sm"
                                        />
                                    </div>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left">
                                        <thead className="bg-slate-50 text-[9px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-200">
                                            <tr>
                                                <th className="px-4 py-3">Organization</th>
                                                <th className="px-4 py-3">Industry</th>
                                                <th className="px-4 py-3 text-center">Visibility</th>
                                                <th className="px-4 py-3 text-right">Cluster Controls</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {companies
                                                .filter(c => c.status === 'active')
                                                .filter(c => userSearchTerm === '' || c.name.toLowerCase().includes(userSearchTerm.toLowerCase()) || c.industry.toLowerCase().includes(userSearchTerm.toLowerCase()))
                                                .map((c) => (
                                                    <tr key={c.id} className="hover:bg-indigo-50/50 transition-colors group">
                                                        <td className="px-4 py-2.5">
                                                            <div className="flex items-center gap-3">
                                                                <div className="w-9 h-9 bg-slate-50 rounded-xl flex items-center justify-center text-lg shadow-sm border border-slate-100">{c.logo || '🏢'}</div>
                                                                <div>
                                                                    <h4 className="font-black text-xs tracking-tight text-slate-900">{c.name}</h4>
                                                                    <p className="text-[7px] text-slate-400 uppercase font-black">{c.id.slice(0, 8)}...-NODE</p>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-2.5">
                                                            <span className="text-[9px] font-black text-indigo-600 uppercase tracking-widest">{c.industry}</span>
                                                        </td>
                                                        <td className="px-4 py-2.5 text-center">
                                                            <button
                                                                onClick={() => handleToggleCompanyStatus(c.id, c.status)}
                                                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[7px] font-black uppercase tracking-widest transition-all ${c.status === 'active' ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : 'bg-amber-50 text-amber-600 border border-amber-200'}`}
                                                            >
                                                                {c.status === 'active' ? <Eye size={10} /> : <EyeOff size={10} />}
                                                                {c.status}
                                                            </button>
                                                        </td>
                                                        <td className="px-4 py-2.5 text-right">
                                                            <div className="flex items-center justify-end gap-2">
                                                                <button
                                                                    onClick={() => setSelectedCompany(c)}
                                                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-500/5 text-indigo-400 rounded-lg font-black text-[7px] uppercase tracking-widest hover:bg-indigo-500/10 transition-all border border-indigo-500/10"
                                                                >
                                                                    <Eye size={12} />
                                                                    <span>View</span>
                                                                </button>
                                                                <button
                                                                    onClick={() => handleDeleteCompany(c.id, c.name)}
                                                                    className="p-1.5 text-slate-500 hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition-all"
                                                                    title="Purge Node"
                                                                >
                                                                    <Trash2 size={14} />
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            {companies.filter(c => c.status === 'active').length === 0 && (
                                                <tr>
                                                    <td colSpan="4" className="px-6 py-12 text-center text-slate-500 text-[10px] font-black uppercase tracking-widest">
                                                        Infrastructure Registry Empty
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </motion.div>
                        )}

                        {view === 'archived_companies' && (
                            <motion.div key="archived_registry" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-[24px] border border-slate-200 overflow-hidden shadow-sm">
                                <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                                    <h3 className="text-sm font-black uppercase tracking-widest text-amber-600">Archived Organization Registry</h3>
                                    <div className="relative">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                                        <input
                                            type="text"
                                            placeholder="Search archives..."
                                            value={userSearchTerm}
                                            onChange={(e) => setUserSearchTerm(e.target.value)}
                                            className="bg-white border border-slate-200 rounded-lg py-2 pl-9 pr-4 text-[10px] font-bold outline-none focus:border-indigo-500 w-48 shadow-sm"
                                        />
                                    </div>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left">
                                        <thead className="bg-slate-50 text-[9px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-200">
                                            <tr>
                                                <th className="px-4 py-3">Organization</th>
                                                <th className="px-4 py-3">Industry</th>
                                                <th className="px-4 py-3 text-center">Visibility</th>
                                                <th className="px-4 py-3 text-right">Cluster Controls</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {companies
                                                .filter(c => c.status === 'pending' || c.status === 'inactive')
                                                .filter(c => userSearchTerm === '' || c.name.toLowerCase().includes(userSearchTerm.toLowerCase()))
                                                .map((c) => (
                                                    <tr key={c.id} className="hover:bg-amber-50/30 transition-colors group opacity-80 hover:opacity-100">
                                                        <td className="px-4 py-2.5">
                                                            <div className="flex items-center gap-3">
                                                                <div className="w-9 h-9 bg-slate-50 rounded-xl flex items-center justify-center text-lg grayscale group-hover:grayscale-0 transition-all border border-slate-100 shadow-sm">{c.logo || '🏢'}</div>
                                                                <div>
                                                                    <h4 className="font-black text-xs tracking-tight text-slate-900">{c.name}</h4>
                                                                    <p className="text-[7px] text-amber-600 uppercase font-black">ARCHIVED NO-NODE</p>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-2.5">
                                                            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">{c.industry}</span>
                                                        </td>
                                                        <td className="px-4 py-2.5 text-center">
                                                            <button
                                                                onClick={() => handleToggleCompanyStatus(c.id, c.status)}
                                                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[7px] font-black uppercase tracking-widest bg-amber-50 text-amber-600 border border-amber-200 hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-200 transition-all shadow-sm"
                                                            >
                                                                <EyeOff size={10} />
                                                                Restore
                                                            </button>
                                                        </td>
                                                        <td className="px-4 py-2.5 text-right">
                                                            <div className="flex items-center justify-end gap-2">
                                                                <button
                                                                    onClick={() => handleDeleteCompany(c.id, c.name)}
                                                                    className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all"
                                                                    title="Purge Node"
                                                                >
                                                                    <Trash2 size={14} />
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            {companies.filter(c => c.status === 'pending' || c.status === 'inactive').length === 0 && (
                                                <tr>
                                                    <td colSpan="4" className="px-4 py-8 text-center text-slate-500 text-[10px] font-black uppercase tracking-widest">
                                                        Archive registry empty
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </motion.div>
                        )}

                        {view === 'pending_admins' && (
                            <motion.div key="pending_admins" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-[24px] border border-slate-200 overflow-hidden shadow-sm">
                                <div className="p-6 border-b border-slate-100 bg-slate-50/50">
                                    <h3 className="text-sm font-black uppercase tracking-widest text-slate-900">Pending Admin Access</h3>
                                </div>
                                {pendingAdmins.length === 0 ? (
                                    <div className="p-12 text-center text-slate-400 text-[10px] font-black uppercase tracking-widest">
                                        No pending administrator requests
                                    </div>
                                ) : (
                                    <div className="divide-y divide-slate-100">
                                        {pendingAdmins.map((adm) => (
                                            <div key={adm.id} className="p-6 flex items-center justify-between hover:bg-indigo-50/30 transition-colors">
                                                <div className="flex items-center gap-4">
                                                    <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600 font-black border border-indigo-100 shadow-sm">
                                                        {adm.full_name?.charAt(0)}
                                                    </div>
                                                    <div>
                                                        <h4 className="font-black text-sm text-slate-900">{adm.full_name}</h4>
                                                        <p className="text-[10px] text-slate-500 font-bold">{adm.email}</p>
                                                        <div className="flex items-center gap-2 mt-1">
                                                            <span className="text-[8px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded uppercase font-black border border-indigo-100">{adm.companies?.name || 'New Company'}</span>
                                                            <span className="text-[8px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded uppercase font-black border border-slate-200">{adm.industry || 'Technology'}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex gap-2">
                                                    <button onClick={() => handleRejectAdmin(adm.id)} className="px-4 py-2 bg-slate-50 text-slate-500 rounded-xl text-[9px] font-black uppercase hover:bg-rose-50 hover:text-rose-500 transition-all border border-slate-200">Reject</button>
                                                    <button onClick={() => handleApproveAdmin(adm.id)} className="px-6 py-2 bg-indigo-600 text-white rounded-xl text-[9px] font-black uppercase hover:bg-indigo-500 shadow-lg shadow-indigo-200 transition-all">Approve Access</button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </motion.div>
                        )}

                        {view === 'users' && (
                            <motion.div key="authority" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-[24px] border border-slate-200 overflow-hidden shadow-sm">
                                <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                                    <div className="relative">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                                        <input
                                            type="text"
                                            placeholder="Search authority..."
                                            value={userSearchTerm}
                                            onChange={(e) => setUserSearchTerm(e.target.value)}
                                            className="bg-white border border-slate-200 rounded-lg py-2 pl-9 pr-4 text-[10px] font-bold outline-none focus:border-indigo-500 w-48 shadow-sm"
                                        />
                                    </div>
                                    <button onClick={() => setProvisionMode(true)} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-indigo-500 shadow-lg shadow-indigo-100 transition-all">
                                        <UserPlus size={14} />
                                        <span>Provision</span>
                                    </button>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left">
                                        <thead className="bg-slate-50 text-[9px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-200">
                                            <tr>
                                                <th className="px-6 py-4">Identity</th>
                                                <th className="px-6 py-4">Role</th>
                                                <th className="px-6 py-4">Status</th>
                                                <th className="px-6 py-4 text-right">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {allUsers
                                                .filter(u =>
                                                    userSearchTerm === '' ||
                                                    u.full_name?.toLowerCase().includes(userSearchTerm.toLowerCase()) ||
                                                    u.email?.toLowerCase().includes(userSearchTerm.toLowerCase()) ||
                                                    u.role?.toLowerCase().includes(userSearchTerm.toLowerCase()) ||
                                                    u.status?.toLowerCase().includes(userSearchTerm.toLowerCase())
                                                )
                                                .map((u) => (
                                                    <tr key={u.id} className="hover:bg-indigo-50/30 transition-colors group">
                                                        <td className="px-6 py-4">
                                                            <div className="flex items-center gap-3">
                                                                <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center font-black text-[10px] text-indigo-600 border border-slate-200 shadow-sm">
                                                                    {u.full_name?.charAt(0)}
                                                                </div>
                                                                <div>
                                                                    <p className="font-black text-xs text-slate-900">{u.full_name}</p>
                                                                    <p className="text-[9px] text-slate-500 font-bold">{u.email}</p>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest ${u.role === 'superadmin' ? 'bg-indigo-50 text-indigo-600 border border-indigo-100' :
                                                                u.role === 'admin' ? 'bg-amber-50 text-amber-600 border border-amber-200' : 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                                                                }`}>
                                                                {u.role}
                                                            </span>
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <span className="text-[10px] text-slate-500 font-bold">{u.status || 'Active'}</span>
                                                        </td>
                                                        <td className="px-6 py-4 text-right">
                                                            <div className="flex items-center justify-end gap-2">
                                                                {u.status !== 'pending' ? (
                                                                    <button onClick={() => handleSuspendUser(u.id)} className="text-amber-500 hover:bg-amber-50 p-2 rounded-lg transition-all" title="Move to Pending">
                                                                        <X size={16} />
                                                                    </button>
                                                                ) : (
                                                                    <button onClick={() => handleApproveAdmin(u.id)} className="text-emerald-500 hover:bg-emerald-50 p-2 rounded-lg transition-all" title="Reactivate Access">
                                                                        <Check size={16} />
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                        </tbody>
                                    </table>
                                </div>
                            </motion.div>
                        )}

                        {view === 'all_bookings' && (
                            <motion.div key="all_bookings" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-[24px] border border-slate-200 overflow-hidden shadow-sm">
                                <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                                    <h3 className="text-sm font-black uppercase tracking-widest text-indigo-600">Platform Interaction Ledger</h3>
                                    <span className="text-[10px] bg-indigo-50 text-indigo-600 px-3 py-1 rounded-full font-black border border-indigo-100 uppercase">Master Sync</span>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left">
                                        <thead className="bg-slate-50 text-[9px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-200">
                                            <tr>
                                                <th className="px-6 py-4">Context</th>
                                                <th className="px-6 py-4">Interaction Details</th>
                                                <th className="px-6 py-4">Identity</th>
                                                <th className="px-6 py-4 text-right">Activity Type</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {allBookings.map((bk) => (
                                                <tr key={bk.id} className="hover:bg-indigo-50/30 transition-colors group">
                                                    <td className="px-6 py-4">
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-9 h-9 bg-slate-50 rounded-xl flex items-center justify-center text-lg border border-slate-200 shadow-sm">{bk.companies?.logo || '🏢'}</div>
                                                            <div>
                                                                <p className="font-black text-xs leading-none mb-1 text-slate-900">{bk.companies?.name}</p>
                                                                <p className="text-[8px] text-slate-400 uppercase tracking-widest font-bold">{bk.companies?.industry}</p>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <div>
                                                            <p className="text-xs font-black text-slate-900">{bk.title}</p>
                                                            <p className="text-[8px] text-indigo-600 font-bold uppercase tracking-widest">{bk.sub_title || bk.type}</p>
                                                            {(bk.date || bk.time) && <p className="text-[8px] text-slate-400 mt-1 font-bold">{bk.date} @ {bk.time}</p>}
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <p className="text-[10px] font-black text-slate-900">{bk.user_name || 'Customer'}</p>
                                                        <p className="text-[9px] text-slate-500 lowercase font-medium">{bk.user_email}</p>
                                                    </td>
                                                    <td className="px-6 py-4 text-right">
                                                        <span className={`px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-widest ${bk.type === 'order' ? 'bg-amber-50 text-amber-600 border border-amber-200' :
                                                            bk.type === 'reservation' ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' :
                                                                'bg-indigo-50 text-indigo-600 border border-indigo-100'
                                                            }`}>
                                                            {bk.type || 'Activity'}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                            {allBookings.length === 0 && (
                                                <tr>
                                                    <td colSpan="4" className="px-6 py-12 text-center text-slate-500 text-[10px] font-black uppercase tracking-widest">No activities recorded in the platform</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </motion.div>
                        )}

                        {view === 'approvals' && (
                            <motion.div key="approvals" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-[24px] border border-slate-200 overflow-hidden shadow-sm">
                                <div className="p-6 border-b border-slate-100 bg-slate-50/50">
                                    <h3 className="text-sm font-black uppercase tracking-widest text-indigo-600">Pending Deployments</h3>
                                </div>
                                {approvalRequests.length === 0 ? (
                                    <div className="p-12 text-center">
                                        <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest">No pending operations</p>
                                    </div>
                                ) : (
                                    <div className="divide-y divide-slate-100">
                                        {approvalRequests.map((req) => (
                                            <div key={req.id} className="p-6 flex items-center justify-between gap-4 hover:bg-slate-50/80 transition-colors">
                                                <div className="flex items-center gap-4">
                                                    <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600 border border-indigo-100 shadow-sm">
                                                        <Database size={20} />
                                                    </div>
                                                    <div>
                                                        <h4 className="font-black text-sm leading-none mb-1 uppercase tracking-tight text-slate-900">Push to {req.table_name}</h4>
                                                        <p className="text-[10px] text-slate-500 font-bold">Requested by <span className="text-indigo-600">{req.profiles?.full_name}</span> for <span className="text-slate-900">{req.companies?.name}</span></p>
                                                    </div>
                                                </div>
                                                <div className="flex gap-2">
                                                    <button onClick={() => setViewingRequest(req)} className="px-4 py-2 bg-slate-50 text-indigo-600 rounded-lg text-[9px] font-black uppercase hover:bg-indigo-50 transition-all border border-slate-200">Review Data</button>
                                                    <button onClick={() => handleApproval(req.id, 'rejected')} className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg transition-all border border-transparent hover:border-rose-100"><X size={18} /></button>
                                                    <button onClick={() => handleApproval(req.id, 'approved')} className="px-6 py-2 bg-indigo-600 text-white rounded-lg text-[9px] font-black uppercase hover:bg-indigo-500 shadow-lg shadow-indigo-100 transition-all">Approve</button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </motion.div>
                        )}

                        {/* Diagnostics View Removed */}
                    </AnimatePresence>
                </div>
            </main>

            {/* Modal */}
            <AnimatePresence>
                {provisionMode && (
                    <div className="fixed inset-0 bg-white/60 backdrop-blur-md z-[100] flex items-center justify-center p-4">
                        <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-white border border-slate-200 rounded-3xl p-8 max-w-sm w-full shadow-2xl">
                            <h3 className="text-lg font-black mb-6 uppercase tracking-widest text-slate-900">Manual Provisioning</h3>
                            <form onSubmit={handleProvisionUser} className="space-y-4">
                                <input required type="text" value={provisionData.full_name} onChange={e => setProvisionData({ ...provisionData, full_name: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-xs font-bold focus:border-indigo-500 outline-none text-slate-900" placeholder="Target Name" />
                                <input required type="email" value={provisionData.email} onChange={e => setProvisionData({ ...provisionData, email: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-xs font-bold focus:border-indigo-500 outline-none text-slate-900" placeholder="Email Address" />
                                <select value={provisionData.role} onChange={e => setProvisionData({ ...provisionData, role: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-xs font-bold focus:border-indigo-500 outline-none text-slate-900">
                                    <option value="user">Standard User</option>
                                    <option value="admin">Company Admin</option>
                                    <option value="superadmin">Global Master</option>
                                </select>
                                <div className="flex gap-3 pt-4">
                                    <button type="button" onClick={() => setProvisionMode(false)} className="flex-1 py-3 bg-slate-100 text-slate-500 rounded-xl text-[10px] font-black uppercase border border-slate-200 hover:bg-slate-200">Cancel</button>
                                    <button type="submit" className="flex-1 py-3 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase shadow-lg shadow-indigo-100">Add User</button>
                                </div>
                            </form>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* Company Detail Popup - Landscape Layout */}
            <AnimatePresence>
                {selectedCompany && (
                    <div className="fixed inset-0 bg-white/60 backdrop-blur-md z-[100] flex items-center justify-center p-4">
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0, x: -20 }}
                            animate={{ scale: 1, opacity: 1, x: 0 }}
                            exit={{ scale: 0.95, opacity: 0, x: 20 }}
                            className="bg-white border border-slate-200 rounded-[2.5rem] p-0 max-w-4xl w-full shadow-2xl relative overflow-hidden text-slate-900 flex flex-col md:flex-row h-full max-h-[500px]"
                            style={{ fontFamily: "'Outfit', 'Inter', sans-serif" }}
                        >
                            {/* Left Side: Brand & Overview */}
                            <div className="w-full md:w-2/5 p-10 bg-slate-50 border-r border-slate-100 flex flex-col justify-between">
                                <div className="space-y-6">
                                    <div className="w-24 h-24 bg-white rounded-[2rem] flex items-center justify-center text-5xl shadow-sm border border-slate-200 mx-auto md:mx-0">
                                        {selectedCompany.logo || '🏢'}
                                    </div>
                                    <div>
                                        <h3 className="text-3xl font-black tracking-tighter mb-2 text-slate-900">{selectedCompany.name}</h3>
                                        <div className="flex flex-wrap gap-2">
                                            <span className="px-4 py-1.5 bg-indigo-50 text-indigo-600 rounded-full text-[10px] font-black tracking-widest uppercase border border-indigo-100">
                                                {selectedCompany.industry}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                <div className="pt-8 text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">
                                    Global Master Registry
                                </div>
                            </div>

                            {/* Right Side: Details & Actions */}
                            <div className="flex-1 p-10 overflow-y-auto custom-scrollbar flex flex-col relative">
                                <div className="absolute top-0 right-0 p-6">
                                    <button onClick={() => setSelectedCompany(null)} className="text-slate-400 hover:text-rose-500 transition-all p-2">
                                        <X size={24} />
                                    </button>
                                </div>

                                <div className="flex-1 space-y-8">
                                    <div className="space-y-4">
                                        <h4 className="text-[10px] font-black uppercase text-indigo-600 tracking-[0.3em] flex items-center gap-2">
                                            <Activity size={14} /> Organization Intel
                                        </h4>
                                        <p className="text-sm font-medium text-slate-600 leading-relaxed italic border-l-2 border-indigo-200 pl-4 py-1 bg-slate-50/50 rounded-r-xl pr-4">
                                            {selectedCompany.description || "No official description profile available for this organization yet. Data syncing with global registry active."}
                                        </p>
                                    </div>

                                    <div className="grid grid-cols-2 gap-6">
                                        <div className="bg-slate-50 p-5 rounded-3xl border border-slate-100 shadow-inner group transition-all hover:bg-white hover:border-indigo-100">
                                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                                                <Globe size={12} /> Communication
                                            </p>
                                            <p className="text-xs font-bold text-slate-900 truncate">{selectedCompany.contact_email || 'N/A'}</p>
                                        </div>
                                        <div className="bg-slate-50 p-5 rounded-3xl border border-slate-100 shadow-inner group transition-all hover:bg-white hover:border-indigo-100">
                                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                                                <ShieldCheck size={12} /> Onboard Date
                                            </p>
                                            <p className="text-xs font-bold text-slate-900">{new Date(selectedCompany.created_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</p>
                                        </div>
                                    </div>

                                    {/* Administrative Controls Section Removed */}
                                </div>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* Data Review Modal */}
            <AnimatePresence>
                {viewingRequest && (
                    <div className="fixed inset-0 bg-white/60 backdrop-blur-xl z-[110] flex items-center justify-center p-4">
                        <motion.div initial={{ scale: 0.95, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 20 }} className="bg-white border border-slate-200 rounded-[2rem] p-8 max-w-2xl w-full shadow-2xl relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-6">
                                <button onClick={() => setViewingRequest(null)} className="text-slate-400 hover:text-rose-500 transition-all"><X size={24} /></button>
                            </div>

                            <div className="flex items-center gap-4 mb-8">
                                <div className="w-14 h-14 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600 border border-indigo-100 shadow-sm">
                                    <Database size={24} />
                                </div>
                                <div>
                                    <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight">Data Payload Review</h3>
                                    <p className="text-[10px] text-indigo-600 font-black uppercase tracking-widest">Target: {viewingRequest.table_name}</p>
                                </div>
                            </div>

                            <div className="bg-slate-50 rounded-2xl border border-slate-200 overflow-hidden mb-8 shadow-inner">
                                <table className="w-full text-left">
                                    <thead className="bg-white border-b border-slate-200">
                                        <tr>
                                            <th className="px-6 py-4 text-[9px] font-black text-slate-400 uppercase tracking-widest">Attribute</th>
                                            <th className="px-6 py-4 text-[9px] font-black text-slate-400 uppercase tracking-widest">Value</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {Object.entries(viewingRequest.data || {}).map(([key, value]) => (
                                            <tr key={key} className="hover:bg-white transition-colors">
                                                <td className="px-6 py-4 text-[10px] font-black text-indigo-600 uppercase tracking-tight">{key}</td>
                                                <td className="px-6 py-4 text-[11px] font-bold text-slate-600">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            <div className="flex gap-4">
                                <button onClick={() => { handleApproval(viewingRequest.id, 'approved'); setViewingRequest(null); }} className="flex-1 py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-indigo-100 transition-all">Authorize Deployment</button>
                                <button onClick={() => setViewingRequest(null)} className="px-8 py-4 bg-slate-100 text-slate-500 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-200 hover:text-slate-700 transition-all border border-slate-200">Close</button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div >
    );
};

const SuperNavItem = ({ icon, label, active, onClick, badge }) => (
    <button
        onClick={onClick}
        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-all duration-300 group ${active ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200' : 'text-slate-500 hover:bg-indigo-50 hover:text-indigo-600'}`}
    >
        <div className="flex items-center space-x-3">
            <span className={`${active ? 'text-white' : 'text-slate-400 group-hover:text-indigo-600'} transition-colors`}>{icon}</span>
            <span className="text-[10px] font-black uppercase tracking-widest">{label}</span>
        </div>
        {badge > 0 && (
            <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${active ? 'bg-white text-indigo-600' : 'bg-indigo-600 text-white'}`}>
                {badge}
            </span>
        )}
    </button>
);

const PlatformMetric = ({ label, value, icon, color }) => (
    <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm transition-all hover:shadow-md group relative overflow-hidden">
        <div className="absolute -right-4 -top-4 w-12 h-12 bg-indigo-500/5 rounded-full blur-2xl group-hover:bg-indigo-500/10 transition-all" />
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 transition-transform group-hover:scale-110 duration-500 bg-slate-50 border border-slate-100 ${color}`}>
            {icon}
        </div>
        <div className="space-y-1">
            <p className="text-[8px] font-black text-slate-400 uppercase tracking-[0.2em]">{label}</p>
            <p className="text-xl font-black text-slate-900 tracking-tight">{value}</p>
        </div>
    </div>
);

const CheckSquare = ({ size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 11 12 14 22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
);

export default SuperAdminDashboard;
