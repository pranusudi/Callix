import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Calendar, Clock, Loader, ShoppingBag, Stethoscope, ChevronRight, Utensils, Trash2, Star, Briefcase, LogOut, Home } from 'lucide-react';
import { database } from '../utils/database';

const UserDashboard = ({ user, onClose, onLogout, addToast }) => {
    const [data, setData] = useState({
        appointments: [],
        reservations: [],
        meetings: [],
        orders: [],
        feedback: []
    });
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('appointments');
    const [deletingId, setDeletingId] = useState(null);

    useEffect(() => {
        if (user) {
            loadUserData();
        }
    }, [user]);

    // Scroll to top on tab change
    useEffect(() => {
        window.scrollTo({ top: 0, behavior: 'instant' });
    }, [activeTab]);

    const loadUserData = async () => {
        try {
            setLoading(true);
            const userData = await database.getUserData(user.email);
            setData(userData);
        } catch (error) {
            console.error('Error loading user data:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (type, id) => {
        // Logic to delete from specific table based on type
        // For simplicity in this demo, we'll just log it or implement specific deletes if needed.
        console.log(`Deleting ${type} with ID ${id}`);
    };

    const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        // Clean placeholders like {tomorrow}
        const cleaned = dateString.replace(/[\[\]{}]/g, '');
        const date = new Date(cleaned);
        return isNaN(date.getTime()) ? cleaned : date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    };

    const getStatusStyle = (status) => {
        const styles = {
            scheduled: 'bg-indigo-50 text-indigo-700 border-indigo-200',
            completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
            reserved: 'bg-orange-50 text-orange-700 border-orange-200',
            confirmed: 'bg-emerald-50 text-emerald-700 border-emerald-200'
        };
        return styles[status] || 'bg-slate-50 text-slate-700 border-slate-200';
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-[60vh] bg-slate-50">
                <div className="text-center">
                    <Loader size={48} className="animate-spin text-indigo-600 mx-auto mb-4" />
                    <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">Syncing with Cloud...</p>
                </div>
            </div>
        );
    }

    const currentTabRecords = data[activeTab] || [];

    return (
        <div className="flex min-h-screen bg-[#F8FAFC]">
            {/* Extended Sidebar */}
            <div className="sidebar-container-custom hidden lg:flex w-64 flex-col bg-white p-4 text-slate-900 border-r border-slate-200 min-h-screen">
                <div className="px-2 mb-8">
                    <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white mb-3 shadow-lg border border-indigo-500/20">
                        <ShoppingBag size={24} />
                    </div>
                    <h2 className="text-slate-900 text-lg font-black tracking-tight">Callix AI</h2>

                    <button
                        onClick={onClose}
                        className="mt-4 flex items-center space-x-2 px-3 py-1.5 bg-slate-50 hover:bg-slate-100 rounded-lg transition-all border border-slate-200 group text-slate-500 hover:text-slate-900"
                    >
                        <Home size={14} className="group-hover:scale-110 transition-transform" />
                        <span className="font-bold text-[9px] uppercase tracking-widest">Return Home</span>
                    </button>
                </div>

                <nav className="flex-1 space-y-2">
                    <TabButton active={activeTab === 'appointments'} onClick={() => setActiveTab('appointments')} icon={<Stethoscope size={20} />} label="Hospitals" count={data?.appointments?.length || 0} />
                    <TabButton active={activeTab === 'reservations'} onClick={() => setActiveTab('reservations')} icon={<Utensils size={20} />} label="Restaurants" count={data?.reservations?.length || 0} />
                    <TabButton active={activeTab === 'meetings'} onClick={() => setActiveTab('meetings')} icon={<Briefcase size={20} />} label="Business" count={data?.meetings?.length || 0} />
                    <TabButton active={activeTab === 'orders'} onClick={() => setActiveTab('orders')} icon={<ShoppingBag size={20} />} label="E-Commerce" count={data?.orders?.length || 0} />
                    <TabButton active={activeTab === 'feedback'} onClick={() => setActiveTab('feedback')} icon={<Star size={20} />} label="Ratings" count={data?.feedback?.length || 0} />
                </nav>

                <div className="mt-auto pt-4 border-t border-slate-100">
                    <button onClick={onLogout} className="w-full flex items-center space-x-3 px-3 py-2.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all font-bold text-xs uppercase tracking-widest leading-none">
                        <LogOut size={16} />
                        <span>Sign Out Account</span>
                    </button>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col min-h-screen overflow-hidden">
                <header className="h-10 bg-white border-b border-slate-100 flex items-center justify-between px-6 sticky top-0 z-40 bg-white/80 backdrop-blur-md">
                    <div className="flex items-center space-x-2">
                        <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></div>
                        <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Live Sync</span>
                    </div>
                    <div className="flex items-center space-x-3">
                        <div className="text-right hidden md:block">
                            <p className="text-xs font-black text-slate-900 leading-none">
                                {user?.profile?.full_name || user?.user_metadata?.full_name || user?.fullName || 'User'}
                            </p>
                            <p className="text-[8px] text-slate-400 font-bold tracking-widest uppercase">{user?.email}</p>
                        </div>
                        <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white text-xs font-black shadow-md">
                            {(user?.profile?.full_name || user?.user_metadata?.full_name || 'U').charAt(0)}
                        </div>
                    </div>
                </header>

                <main className="flex-1 overflow-y-auto p-4 bg-[#F8FAFC]">
                    <div className="max-w-4xl mx-auto">


                        <AnimatePresence mode="wait">
                            <motion.div key={activeTab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                                <div className="flex items-center justify-between mb-6">
                                    <h2 className="text-2xl font-black text-slate-900 tracking-tight capitalize">{activeTab}</h2>
                                    <span className="px-3 py-1 bg-white border border-slate-100 rounded-full text-[9px] font-black text-slate-400 uppercase tracking-widest">{currentTabRecords.length} Records</span>
                                </div>

                                {currentTabRecords.length === 0 ? (
                                    <div className="py-24 text-center border-2 border-dashed border-slate-200 rounded-[40px] bg-white">
                                        <div className="bg-slate-50 w-24 h-24 rounded-[32px] flex items-center justify-center mx-auto mb-6 text-slate-300">
                                            <Calendar size={40} />
                                        </div>
                                        <p className="text-slate-500 font-black uppercase tracking-widest text-xs">No Cloud Sync Data Found</p>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 gap-4">
                                        {currentTabRecords.map((record) => (
                                            <RecordCard
                                                key={record.id}
                                                record={record}
                                                type={activeTab}
                                                formatDate={formatDate}
                                                getStatusStyle={getStatusStyle}
                                            />
                                        ))}
                                    </div>
                                )}
                            </motion.div>
                        </AnimatePresence>
                    </div>
                </main>
            </div>
        </div>
    );
};

const RecordCard = ({ record, type, formatDate, getStatusStyle }) => {
    const isOrder = type === 'orders';
    const isHospital = type === 'appointments';
    const isRestaurant = type === 'reservations';
    const isBusiness = type === 'meetings';
    const isFeedback = type === 'feedback';

    return (
        <motion.div layout className="record-card-horizontal p-3.5 rounded-[22px] flex items-center gap-4 border border-slate-100 bg-white">
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${isHospital ? 'bg-blue-50 text-blue-600' :
                isRestaurant ? 'bg-orange-50 text-orange-600' :
                    isOrder ? 'bg-emerald-50 text-emerald-600' :
                        isBusiness ? 'bg-indigo-50 text-indigo-600' : 'bg-amber-50 text-amber-600'
                }`}>
                {isHospital ? <Stethoscope size={22} /> :
                    isRestaurant ? <Utensils size={22} /> :
                        isOrder ? <ShoppingBag size={22} /> :
                            isBusiness ? <Briefcase size={22} /> : <Star size={22} />}
            </div>

            <div className="flex-1 min-w-0">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <h3 className="font-black text-slate-900 text-lg tracking-tight truncate">
                            {String(record.title || (isHospital ? (record.doctors?.doctor_name || 'Medical Specialist') :
                                isRestaurant ? (`Table #${record.restaurant_tables?.table_number || 'TBD'}`) :
                                    isBusiness ? (record.staff?.name || 'HR/Manager Meeting') :
                                        isOrder ? (record.products?.name || 'E-Commerce Item') :
                                            `Feedback Rating`)).replace(/[\[\]{}"']/g, '').replace(/(?:dish|item|name|product|title|guest|guests):\s*/gi, '').replace(/\s*\([^)]+\)/g, '').trim() || 'Reservation'}
                        </h3>
                        {record.company_name && (
                            <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest opacity-80 mb-1">
                                {record.company_name}
                            </p>
                        )}
                        <div className="flex items-center gap-4 text-xs font-bold text-slate-400 mt-1">
                            {record.date && !record.date.includes('{') && !record.date.includes('?') && record.date.length < 50 && (
                                <div className="flex items-center">
                                    <Clock size={14} className="mr-1.5" />
                                    {formatDate(record.date)} {record.time && !record.time.includes('{') && !record.time.includes('?') && record.time.length < 50 ? `• ${record.time}` : ''}
                                </div>
                            )}
                            {isFeedback && (
                                <div className="flex items-center gap-1">
                                    {[...Array(5)].map((_, i) => (
                                        <Star key={i} size={14} className={i < record.rating ? "text-amber-400 fill-amber-400" : "text-slate-100 fill-slate-100"} />
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        {record.status && (
                            <span className={`px-4 py-1.5 rounded-xl text-[10px] font-black border uppercase tracking-widest ${getStatusStyle(record.status)}`}>
                                {record.status}
                            </span>
                        )}
                        <button className="p-2 text-slate-200 hover:text-rose-500 transition-all opacity-0 group-hover:opacity-100">
                            <Trash2 size={18} />
                        </button>
                    </div>
                </div>
            </div>
        </motion.div>
    );
};

const TabButton = ({ active, onClick, icon, label, count }) => (
    <button
        onClick={onClick}
        className={`w-full flex items-center px-4 py-3 rounded-xl transition-all duration-300 group ${active ? 'bg-indigo-50 text-indigo-600' : 'text-slate-500 hover:text-indigo-600 hover:bg-indigo-50/50'}`}
    >
        <span className={`${active ? 'text-indigo-600' : 'text-slate-400 group-hover:text-indigo-600'}`}>{icon}</span>
        <span className={`flex-1 text-left font-black ml-3 text-xs tracking-tight ${active ? 'text-indigo-600' : ''}`}>{label}</span>
        {count > 0 && <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-black ${active ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'}`}>{count}</span>}
    </button>
);

export default UserDashboard;
