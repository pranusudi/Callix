import { useRef } from 'react';
import { motion } from 'framer-motion';
import { Building2, Bot, ShieldCheck, Sparkles, ChevronLeft, ChevronRight } from 'lucide-react';

const AccountPortfolio = ({ onDeployAgent, companies = [], loading = false, isLoggedIn = false, onLoginRequired }) => {
  const scrollRef = useRef(null);

  const scroll = (direction) => {
    if (scrollRef.current) {
      const { scrollLeft, clientWidth } = scrollRef.current;
      const scrollTo = direction === 'left' ? scrollLeft - clientWidth / 2 : scrollLeft + clientWidth / 2;
      scrollRef.current.scrollTo({ left: scrollTo, behavior: 'smooth' });
    }
  };

  const handleDeploy = (company) => {
    if (onDeployAgent) {
      onDeployAgent(company);
    }
  };

  const getIndustryStyles = (industry = '') => {
    const ind = industry.toLowerCase();
    if (ind.includes('health')) return { bg: 'bg-emerald-500/10', text: 'text-emerald-600', border: 'border-emerald-500/20' };
    if (ind.includes('food') || ind.includes('restaur')) return { bg: 'bg-orange-500/10', text: 'text-orange-600', border: 'border-orange-500/20' };
    if (ind.includes('tech')) return { bg: 'bg-blue-500/10', text: 'text-blue-600', border: 'border-blue-500/20' };
    if (ind.includes('commerce')) return { bg: 'bg-purple-500/10', text: 'text-purple-600', border: 'border-purple-500/20' };
    return { bg: 'bg-slate-500/10', text: 'text-slate-600', border: 'border-slate-500/20' };
  };

  return (
    <section id="portfolio" className="py-20 px-4 bg-white relative overflow-hidden text-slate-900">
      {/* Subtle Background Glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[500px] bg-blue-600/5 blur-[120px] pointer-events-none"></div>

      <div className="max-w-7xl mx-auto relative z-10">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mb-12"
        >
          <h2 className="text-3xl md:text-4xl font-black text-slate-900 tracking-tight">Portfolio</h2>
          <p className="text-slate-500 text-sm font-medium mt-1">Manage and deploy your automated AI instances.</p>
        </motion.div>

        {loading ? (
          <div className="flex gap-6 overflow-hidden">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="min-w-[280px] h-64 bg-white/5 animate-pulse rounded-2xl border border-white/5 flex-shrink-0"></div>
            ))}
          </div>
        ) : companies.length === 0 ? (
          <div className="text-center py-20 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
            <Building2 size={32} className="mx-auto text-slate-400 mb-3" />
            <h3 className="text-lg font-bold text-slate-900">No active instances</h3>
            <p className="text-slate-600 text-sm">Deploy your first company profile to see it here.</p>
          </div>
        ) : (
          <div className="relative group/portfolio">
            {/* Left Scroll Button */}
            <div className="absolute left-4 top-1/2 -translate-y-1/2 z-20 opacity-0 group-hover/portfolio:opacity-100 transition-all duration-300 pointer-events-none lg:pointer-events-auto">
              <button
                onClick={() => scroll('left')}
                className="w-12 h-12 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-900 hover:bg-slate-50 transition-all shadow-xl backdrop-blur-2xl group/btn"
              >
                <ChevronLeft size={24} className="group-hover/btn:-translate-x-0.5 transition-transform" />
              </button>
            </div>

            {/* Right Scroll Button */}
            <div className="absolute right-4 top-1/2 -translate-y-1/2 z-20 opacity-0 group-hover/portfolio:opacity-100 transition-all duration-300 pointer-events-none lg:pointer-events-auto">
              <button
                onClick={() => scroll('right')}
                className="w-12 h-12 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-900 hover:bg-slate-50 transition-all shadow-xl backdrop-blur-2xl group/btn"
              >
                <ChevronRight size={24} className="group-hover/btn:translate-x-0.5 transition-transform" />
              </button>
            </div>

            {/* Fade Gradients for visual depth */}
            <div className="absolute left-0 top-0 bottom-0 w-20 bg-gradient-to-r from-white to-transparent z-10 pointer-events-none" />
            <div className="absolute right-0 top-0 bottom-0 w-20 bg-gradient-to-l from-white to-transparent z-10 pointer-events-none" />

            <div
              ref={scrollRef}
              className="flex overflow-x-auto pb-10 gap-6 snap-x snap-mandatory scroll-smooth hide-scrollbar p-1 px-12"
            >
              {companies.map((company, index) => {
                const styles = getIndustryStyles(company.industry);
                return (
                  <motion.div
                    key={company.id || index}
                    className="min-w-[280px] max-w-[280px] bg-white rounded-[2rem] p-5 border border-slate-200 hover:border-blue-500/50 hover:bg-slate-50 transition-all duration-300 flex flex-col h-full group flex-shrink-0 snap-center shadow-sm"
                    initial={{ opacity: 0, scale: 0.9, y: 20 }}
                    whileInView={{ opacity: 1, scale: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: index * 0.03, duration: 0.3 }}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="w-12 h-12 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center text-2xl group-hover:scale-110 transition-transform duration-500 shadow-sm">
                        {company.logo || '🏢'}
                      </div>
                      <div className={`px-2.5 py-1 rounded-full text-[8px] font-black uppercase tracking-widest ${styles.bg} ${styles.text} border ${styles.border}`}>
                        {company.industry}
                      </div>
                    </div>

                    <h3 className="text-lg font-black text-slate-900 leading-tight mb-3 tracking-tight">
                      {company.name}
                    </h3>

                    <div className="flex-1 bg-slate-50 p-3.5 rounded-2xl mb-4 border border-slate-200">
                      <div className="flex items-center gap-1.5 mb-2">
                        <Sparkles size={10} className="text-blue-400" />
                        <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Capabilities</span>
                      </div>
                      <p className="text-[11px] text-slate-300 font-medium leading-normal line-clamp-2">
                        {company.contextSummary || 'Standard AI Intelligence Pattern'}
                      </p>
                    </div>

                    <div className="flex items-center justify-between text-[9px] font-black mb-5 px-1">
                      <span className="flex items-center gap-1 text-slate-500 uppercase tracking-widest leading-none">
                        <ShieldCheck size={10} className={`${company.status === 'active' ? 'text-emerald-500' : 'text-amber-500'} shadow-lg`} />
                        {company.status === 'active' ? 'Verified' : 'Provisioning'}
                      </span>
                      <span className={company.status === 'active' ? 'text-emerald-500' : 'text-amber-500 uppercase tracking-widest'}>
                        {company.status?.toUpperCase() || 'ACTIVE'}
                      </span>
                    </div>

                    <button
                      onClick={() => isLoggedIn ? handleDeploy(company) : onLoginRequired()}
                      className={`w-full py-3 rounded-2xl font-black text-[9px] uppercase tracking-widest flex items-center justify-center space-x-2 transition-all duration-300 ${isLoggedIn
                        ? 'bg-blue-600 text-white hover:bg-blue-500 shadow-xl shadow-blue-500/20'
                        : 'bg-transparent border border-white/20 text-white hover:bg-white/10'}`}
                    >
                      <Bot size={14} />
                      <span>{isLoggedIn ? 'Launch Agent' : 'Sign In To Deploy'}</span>
                    </button>
                  </motion.div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

export default AccountPortfolio;
