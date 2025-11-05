/**
 * Key Derivation Demo Page
 *
 * 展示安全密钥派生功能的独立页面
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { SecureKeyDerivation } from '../components/SecureKeyDerivation';

export const KeyDerivationPage: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div className="space-y-4 text-gray-900 dark:text-gray-100 overflow-visible pb-4 md:pb-0 w-full max-w-full">
      {/* Main Card Container */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden transition-shadow duration-200 hover:shadow-lg dark:hover:shadow-slate-900/60 p-4 sm:p-8">
        {/* Page Title */}
        <div className="text-center mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-4xl font-bold text-gray-900 dark:text-gray-100 mb-2 sm:mb-3">
            {t('keyDerivation.title')}
          </h1>
          <p className="text-sm sm:text-lg text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">
            {t('keyDerivation.subtitle')}
          </p>
        </div>

        {/* Main Content */}
        <div>
          <SecureKeyDerivation />
        </div>

        {/* Bottom Info */}
        <div className="mt-6 sm:mt-8 text-center">
          <div className="inline-block bg-blue-50 dark:bg-blue-900/20 rounded-lg px-4 sm:px-6 py-3 sm:py-4 border border-blue-200 dark:border-blue-800 w-full sm:w-auto">
            <div className="text-xs sm:text-sm text-blue-800 dark:text-blue-200 space-y-2">
              <div className="font-bold">{t('keyDerivation.howItWorks')}</div>
              <div className="text-[11px] sm:text-xs max-w-2xl">
                {t('keyDerivation.description')}
              </div>
              <div className="text-[11px] sm:text-xs text-blue-600 dark:text-blue-300 mt-2">
                {t('keyDerivation.note')}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default KeyDerivationPage;
