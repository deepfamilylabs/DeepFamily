import React from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { useConfig } from '../context/ConfigContext'
import { useToast } from '../components/ToastProvider'
import { useNavigate } from 'react-router-dom'
import ConfirmDialog from '../components/ConfirmDialog'

const createSchema = (t: (key: string) => string) => z.object({
  rpcUrl: z.string().url(t('settings.validation.urlRequired')),
  subgraphUrl: z.string().url(t('settings.validation.urlRequired')),
  contractAddress: z.string().min(10, t('settings.validation.minLength')),
  rootHash: z.string().min(10, t('settings.validation.minLength')),
  rootVersionIndex: z.number().int().min(1, t('settings.validation.versionMin')),
  mode: z.enum(['subgraph', 'contract']),
})

type FormData = {
  rpcUrl: string
  subgraphUrl: string
  contractAddress: string
  rootHash: string
  rootVersionIndex: number
  mode: 'subgraph' | 'contract'
}

export default function SettingsPage() {
  const { t } = useTranslation()
  const cfg = useConfig()
  const toast = useToast()
  const navigate = useNavigate()
  
  const schema = createSchema(t)
  const { register, handleSubmit, formState: { errors, isSubmitting }, reset } = useForm<FormData>({ resolver: zodResolver(schema), defaultValues: cfg })

  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const confirmActionRef = React.useRef<null | (() => void)>(null)

  const onSubmit = async (data: FormData) => {
    cfg.update({ ...data })
    confirmActionRef.current = () => { navigate('/visualization') }
    setConfirmOpen(true)
  }

  const onReset = () => {
    cfg.reset()
    reset({
      rpcUrl: cfg.defaults.rpcUrl,
      subgraphUrl: cfg.defaults.subgraphUrl,
      contractAddress: cfg.defaults.contractAddress,
      rootHash: cfg.defaults.rootHash,
      rootVersionIndex: cfg.defaults.rootVersionIndex,
      mode: cfg.defaults.mode,
    })
    toast.show(t('settings.messages.reset'))
  }

  return (
    <div className="space-y-6 text-gray-900 dark:text-gray-100">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('settings.title')}</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{t('settings.ui.configDescription')}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className={`px-2 py-1 rounded-full text-xs font-medium ${cfg.mode === 'subgraph' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' : 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'}` }>
            {cfg.mode === 'subgraph' ? t('settings.ui.subgraphMode') : t('settings.ui.contractMode')}
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700/70 shadow-sm overflow-hidden">
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-gray-800 dark:to-gray-800/70 px-6 py-4 border-b border-gray-200 dark:border-gray-700/60">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
              {t('settings.ui.connectionConfig')}
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{t('settings.ui.connectionConfigDesc')}</p>
          </div>
          
          <div className="p-6 space-y-6">
            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                  <span className="w-1 h-1 bg-gray-400 dark:bg-gray-500 rounded-full"></span>
                  {t('settings.rpcUrl')}
                </label>
                <input 
                  className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 dark:focus:ring-blue-400/30 transition-all duration-200 font-mono text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-400" 
                  placeholder="http://127.0.0.1:8545" 
                  {...register('rpcUrl')} 
                />
                {errors.rpcUrl && <p className="text-sm text-red-600 dark:text-red-400 flex items-center gap-1 mt-1">⚠️ {errors.rpcUrl.message}</p>}
              </div>
              
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                  <span className="w-1 h-1 bg-gray-400 dark:bg-gray-500 rounded-full"></span>
                  {t('settings.subgraphUrl')}
                </label>
                <input 
                  className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 dark:focus:ring-blue-400/30 transition-all duration-200 font-mono text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-400" 
                  placeholder="http://localhost:8000/subgraphs/..." 
                  {...register('subgraphUrl')} 
                />
                {errors.subgraphUrl && <p className="text-sm text-red-600 dark:text-red-400 flex items-center gap-1 mt-1">⚠️ {errors.subgraphUrl.message}</p>}
              </div>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                <span className="w-1 h-1 bg-gray-400 dark:bg-gray-500 rounded-full"></span>
                {t('settings.contractAddress')}
              </label>
              <input 
                className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 dark:focus:ring-blue-400/30 transition-all duration-200 font-mono text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-400" 
                placeholder="0x..." 
                {...register('contractAddress')} 
              />
              {errors.contractAddress && <p className="text-sm text-red-600 dark:text-red-400 flex items-center gap-1 mt-1">⚠️ {errors.contractAddress.message}</p>}
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700/70 shadow-sm overflow-hidden">
          <div className="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-gray-800 dark:to-gray-800/70 px-6 py-4 border-b border-gray-200 dark:border-gray-700/60">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              {t('settings.ui.genealogyConfig')}
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{t('settings.ui.genealogyConfigDesc')}</p>
          </div>
          
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
              <div className="md:col-span-8 space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                  <span className="w-1 h-1 bg-gray-400 dark:bg-gray-500 rounded-full"></span>
                  {t('settings.rootHash')}
                </label>
                <input 
                  className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 dark:focus:ring-blue-400/30 transition-all duration-200 font-mono text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-400" 
                  placeholder="0x..." 
                  {...register('rootHash')} 
                />
                {errors.rootHash && <p className="text-sm text-red-600 dark:text-red-400 flex items-center gap-1 mt-1">⚠️ {errors.rootHash.message}</p>}
              </div>
              
              <div className="md:col-span-2 space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                  <span className="w-1 h-1 bg-gray-400 dark:bg-gray-500 rounded-full"></span>
                  {t('settings.rootVersionIndex')}
                </label>
                <input 
                  type="number" 
                  min="1"
                  className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 dark:focus:ring-blue-400/30 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-400" 
                  {...register('rootVersionIndex', { valueAsNumber: true })} 
                />
                {errors.rootVersionIndex && <p className="text-sm text-red-600 dark:text-red-400 flex items-center gap-1 mt-1">⚠️ {errors.rootVersionIndex.message}</p>}
              </div>

              <div className="md:col-span-2 space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                  <span className="w-1 h-1 bg-gray-400 dark:bg-gray-500 rounded-full"></span>
                  {t('settings.mode')}
                </label>
                <div className="relative">
                  <select className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 dark:focus:ring-blue-400/30 transition-all duration-200 appearance-none bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100" {...register('mode')}>
                    <option value="contract" className="bg-white dark:bg-gray-950">{t('settings.modes.contract')}</option>
                    <option value="subgraph" className="bg-white dark:bg-gray-950">{t('settings.modes.subgraph')}</option>
                  </select>
                  <div className="absolute right-3 top-1/2 transform -translate-y-1/2 pointer-events-none">
                    <svg className="w-5 h-5 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
                {errors.mode && <p className="text-sm text-red-600 dark:text-red-400 flex items-center gap-1 mt-1">⚠️ {errors.mode.message}</p>}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700/70 shadow-sm p-6">
          <div className="flex flex-col sm:flex-row gap-3 sm:justify-end">
            <button 
              type="button" 
              onClick={onReset} 
              className="inline-flex items-center justify-center px-6 py-3 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors duration-200 font-medium"
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {t('settings.reset')}
            </button>
            <button 
              disabled={isSubmitting} 
              className="inline-flex items-center justify-center px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 font-medium shadow-sm focus:ring-2 focus:ring-blue-500/40 focus:outline-none dark:focus:ring-blue-400/40"
            >
              {isSubmitting ? (
                <>
                  <svg className="animate-spin w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  {t('settings.ui.saving')}
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  {t('settings.save')}
                </>
              )}
            </button>
          </div>
        </div>
      </form>
      <ConfirmDialog
        open={confirmOpen}
        title={t('settings.title')}
        message={t('settings.messages.savedGoVisualConfirm')}
        cancelText={t('common.cancel')}
        confirmText={t('common.confirm')}
        onCancel={() => { setConfirmOpen(false); confirmActionRef.current = null }}
        onConfirm={() => { const fn = confirmActionRef.current; setConfirmOpen(false); if (fn) fn() }}
      />
    </div>
  )
}


