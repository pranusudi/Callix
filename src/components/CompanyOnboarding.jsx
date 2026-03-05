import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Building2, Key, FileText, Briefcase, Globe, Loader } from 'lucide-react';
import { database } from '../utils/database.js';
import { chatWithGroq } from '../utils/groq.js';

const CompanyOnboarding = ({ isOpen, onClose, onSuccess }) => {
  const [formData, setFormData] = useState({
    name: '',
    industry: '',
    contextSummary: '',
    apiKey: '',
    websiteUrl: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const industries = [
    'Technology', 'Healthcare', 'Finance', 'E-commerce',
    'Retail', 'Manufacturing', 'Education', 'Real Estate',
    'Food & Beverage', 'Transportation', 'Other'
  ];


  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      // Save company to MongoDB via backend
      const company = await database.saveCompany({
        ...formData,
        logo: formData.industry === 'Healthcare' ? '🏥' : '🏢',
        nlp_context: formData.contextSummary,
        context_summary: formData.contextSummary
      });

      const companyId = company.id;

      // Add sample doctors for hospitals/healthcare
      if (formData.industry === 'Healthcare') {
        const sampleDoctors = [
          { doctor_name: 'Dr. Sarah Johnson', specialization: 'Cardiology', fee: 1500, company_id: companyId },
          { doctor_name: 'Dr. Michael Chen', specialization: 'Pediatrics', fee: 1200, company_id: companyId },
        ];
        for (const doctor of sampleDoctors) {
          await database.saveDoctor(doctor);
        }
      }

      // Add sample menu for restaurants
      if (formData.industry === 'Food & Beverage') {
        const sampleMenu = [
          { item_name: 'Paneer Butter Masala', price: 350, category: 'Main Course', company_id: companyId },
          { item_name: 'Veg Biryani', price: 280, category: 'Rice', company_id: companyId },
        ];
        for (const item of sampleMenu) {
          await database.saveMenuItem(item);
        }
      }

      // Add sample products for e-commerce
      if (formData.industry === 'E-Commerce') {
        const sampleProducts = [
          { name: 'Wireless Headphones', price: 2999, stock: 50, category: 'Electronics', company_id: companyId },
          { name: 'Smart Watch', price: 4999, stock: 30, category: 'Electronics', company_id: companyId },
        ];
        for (const product of sampleProducts) {
          await database.saveProduct(product);
        }
      }


      onSuccess(company);

      // Reset form
      setFormData({
        name: '',
        industry: '',
        contextSummary: '',
        apiKey: '',
        websiteUrl: '',
      });

      onClose();
    } catch (error) {
      console.error('Error saving company:', error);
      alert('Failed to save company. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="bg-slate-50 rounded-3xl p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-slate-200 shadow-2xl"
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 20 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-8">
              <div>
                <h2 className="text-3xl font-black text-slate-900">
                  Connect Database
                </h2>
                <p className="text-slate-500 mt-1">Train your AI agent on your company data</p>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-900 transition-all"
              >
                <X size={24} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Company Name */}
                <div>
                  <label className="flex items-center space-x-2 text-sm font-bold text-slate-500 mb-2">
                    <Building2 size={16} />
                    <span>COMPANY NAME</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl bg-white border border-slate-200 focus:border-blue-500 focus:outline-none text-slate-900 shadow-sm transition-all"
                    placeholder="e.g. Acme Corp"
                  />
                </div>

                {/* Industry */}
                <div>
                  <label className="flex items-center space-x-2 text-sm font-bold text-slate-400 mb-2">
                    <Briefcase size={16} />
                    <span>INDUSTRY</span>
                  </label>
                  <select
                    required
                    value={formData.industry}
                    onChange={(e) => setFormData({ ...formData, industry: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl bg-white border border-slate-200 focus:border-blue-500 focus:outline-none text-slate-900 shadow-sm transition-all"
                  >
                    <option value="">Select Category</option>
                    {industries.map((industry) => (
                      <option key={industry} value={industry}>{industry}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* API Key */}
              <div>
                <label className="flex items-center space-x-2 text-sm font-bold text-slate-400 mb-2">
                  <Key size={16} />
                  <span>SECURE API KEY</span>
                </label>
                <input
                  type="password"
                  value={formData.apiKey}
                  onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl bg-white border border-slate-200 focus:border-blue-500 focus:outline-none text-slate-900 shadow-sm transition-all"
                  placeholder="Your database connection key"
                />
              </div>

              {/* NLP Context Summary */}
              <div>
                <label className="flex items-center space-x-2 text-sm font-bold text-slate-400 mb-2">
                  <FileText size={16} />
                  <span>AI TRAINING CONTEXT</span>
                </label>
                <textarea
                  required
                  value={formData.contextSummary}
                  onChange={(e) => setFormData({ ...formData, contextSummary: e.target.value })}
                  rows={4}
                  className="w-full px-4 py-3 rounded-xl bg-white border border-slate-200 focus:border-blue-500 focus:outline-none text-slate-900 resize-none shadow-sm transition-all"
                  placeholder="Tell the AI what it should know about your business, products, and services..."
                />
              </div>

              {/* Submit Buttons */}
              <div className="flex space-x-4 pt-6">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-6 py-4 rounded-2xl bg-slate-100 text-slate-900 font-bold hover:bg-slate-200 transition-all border border-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 px-6 py-4 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold shadow-xl shadow-blue-600/30 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
                >
                  {isSubmitting ? 'Syncing...' : 'Complete Onboarding'}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default CompanyOnboarding;