/**
 * Secure Key Derivation Component
 *
 * UI component for deriving secure private keys from PersonHash
 */

import React, { useState, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Key, Copy, Loader, Eye, EyeOff, CheckCircle } from 'lucide-react';
import { useToast } from './ToastProvider';
import { PersonHashCalculator } from './PersonHashCalculator';
import type { HashForm, PersonHashCalculatorHandle, PublicHashForm } from './PersonHashCalculator';
import ConfirmDialog from './ConfirmDialog';
import { validatePassphraseStrength, estimateKDFDuration, type KDFPreset } from '../lib/secureKeyDerivation';
import { normalizeNameForHash } from '../lib/passphraseStrength';
import { cryptoWorkerCall } from '../lib/cryptoWorkerClient';
import { sanitizeErrorForLogging } from '../lib/errors';

interface SecureKeyDerivationProps {
  className?: string;
}

export const SecureKeyDerivation: React.FC<SecureKeyDerivationProps> = ({ className = '' }) => {
  const { t } = useTranslation();
  const toast = useToast();

  const [publicFormData, setPublicFormData] = useState<PublicHashForm | null>(null);
  const [kdfPreset, setKdfPreset] = useState<KDFPreset>('BALANCED');
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressStage, setProgressStage] = useState('');
  const [derivedKey, setDerivedKey] = useState<string | null>(null);
  const [derivedAddress, setDerivedAddress] = useState<string | null>(null);
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [showWeakPassphraseConfirm, setShowWeakPassphraseConfirm] = useState(false);
  const [weakPassphraseMessage, setWeakPassphraseMessage] = useState('');
  const personCalcRef = useRef<PersonHashCalculatorHandle | null>(null);

  const buildHashFormOrNull = useCallback((): HashForm | null => {
    const calc = personCalcRef.current;
    const pub = calc?.getPublicFormData();
    const secret = calc?.getSecretInputs();
    if (!calc || !pub || !secret) return null;
    const { hasPassphrase: _hasPassphrase, ...publicFields } = pub;
    return { ...publicFields, passphrase: secret.passphrase };
  }, []);

  // Estimate duration
  const estimatedTime = useMemo(() => {
    return estimateKDFDuration(kdfPreset);
  }, [kdfPreset]);

  const startDerivation = useCallback(async () => {
    const formData = buildHashFormOrNull();
    if (!formData) {
      toast.show(t('keyDerivation.component.fillInfoFirst'));
      return;
    }

    if (!normalizeNameForHash(formData.fullName || '').length) {
      toast.show(t('keyDerivation.component.nameRequired'));
      return;
    }

    setIsGenerating(true);
    setProgress(0);
    setProgressStage('');
    setDerivedKey(null);
    setDerivedAddress(null);

    try {
      setProgress(25);
      setProgressStage(t('keyDerivation.component.progress.preparingKDF'));
      const result = await cryptoWorkerCall(
        'deriveKey',
        { input: formData, purpose: 'PRIVATE_KEY', preset: kdfPreset },
        { timeoutMs: 180_000 }
      );

      setProgress(100);
      setProgressStage(t('keyDerivation.component.progress.keyDerivationComplete'));

      setDerivedKey(result.key);
      setDerivedAddress(result.address || null);
      toast.show(t('keyDerivation.component.success'));
    } catch (error) {
      console.error('Key derivation failed:', sanitizeErrorForLogging(error));
      toast.show(t('keyDerivation.component.failed'));
    } finally {
      setIsGenerating(false);
      setProgress(0);
      setProgressStage('');
    }
  }, [buildHashFormOrNull, kdfPreset, toast, t]);

  // Generate private key
  const handleGenerateKey = () => {
    const formData = buildHashFormOrNull();
    if (!formData) {
      toast.show(t('keyDerivation.component.fillInfoFirst'));
      return;
    }

    if (!normalizeNameForHash(formData.fullName || '').length) {
      toast.show(t('keyDerivation.component.nameRequired'));
      return;
    }

    // Check passphrase strength (without lifting passphrase into component state)
    const strength = validatePassphraseStrength(formData.passphrase || '');
    if (strength && !strength.isStrong) {
      const rawBits = Math.round(strength.rawEntropy ?? 0);
      const adjustedBits = Math.round(strength.entropy ?? 0);
      const recommendation =
        adjustedBits === 0
          ? t('keyDerivation.component.recommendations.empty')
          : strength.level === 'weak'
            ? t('keyDerivation.component.recommendations.weak', { raw: rawBits, adjusted: adjustedBits })
            : strength.level === 'medium'
              ? t('keyDerivation.component.recommendations.medium', { raw: rawBits, adjusted: adjustedBits })
              : strength.level === 'strong'
                ? t('keyDerivation.component.recommendations.strong', { raw: rawBits, adjusted: adjustedBits })
                : strength.level === 'very-strong'
                  ? t('keyDerivation.component.recommendations.veryStrong', { raw: rawBits, adjusted: adjustedBits })
                  : t('keyDerivation.component.recommendations.excellent', { raw: rawBits, adjusted: adjustedBits });

      setWeakPassphraseMessage(
        [
          t('keyDerivation.component.weakPassphraseMessage'),
          recommendation,
          t('keyDerivation.component.weakPassphraseContinue'),
        ].join('\n\n')
      );
      setShowWeakPassphraseConfirm(true);
      return;
    }

    void startDerivation();
  };

  // Copy to clipboard (robust version)
  const copyToClipboard = async (text: string, label: string) => {
    try {
      // Try modern API
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
        toast.show(t('keyDerivation.component.copied', { label }));
        return;
      }
    } catch (err) {
      console.warn('Clipboard API failed, trying fallback:', err);
    }

    // Fallback: use textarea
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(ta);

      if (successful) {
        toast.show(t('keyDerivation.component.copied', { label }));
      } else {
        toast.show(t('keyDerivation.component.copyFailed'));
      }
    } catch (err) {
      console.error('Copy failed:', sanitizeErrorForLogging(err));
      toast.show(t('keyDerivation.component.copyFailed'));
    }
  };

  return (
    <div className={`space-y-4 sm:space-y-6 ${className}`}>
      {/* Title and description */}
      <div className="bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 rounded-lg p-3 sm:p-4 border border-indigo-200 dark:border-indigo-800">
        <div className="flex items-center gap-2 sm:gap-3 mb-2">
          <Key className="text-indigo-600 dark:text-indigo-400 flex-shrink-0" size={20} />
          <h2 className="text-base sm:text-lg font-bold text-gray-800 dark:text-gray-100">
            {t('keyDerivation.component.title')}
          </h2>
        </div>
        <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
          {t('keyDerivation.component.description')}
          <span className="text-orange-600 dark:text-orange-400 font-semibold block sm:inline mt-1 sm:mt-0"> {t('keyDerivation.component.passphraseWarning')}</span>
        </p>
      </div>

      {/* PersonHash Calculator */}
      <PersonHashCalculator
        ref={personCalcRef}
        showTitle={false}
        onPublicFormChange={setPublicFormData}
        className="border-0 shadow-none"
      />

      {/* KDF strength selection */}
      <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 sm:p-4 space-y-3">
        <label className="block text-xs sm:text-sm font-semibold text-gray-700 dark:text-gray-300">
          {t('keyDerivation.component.kdfStrength')}
        </label>
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {(['FAST', 'BALANCED', 'STRONG'] as KDFPreset[]).map((preset) => (
            <button
              key={preset}
              onClick={() => setKdfPreset(preset)}
              disabled={isGenerating}
              className={`px-2 sm:px-4 py-2 sm:py-3 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                kdfPreset === preset
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600'
              } ${isGenerating ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className="font-bold truncate">{preset}</div>
              <div className="text-[10px] sm:text-xs mt-0.5 sm:mt-1 opacity-80">
                {preset === 'FAST' && t('keyDerivation.component.presets.testing')}
                {preset === 'BALANCED' && t('keyDerivation.component.presets.recommended')}
                {preset === 'STRONG' && t('keyDerivation.component.presets.strongest')}
              </div>
            </button>
          ))}
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {t('keyDerivation.component.estimatedTime')} {estimatedTime}
        </div>
      </div>

      {/* Generate button */}
      <button
        onClick={handleGenerateKey}
        disabled={isGenerating || !normalizeNameForHash(publicFormData?.fullName || '').length}
        className={`w-full py-3 sm:py-4 rounded-lg font-semibold text-sm sm:text-base text-white transition-all ${
          isGenerating || !normalizeNameForHash(publicFormData?.fullName || '').length
            ? 'bg-gray-400 cursor-not-allowed'
            : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 shadow-lg hover:shadow-xl'
        }`}
      >
        {isGenerating ? (
          <div className="flex items-center justify-center gap-2 sm:gap-3">
            <Loader className="animate-spin" size={18} />
            <span>{t('keyDerivation.component.deriving', { progress })}</span>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2">
            <Key size={18} />
            <span>{t('keyDerivation.component.deriveButton')}</span>
          </div>
        )}
      </button>

      {/* Progress bar */}
      {isGenerating && (
        <div className="space-y-2">
          <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-indigo-600 to-purple-600 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 text-center">
            {progressStage}
          </div>
        </div>
      )}

      {/* Result display */}
      {derivedKey && derivedAddress && (
        <div className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-lg p-4 sm:p-6 border-2 border-green-300 dark:border-green-700 space-y-3 sm:space-y-4">
          <div className="flex items-center gap-2 text-green-700 dark:text-green-300 font-bold">
            <CheckCircle size={20} className="flex-shrink-0" />
            <span className="text-base sm:text-lg">{t('keyDerivation.component.derivedSuccess')}</span>
          </div>

          {/* Ethereum address */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
              {t('keyDerivation.component.ethereumAddress')}
            </label>
            <div className="flex items-start sm:items-center gap-2 bg-white dark:bg-gray-800 rounded-lg p-2 sm:p-3 border border-gray-300 dark:border-gray-600">
              <code className="flex-1 text-xs sm:text-sm font-mono text-gray-800 dark:text-gray-200 break-all leading-relaxed">
                {derivedAddress}
              </code>
              <button
                onClick={() => copyToClipboard(derivedAddress, t('keyDerivation.component.address'))}
                className="flex-shrink-0 p-1.5 sm:p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition"
              >
                <Copy size={14} className="text-gray-600 dark:text-gray-400" />
              </button>
            </div>
          </div>

          {/* Private key */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
              {t('keyDerivation.component.privateKey')}
            </label>
            <div className="flex items-start sm:items-center gap-1.5 sm:gap-2 bg-white dark:bg-gray-800 rounded-lg p-2 sm:p-3 border border-gray-300 dark:border-gray-600">
              <code className="flex-1 text-xs sm:text-sm font-mono text-gray-800 dark:text-gray-200 break-all leading-relaxed min-w-0">
                {showPrivateKey ? derivedKey : '•'.repeat(66)}
              </code>
              <div className="flex flex-col sm:flex-row gap-1 flex-shrink-0">
                <button
                  onClick={() => setShowPrivateKey(!showPrivateKey)}
                  className="p-1.5 sm:p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition"
                >
                  {showPrivateKey ? (
                    <EyeOff size={14} className="text-gray-600 dark:text-gray-400" />
                  ) : (
                    <Eye size={14} className="text-gray-600 dark:text-gray-400" />
                  )}
                </button>
                <button
                  onClick={() => copyToClipboard(derivedKey, t('keyDerivation.component.privateKeyLabel'))}
                  className="p-1.5 sm:p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition"
                >
                  <Copy size={14} className="text-gray-600 dark:text-gray-400" />
                </button>
              </div>
            </div>
          </div>

          {/* Security tips */}
          <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-300 dark:border-orange-700 rounded-lg p-3">
            <div className="text-xs text-orange-800 dark:text-orange-200 space-y-1">
              <div className="font-bold">{t('keyDerivation.component.securityTips')}</div>
              <ul className="list-disc list-inside space-y-1 ml-2 text-[11px] sm:text-xs">
                <li>{t('keyDerivation.component.tip1')}</li>
                <li>{t('keyDerivation.component.tip2')}</li>
                <li>{t('keyDerivation.component.tip3')}</li>
                <li>{t('keyDerivation.component.tip4')}</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={showWeakPassphraseConfirm}
        type="warning"
        title={t('keyDerivation.component.weakPassphraseTitle')}
        message={weakPassphraseMessage}
        confirmText={t('keyDerivation.component.proceedAnyway')}
        cancelText={t('keyDerivation.component.improvePassphrase')}
        onConfirm={() => {
          setShowWeakPassphraseConfirm(false);
          void startDerivation();
        }}
        onCancel={() => setShowWeakPassphraseConfirm(false)}
      />
    </div>
  );
};

export default SecureKeyDerivation;
