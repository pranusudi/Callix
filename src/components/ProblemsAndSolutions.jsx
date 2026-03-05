import { motion } from 'framer-motion';
import { useState } from 'react';
import { X, Check, Sparkles, Globe, Zap, Database, MessageSquare, Shield, Users, Clock } from 'lucide-react';

const ProblemsAndSolutions = () => {
    const [hoveredIndex, setHoveredIndex] = useState(null);

    const features = [
        {
            icon: Globe,
            problem: "Limited Language Support",
            problemDesc: "Most AI agents only work in English",
            solution: "Multiple Languages Supported",
            solutionDesc: "English, Hindi, Telugu",
            color: "from-blue-500 to-cyan-500"
        },
        {
            icon: Zap,
            problem: "No Real-time Interaction",
            problemDesc: "Slow response times and delays",
            solution: "Instant Responses",
            solutionDesc: "Powered by Groq's lightning-fast AI engine",
            color: "from-purple-500 to-pink-500"
        },
        // {
        //     icon: Database,
        //     problem: "Complex Integration",
        //     problemDesc: "Difficult to connect with existing systems",
        //     solution: "Simple Setup",
        //     solutionDesc: "Connect your Supabase database in minutes",
        //     color: "from-green-500 to-emerald-500"
        // },
        {
            icon: Database,
            problem: "Complex Integration",
            problemDesc: "Difficult to connect with existing systems",
            solution: "Simple Setup",
            solutionDesc: "Connect your Supabase database in minutes",
            color: "from-green-500 to-emerald-500"
        },
        {
            icon: MessageSquare,
            problem: "No CRM Integration",
            problemDesc: "Manual tracking of customer interactions",
            solution: "Built-in CRM",
            solutionDesc: "Automatic call logging and customer tracking",
            color: "from-orange-500 to-red-500"
        },
        {
            icon: Users,
            problem: "No User Management",
            problemDesc: "Can't track individual users",
            solution: "User Dashboard",
            solutionDesc: "Complete user profiles and appointment history",
            color: "from-indigo-500 to-purple-500"
        },
        {
            icon: Clock,
            problem: "Limited Availability",
            problemDesc: "Only works during business hours",
            solution: "24/7 Availability",
            solutionDesc: "AI agent works round the clock",
            color: "from-pink-500 to-rose-500"
        },
        {
            icon: Shield,
            problem: "Security Concerns",
            problemDesc: "Data privacy and security issues",
            solution: "Enterprise Security",
            solutionDesc: "End-to-end encryption and secure authentication",
            color: "from-teal-500 to-cyan-500"
        }
    ];

    return (
        <section id="features" className="py-20 px-4 bg-white relative overflow-hidden">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <motion.div
                    initial={{ opacity: 0, y: 30 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                    className="text-center mb-16"
                >
                    <h2 className="text-4xl md:text-5xl font-black text-slate-900 mb-6 tracking-tighter">
                        Features
                    </h2>
                </motion.div>

                {/* Full Width Flex Cards */}
                <motion.div
                    initial="hidden"
                    whileInView="show"
                    viewport={{ once: true }}
                    variants={{
                        hidden: { opacity: 0 },
                        show: {
                            opacity: 1,
                            transition: {
                                staggerChildren: 0.1
                            }
                        }
                    }}
                    className="flex gap-4 w-full h-[350px]"
                >
                    {features.map((feature, index) => {
                        const Icon = feature.icon;
                        const isHovered = hoveredIndex === index;

                        return (
                            <motion.div
                                key={index}
                                variants={{
                                    hidden: { opacity: 0, y: 50, scale: 0.9 },
                                    show: { opacity: 1, y: 0, scale: 1 }
                                }}
                                onMouseEnter={() => setHoveredIndex(index)}
                                onMouseLeave={() => setHoveredIndex(null)}
                                className={`relative cursor-pointer transition-all duration-700 ease-in-out ${isHovered ? 'flex-[4]' : 'flex-[0.8]'}`}
                                style={{
                                    minWidth: isHovered ? '400px' : '80px'
                                }}
                            >
                                <motion.div
                                    className={`h-full rounded-[2.5rem] overflow-hidden shadow-2xl transition-all duration-500 border border-white/5 ${isHovered ? 'bg-[#0F172A]' : `bg-gradient-to-br ${feature.color}`
                                        }`}
                                >
                                    {/* Collapsed State - Horizontal Text */}
                                    {!isHovered && (
                                        <div className="h-full flex flex-col items-center justify-center p-4 text-white">
                                            <Icon size={32} className="mb-6 drop-shadow-lg" />
                                            <div className="flex flex-col items-center">
                                                {feature.solution.split(' ').map((word, i) => (
                                                    <span key={i} className="text-[10px] font-black uppercase tracking-tighter leading-tight text-center">
                                                        {word}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Expanded State */}
                                    {isHovered && (
                                        <motion.div
                                            initial={{ opacity: 0, scale: 0.95 }}
                                            animate={{ opacity: 1, scale: 1 }}
                                            transition={{ duration: 0.4 }}
                                            className="p-8 h-full flex flex-col justify-between"
                                        >
                                            {/* Problem Section */}
                                            <div className="space-y-4">
                                                <div className="flex items-center space-x-3">
                                                    <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center border border-red-500/20">
                                                        <X size={14} className="text-red-500" />
                                                    </div>
                                                    <h4 className="text-[10px] font-black uppercase text-red-500 tracking-widest">The Problem</h4>
                                                </div>
                                                <div>
                                                    <h3 className="text-xl font-black text-white mb-2 leading-none">
                                                        {feature.problem}
                                                    </h3>
                                                    <p className="text-sm text-slate-400 font-medium leading-relaxed">
                                                        {feature.problemDesc}
                                                    </p>
                                                </div>
                                            </div>

                                            {/* Solution Section */}
                                            <div className="space-y-4">
                                                <div className="flex items-center space-x-3">
                                                    <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${feature.color} flex items-center justify-center shadow-lg shadow-indigo-500/20`}>
                                                        <Check size={14} className="text-white" />
                                                    </div>
                                                    <h4 className="text-[10px] font-black uppercase text-indigo-400 tracking-widest">Callix Evolution</h4>
                                                </div>
                                                <div className={`p-6 rounded-3xl bg-gradient-to-br ${feature.color} shadow-2xl relative overflow-hidden group`}>
                                                    <div className="absolute top-0 right-0 p-4 opacity-10 translate-x-4 -translate-y-4 group-hover:translate-x-0 group-hover:translate-y-0 transition-transform duration-700">
                                                        <Icon size={80} />
                                                    </div>
                                                    <h3 className="text-xl font-black text-white mb-2 relative z-10">
                                                        {feature.solution}
                                                    </h3>
                                                    <p className="text-sm text-white font-bold opacity-90 leading-relaxed relative z-10">
                                                        {feature.solutionDesc}
                                                    </p>
                                                </div>
                                            </div>
                                        </motion.div>
                                    )}
                                </motion.div>
                            </motion.div>
                        );
                    })}
                </motion.div>
                {/* Bottom CTA */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    className="text-center mt-8"
                >
                    {/* <p className="text-xl font-bold text-white mb-4">
                        Experience all these features today
                    </p>
                    <motion.button
                        className="px-8 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all"
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                    >
                        Start Free Trial
                    </motion.button> */}
                </motion.div>
            </div>

        </section>
    );
};

export default ProblemsAndSolutions;
