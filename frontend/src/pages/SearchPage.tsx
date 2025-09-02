import React, { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { ethers } from 'ethers'
import { Clipboard } from 'lucide-react'
import { useConfig } from '../context/ConfigContext'
import { useToast } from '../components/ToastProvider'
import DeepFamily from '../abi/DeepFamily.json'

const MAX_FULL_NAME_BYTES = 256
const MAX_PAGE_SIZE = 100  
const DEFAULT_PAGE_SIZE = 20

const getByteLength = (str: string): number => {
  return new TextEncoder().encode(str).length
}

const FieldError: React.FC<{ message?: string }> = ({ message }) => (
  <div className={`text-xs h-4 leading-4 ${message ? 'text-red-600' : 'text-transparent'}`}>
    {message || 'placeholder'}
  </div>
)

const nameQuerySchema = z.object({
  fullName: z.string().min(1).refine((val) => getByteLength(val) <= MAX_FULL_NAME_BYTES, 'Name exceeds max bytes'),
  pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE),
})
type NameQueryForm = z.infer<typeof nameQuerySchema>

const endorsementStatsSchema = z.object({
  personHash: z.string().min(1).regex(/^0x[a-fA-F0-9]{64}$/),
  pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE),
})
type EndorsementStatsForm = z.infer<typeof endorsementStatsSchema>

const tokenURIHistorySchema = z.object({
  tokenId: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE),
})
type TokenURIHistoryForm = z.infer<typeof tokenURIHistorySchema>

const personVersionsSchema = z.object({
  personHash: z.string().min(1).regex(/^0x[a-fA-F0-9]{64}$/),
  pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE),
})
type PersonVersionsForm = z.infer<typeof personVersionsSchema>

const hashFormSchema = z.object({
  fullName: z.string().min(1).refine((val) => getByteLength(val) <= MAX_FULL_NAME_BYTES, 'Name exceeds max bytes'),
  isBirthBC: z.boolean(),
  birthYear: z.union([z.number().int().min(0).max(10000), z.literal('')]).transform(val => val === '' ? 0 : val),
  birthMonth: z.union([z.number().int().min(0).max(12), z.literal('')]).transform(val => val === '' ? 0 : val),
  birthDay: z.union([z.number().int().min(0).max(31), z.literal('')]).transform(val => val === '' ? 0 : val),
  gender: z.number().int().min(0).max(3),
})
type HashForm = z.infer<typeof hashFormSchema>

function computePersonHashLocal(input: HashForm): string {
  const { fullName, isBirthBC, birthYear, birthMonth, birthDay, gender } = input
  const nameBytes = new TextEncoder().encode(fullName)
  // uint16 length (big-endian) + name bytes + flags and numbers in minimal big-endian per solidity abi.encodePacked rules
  // Build a hex string mimicking abi.encodePacked(uint16,len,name,uint8,isBirthBC?1:0,uint16,birthYear,uint8,birthMonth,uint8,birthDay,uint8,gender)
  const view = [] as string[]
  const pushU16 = (v:number)=>{ const b1 = (v>>8)&0xff; const b2 = v & 0xff; view.push(b1.toString(16).padStart(2,'0'), b2.toString(16).padStart(2,'0')) }
  const pushU8 = (v:number)=>{ view.push(v.toString(16).padStart(2,'0')) }
  pushU16(nameBytes.length)
  for (const b of nameBytes) pushU8(b)
  pushU8(isBirthBC ? 1 : 0)
  pushU16(birthYear)
  pushU8(birthMonth)
  pushU8(birthDay)
  pushU8(gender)
  const hex = '0x' + view.join('')
  return ethers.keccak256(hex)
}

export default function SearchPage() {
  const { t } = useTranslation()
  const createSchemas = () => ({
    nameQuery: z.object({
      fullName: z.string()
        .min(1, t('search.validation.nameRequired'))
        .refine((val) => getByteLength(val) <= MAX_FULL_NAME_BYTES, { message: t('search.validation.nameTooLong') }),
      pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE),
    }),
    endorsementStats: z.object({
      personHash: z.string().min(1, t('search.validation.hashRequired')).regex(/^0x[a-fA-F0-9]{64}$/, t('search.validation.hashInvalid')),
      pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE),
    }),
    tokenURIHistory: z.object({
      tokenId: z.number().int().min(1, t('search.validation.tokenIdRequired')),
      pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE),
    }),
    personVersions: z.object({
      personHash: z.string().min(1, t('search.validation.hashRequired')).regex(/^0x[a-fA-F0-9]{64}$/, t('search.validation.hashInvalid')),
      pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE),
    }),
    hashForm: z.object({
      fullName: z.string()
        .min(1, t('search.validation.required'))
        .refine((val) => getByteLength(val) <= MAX_FULL_NAME_BYTES, { message: t('search.validation.nameTooLong') }),
      isBirthBC: z.boolean(),
      birthYear: z.number().int().min(0, t('search.validation.yearRange')).max(10000, t('search.validation.yearRange')).optional().or(z.literal('')).transform(val => val === '' ? 0 : val),
      birthMonth: z.number().int().min(0, t('search.validation.monthRange')).max(12, t('search.validation.monthRange')).optional().or(z.literal('')).transform(val => val === '' ? 0 : val),
      birthDay: z.number().int().min(0, t('search.validation.dayRange')).max(31, t('search.validation.dayRange')).optional().or(z.literal('')).transform(val => val === '' ? 0 : val),
      gender: z.number().int().min(0).max(3),
    })
  })
  
  const schemas = createSchemas()
  const { mode, rpcUrl, contractAddress } = useConfig()
  const toast = useToast()
  
  const [offset, setOffset] = useState<number>(0)
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<string[]>([])
  const [total, setTotal] = useState<number>(0)
  const [hasMore, setHasMore] = useState<boolean>(false)
  
  const [endorsementOffset, setEndorsementOffset] = useState<number>(0)
  const [endorsementLoading, setEndorsementLoading] = useState<boolean>(false)
  const [endorsementError, setEndorsementError] = useState<string | null>(null)
  const [endorsementData, setEndorsementData] = useState<{ versionIndices: number[], endorsementCounts: number[], tokenIds: number[] }>({ versionIndices: [], endorsementCounts: [], tokenIds: [] })
  const [endorsementTotal, setEndorsementTotal] = useState<number>(0)
  const [endorsementHasMore, setEndorsementHasMore] = useState<boolean>(false)
  
  const [uriOffset, setUriOffset] = useState<number>(0)
  const [uriLoading, setUriLoading] = useState<boolean>(false)
  const [uriError, setUriError] = useState<string | null>(null)
  const [uriData, setUriData] = useState<string[]>([])
  const [uriTotal, setUriTotal] = useState<number>(0)
  const [uriHasMore, setUriHasMore] = useState<boolean>(false)
  
  const [versionsOffset, setVersionsOffset] = useState<number>(0)
  const [versionsLoading, setVersionsLoading] = useState<boolean>(false)
  const [versionsError, setVersionsError] = useState<string | null>(null)
  const [versionsData, setVersionsData] = useState<any[]>([])
  const [versionsTotal, setVersionsTotal] = useState<number>(0)
  const [versionsHasMore, setVersionsHasMore] = useState<boolean>(false)
  
  const [computedHash, setComputedHash] = useState<string>('')

  const [openSections, setOpenSections] = useState({
    name: false,
    endorsement: false,
    uri: false,
    versions: false,
    hash: true,
  })
  const toggle = (k: keyof typeof openSections) => setOpenSections(s => ({ ...s, [k]: !s[k] }))

  const { register: reg1, handleSubmit: hs1, formState: { errors: e1 }, watch: w1 } = useForm<NameQueryForm>({
    resolver: zodResolver(schemas.nameQuery),
    defaultValues: { fullName: '', pageSize: DEFAULT_PAGE_SIZE },
  })
  const { register: reg2, handleSubmit: hs2, formState: { errors: e2 }, setValue: set2, watch: w2 } = useForm({
    resolver: zodResolver(schemas.hashForm),
    defaultValues: { fullName: '', isBirthBC: false, birthYear: '', birthMonth: '', birthDay: '', gender: 0 },
  })
  const { register: reg3, handleSubmit: hs3, formState: { errors: e3 }, watch: w3 } = useForm<EndorsementStatsForm>({
    resolver: zodResolver(schemas.endorsementStats),
    defaultValues: { personHash: '', pageSize: DEFAULT_PAGE_SIZE },
  })
  const { register: reg4, handleSubmit: hs4, formState: { errors: e4 }, watch: w4 } = useForm<TokenURIHistoryForm>({
    resolver: zodResolver(schemas.tokenURIHistory),
    defaultValues: { tokenId: 0, pageSize: DEFAULT_PAGE_SIZE },
  })
  const { register: reg5, handleSubmit: hs5, formState: { errors: e5 }, watch: w5 } = useForm<PersonVersionsForm>({
    resolver: zodResolver(schemas.personVersions),
    defaultValues: { personHash: '', pageSize: DEFAULT_PAGE_SIZE },
  })

  const pageSize = useMemo(() => Number(w1('pageSize') || DEFAULT_PAGE_SIZE), [w1])
  const endorsementPageSize = useMemo(() => Number(w3('pageSize') || DEFAULT_PAGE_SIZE), [w3])
  const uriPageSize = useMemo(() => Number(w4('pageSize') || DEFAULT_PAGE_SIZE), [w4])
  const versionsPageSize = useMemo(() => Number(w5('pageSize') || DEFAULT_PAGE_SIZE), [w5])

  const onQuery = async (data: NameQueryForm, startOffset?: number) => {
    setLoading(true); setError(null)
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl)
      const contract = new ethers.Contract(contractAddress, (DeepFamily as any).abi, provider)
      const off = (startOffset !== undefined) ? startOffset : offset
      const out = await contract.listPersonHashesByFullName(data.fullName, off, data.pageSize)
      const personHashes: string[] = Array.from(out?.[0] || [])
      const totalCount: number = Number(out?.[1] || 0)
      const more: boolean = Boolean(out?.[2])
      const nextOffset: number = Number(out?.[3] || 0)
      setRows(personHashes)
      setTotal(totalCount)
      setHasMore(more)
      setOffset(nextOffset)
    } catch (e: any) {
      setError(e?.message || t('search.queryFailed'))
    } finally {
      setLoading(false)
    }
  }

  const onResetQuery = () => {
    setRows([]); setTotal(0); setHasMore(false); setOffset(0); setError(null)
  }

  const onNext = async () => {
    await onQuery({ fullName: w1('fullName') || '', pageSize })
  }
  const onPrev = async () => {
    const prev = Math.max(0, offset - pageSize * 2)
    await onQuery({ fullName: w1('fullName') || '', pageSize }, prev)
  }

  const onQueryEndorsementStats = async (data: EndorsementStatsForm, startOffset?: number) => {
    setEndorsementLoading(true); setEndorsementError(null)
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl)
      const contract = new ethers.Contract(contractAddress, (DeepFamily as any).abi, provider)
      const off = (startOffset !== undefined) ? startOffset : endorsementOffset
      const out = await contract.listVersionsEndorsementStats(data.personHash, off, data.pageSize)
      const versionIndices: number[] = Array.from(out?.[0] || []).map(Number)
      const endorsementCounts: number[] = Array.from(out?.[1] || []).map(Number)
      const tokenIds: number[] = Array.from(out?.[2] || []).map(Number)
      const totalVersions: number = Number(out?.[3] || 0)
      const more: boolean = Boolean(out?.[4])
      const nextOffset: number = Number(out?.[5] || 0)
      setEndorsementData({ versionIndices, endorsementCounts, tokenIds })
      setEndorsementTotal(totalVersions)
      setEndorsementHasMore(more)
      setEndorsementOffset(nextOffset)
    } catch (e: any) {
      setEndorsementError(e?.message || t('search.queryFailed'))
    } finally {
      setEndorsementLoading(false)
    }
  }

  const onResetEndorsementQuery = () => {
    setEndorsementData({ versionIndices: [], endorsementCounts: [], tokenIds: [] })
    setEndorsementTotal(0)
    setEndorsementHasMore(false)
    setEndorsementOffset(0)
    setEndorsementError(null)
  }

  const onEndorsementNext = async () => {
    await onQueryEndorsementStats({ personHash: w3('personHash') || '', pageSize: endorsementPageSize })
  }
  const onEndorsementPrev = async () => {
    const prev = Math.max(0, endorsementOffset - endorsementPageSize * 2)
    await onQueryEndorsementStats({ personHash: w3('personHash') || '', pageSize: endorsementPageSize }, prev)
  }

  const onQueryTokenURIHistory = async (data: TokenURIHistoryForm, startOffset?: number) => {
    setUriLoading(true); setUriError(null)
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl)
      const contract = new ethers.Contract(contractAddress, (DeepFamily as any).abi, provider)
      const off = (startOffset !== undefined) ? startOffset : uriOffset
      const out = await contract.listTokenURIHistory(data.tokenId, off, data.pageSize)
      const uris: string[] = Array.from(out?.[0] || [])
      const totalCount: number = Number(out?.[1] || 0)
      const more: boolean = Boolean(out?.[2])
      const nextOffset: number = Number(out?.[3] || 0)
      setUriData(uris)
      setUriTotal(totalCount)
      setUriHasMore(more)
      setUriOffset(nextOffset)
    } catch (e: any) {
      setUriError(e?.message || t('search.queryFailed'))
    } finally {
      setUriLoading(false)
    }
  }

  const onResetUriQuery = () => {
    setUriData([])
    setUriTotal(0)
    setUriHasMore(false)
    setUriOffset(0)
    setUriError(null)
  }

  const onUriNext = async () => {
    await onQueryTokenURIHistory({ tokenId: w4('tokenId') || 1, pageSize: uriPageSize })
  }
  const onUriPrev = async () => {
    const prev = Math.max(0, uriOffset - uriPageSize * 2)
    await onQueryTokenURIHistory({ tokenId: w4('tokenId') || 1, pageSize: uriPageSize }, prev)
  }

  const onQueryPersonVersions = async (data: PersonVersionsForm, startOffset?: number) => {
    setVersionsLoading(true); setVersionsError(null)
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl)
      const contract = new ethers.Contract(contractAddress, (DeepFamily as any).abi, provider)
      const off = (startOffset !== undefined) ? startOffset : versionsOffset
      const out = await contract.listPersonVersions(data.personHash, off, data.pageSize)
      const versions: any[] = Array.from(out?.[0] || [])
      const totalCount: number = Number(out?.[1] || 0)
      const more: boolean = Boolean(out?.[2])
      const nextOffset: number = Number(out?.[3] || 0)
      setVersionsData(versions)
      setVersionsTotal(totalCount)
      setVersionsHasMore(more)
      setVersionsOffset(nextOffset)
    } catch (e: any) {
      setVersionsError(e?.message || t('search.queryFailed'))
    } finally {
      setVersionsLoading(false)
    }
  }

  const onResetVersionsQuery = () => {
    setVersionsData([])
    setVersionsTotal(0)
    setVersionsHasMore(false)
    setVersionsOffset(0)
    setVersionsError(null)
  }

  const onVersionsNext = async () => {
    await onQueryPersonVersions({ personHash: w5('personHash') || '', pageSize: versionsPageSize })
  }
  const onVersionsPrev = async () => {
    const prev = Math.max(0, versionsOffset - versionsPageSize * 2)
    await onQueryPersonVersions({ personHash: w5('personHash') || '', pageSize: versionsPageSize }, prev)
  }

  const onCompute = (data: HashForm) => {
    const h = computePersonHashLocal(data)
    setComputedHash(h)
  }

  return (
    <div className="space-y-4 text-gray-900 dark:text-gray-100">
      {/* Name Query Section */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700/70 bg-white dark:bg-gray-900 shadow-sm overflow-hidden">
        <div className="bg-blue-50 dark:bg-gray-800/60 px-4 py-2 flex items-center justify-between cursor-pointer border-b border-gray-200 dark:border-gray-700/60" onClick={() => toggle('name')}>
          <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">{t('search.nameQuery.title')}</h3>
          <button type="button" className="text-sm px-2 py-1 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors" onClick={(e) => { e.stopPropagation(); toggle('name') }} aria-expanded={openSections.name}>{openSections.name ? '-' : '+'}</button>
        </div>
        {openSections.name && (
          <div className="p-3 space-y-3">
        <form onSubmit={hs1((d) => onQuery(d, 0))} className="grid md:grid-cols-3 gap-2 items-end">
          <div>
            <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">{t('search.nameQuery.fullName')}</label>
            <input className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-400 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-blue-500/30 dark:focus:ring-blue-400/30" placeholder={t('search.nameQuery.placeholder')}
              {...reg1('fullName')} />
            <FieldError message={e1.fullName?.message as any} />
          </div>
          <div>
            <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">{t('search.nameQuery.pageSize')}</label>
            <input type="number" className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-blue-500/30 dark:focus:ring-blue-400/30" {...reg1('pageSize', { valueAsNumber: true })} />
            <FieldError message={e1.pageSize?.message as any} />
          </div>
          <div className="flex gap-2 self-start mt-6">
            <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors" disabled={loading}>{t('search.query')}</button>
            <button type="button" onClick={onResetQuery} className="px-4 py-2 bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">{t('search.reset')}</button>
          </div>
        </form>
        <div className="text-xs text-gray-600 dark:text-gray-400">{t('search.totalResults')}: {total}</div>
        <div className="rounded border border-gray-200 dark:border-gray-700/60 divide-y dark:divide-gray-700/60">
          {rows.length === 0 ? (
            <div className="p-3 text-sm text-gray-500 dark:text-gray-400">{t('search.noData')}</div>
          ) : rows.map((h, i) => (
            <div key={i} className="p-3 flex items-center justify-between gap-2">
              <span className="font-mono text-sm break-all text-gray-800 dark:text-gray-200">{h}</span>
              <button
                className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                onClick={async () => {
                  try {
                    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                      await navigator.clipboard.writeText(h)
                      toast.show(t('search.copied'))
                      return
                    }
                  } catch {}
                  try {
                    const ta = document.createElement('textarea')
                    ta.value = h
                    ta.style.position = 'fixed'
                    ta.style.left = '-9999px'
                    document.body.appendChild(ta)
                    ta.focus(); ta.select()
                    const ok = document.execCommand('copy')
                    document.body.removeChild(ta)
                    toast.show(ok ? t('search.copied') : t('search.copyFailed'))
                  } catch {
                    toast.show(t('search.copyFailed'))
                  }
                }}
              >{t('search.copy')}</button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onPrev} disabled={loading || offset === 0} className="px-3 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed">{t('search.prev')}</button>
          <button onClick={onNext} disabled={loading || !hasMore} className="px-3 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed">{t('search.next')}</button>
          <div className="text-xs text-gray-500 dark:text-gray-500">{t('search.offset')}: {offset}</div>
        </div>
        {error && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}
          </div>
        )}
      </div>
      {/* Endorsement Stats Section */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700/70 bg-white dark:bg-gray-900 shadow-sm overflow-hidden">
        <div className="bg-green-50 dark:bg-gray-800/60 px-4 py-2 flex items-center justify-between cursor-pointer border-b border-gray-200 dark:border-gray-700/60" onClick={() => toggle('endorsement')}>
          <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">{t('search.endorsementQuery.title')}</h3>
          <button type="button" className="text-sm px-2 py-1 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors" onClick={(e) => { e.stopPropagation(); toggle('endorsement') }} aria-expanded={openSections.endorsement}>{openSections.endorsement ? '-' : '+'}</button>
        </div>
        {openSections.endorsement && (
          <div className="p-3 space-y-3">
        <form onSubmit={hs3((d) => onQueryEndorsementStats(d, 0))} className="grid md:grid-cols-3 gap-2 items-end">
          <div>
            <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">{t('search.endorsementQuery.personHash')}</label>
            <input className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-400 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-blue-500/30 dark:focus:ring-blue-400/30" placeholder={t('search.endorsementQuery.placeholder')}
              {...reg3('personHash')} />
            <FieldError message={e3.personHash?.message as any} />
          </div>
          <div>
            <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">{t('search.nameQuery.pageSize')}</label>
            <input type="number" className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-blue-500/30 dark:focus:ring-blue-400/30" {...reg3('pageSize', { valueAsNumber: true })} />
            <FieldError message={e3.pageSize?.message as any} />
          </div>
          <div className="flex gap-2 self-start mt-6">
            <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed" disabled={endorsementLoading}>{t('search.query')}</button>
            <button type="button" onClick={onResetEndorsementQuery} className="px-4 py-2 bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">{t('search.reset')}</button>
          </div>
        </form>
        <div className="text-xs text-gray-600 dark:text-gray-400">{t('search.totalResults')}: {endorsementTotal}</div>
        <div className="rounded border border-gray-200 dark:border-gray-700/60 divide-y dark:divide-gray-700/60">
          {endorsementData.versionIndices.length === 0 ? (
            <div className="p-3 text-sm text-gray-500 dark:text-gray-400">
              {endorsementLoading ? t('search.loading') : t('search.noData')}
            </div>
          ) : endorsementData.versionIndices.map((versionIndex, i) => (
            <div key={i} className="p-3">
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div><span className="text-gray-600 dark:text-gray-400">{t('search.endorsementQuery.version')}:</span> {versionIndex}</div>
                <div><span className="text-gray-600 dark:text-gray-400">{t('search.endorsementQuery.endorsementCount')}:</span> {endorsementData.endorsementCounts[i]}</div>
                <div><span className="text-gray-600 dark:text-gray-400">{t('search.endorsementQuery.tokenId')}:</span> {endorsementData.tokenIds[i]}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onEndorsementPrev} disabled={endorsementLoading || endorsementOffset === 0} className="px-3 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed">{t('search.prev')}</button>
          <button onClick={onEndorsementNext} disabled={endorsementLoading || !endorsementHasMore} className="px-3 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed">{t('search.next')}</button>
          <div className="text-xs text-gray-500 dark:text-gray-500">{t('search.offset')}: {endorsementOffset}</div>
        </div>
        {endorsementError && <div className="text-sm text-red-600 dark:text-red-400">{endorsementError}</div>}
          </div>
        )}
      </div>
      {/* URI History Section */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700/70 bg-white dark:bg-gray-900 shadow-sm overflow-hidden">
        <div className="bg-purple-50 dark:bg-gray-800/60 px-4 py-2 flex items-center justify-between cursor-pointer border-b border-gray-200 dark:border-gray-700/60" onClick={() => toggle('uri')}>
          <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">{t('search.uriQuery.title')}</h3>
          <button type="button" className="text-sm px-2 py-1 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors" onClick={(e) => { e.stopPropagation(); toggle('uri') }} aria-expanded={openSections.uri}>{openSections.uri ? '-' : '+'}</button>
        </div>
        {openSections.uri && (
          <div className="p-3 space-y-3">
        <form onSubmit={hs4((d) => onQueryTokenURIHistory(d, 0))} className="grid md:grid-cols-3 gap-2 items-end">
          <div>
            <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">{t('search.uriQuery.tokenId')}</label>
            <input type="number" className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-blue-500/30 dark:focus:ring-blue-400/30" placeholder={t('search.uriQuery.placeholder')}
              {...reg4('tokenId', { valueAsNumber: true })} />
            <FieldError message={e4.tokenId?.message as any} />
          </div>
          <div>
            <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">{t('search.nameQuery.pageSize')}</label>
            <input type="number" className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-blue-500/30 dark:focus:ring-blue-400/30" {...reg4('pageSize', { valueAsNumber: true })} />
            <FieldError message={e4.pageSize?.message as any} />
          </div>
          <div className="flex gap-2 self-start mt-6">
            <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed" disabled={uriLoading}>{t('search.query')}</button>
            <button type="button" onClick={onResetUriQuery} className="px-4 py-2 bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">{t('search.reset')}</button>
          </div>
        </form>
        <div className="text-xs text-gray-600 dark:text-gray-400">{t('search.totalResults')}: {uriTotal}</div>
        <div className="rounded border border-gray-200 dark:border-gray-700/60 divide-y dark:divide-gray-700/60">
          {uriData.length === 0 ? (
            <div className="p-3 text-sm text-gray-500 dark:text-gray-400">
              {uriLoading ? t('search.loading') : t('search.noData')}
            </div>
          ) : uriData.map((uri, i) => (
            <div key={i} className="p-3 flex items-center justify-between gap-2">
              <span className="font-mono text-sm break-all text-gray-800 dark:text-gray-200">{uri}</span>
              <button
                className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                onClick={async () => {
                  try {
                    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                      await navigator.clipboard.writeText(uri)
                      toast.show(t('search.copied'))
                      return
                    }
                  } catch {}
                  try {
                    const ta = document.createElement('textarea')
                    ta.value = uri
                    ta.style.position = 'fixed'
                    ta.style.left = '-9999px'
                    document.body.appendChild(ta)
                    ta.focus(); ta.select()
                    const ok = document.execCommand('copy')
                    document.body.removeChild(ta)
                    toast.show(ok ? t('search.copied') : t('search.copyFailed'))
                  } catch {
                    toast.show(t('search.copyFailed'))
                  }
                }}
              >{t('search.copy')}</button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onUriPrev} disabled={uriLoading || uriOffset === 0} className="px-3 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed">{t('search.prev')}</button>
          <button onClick={onUriNext} disabled={uriLoading || !uriHasMore} className="px-3 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed">{t('search.next')}</button>
          <div className="text-xs text-gray-500 dark:text-gray-500">{t('search.offset')}: {uriOffset}</div>
        </div>
        {uriError && <div className="text-sm text-red-600 dark:text-red-400">{uriError}</div>}
          </div>
        )}
      </div>
      {/* Versions Section */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700/70 bg-white dark:bg-gray-900 shadow-sm overflow-hidden">
        <div className="bg-orange-50 dark:bg-gray-800/60 px-4 py-2 flex items-center justify-between cursor-pointer border-b border-gray-200 dark:border-gray-700/60" onClick={() => toggle('versions')}>
          <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">{t('search.versionsQuery.title')}</h3>
          <button type="button" className="text-sm px-2 py-1 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors" onClick={(e) => { e.stopPropagation(); toggle('versions') }} aria-expanded={openSections.versions}>{openSections.versions ? '-' : '+'}</button>
        </div>
        {openSections.versions && (
          <div className="p-3 space-y-3">
        <form onSubmit={hs5((d) => onQueryPersonVersions(d, 0))} className="grid md:grid-cols-3 gap-2 items-end">
          <div>
            <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">{t('search.versionsQuery.personHash')}</label>
            <input className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-400 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-blue-500/30 dark:focus:ring-blue-400/30" placeholder={t('search.versionsQuery.placeholder')}
              {...reg5('personHash')} />
            <FieldError message={e5.personHash?.message as any} />
          </div>
          <div>
            <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">{t('search.nameQuery.pageSize')}</label>
            <input type="number" className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-blue-500/30 dark:focus:ring-blue-400/30" {...reg5('pageSize', { valueAsNumber: true })} />
            <FieldError message={e5.pageSize?.message as any} />
          </div>
          <div className="flex gap-2 self-start mt-6">
            <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed" disabled={versionsLoading}>{t('search.query')}</button>
            <button type="button" onClick={onResetVersionsQuery} className="px-4 py-2 bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">{t('search.reset')}</button>
          </div>
        </form>
        <div className="text-xs text-gray-600 dark:text-gray-400">{t('search.totalResults')}: {versionsTotal}</div>
        <div className="rounded border border-gray-200 dark:border-gray-700/60 divide-y dark:divide-gray-700/60">
          {versionsData.length === 0 ? (
            <div className="p-3 text-sm text-gray-500 dark:text-gray-400">
              {versionsLoading ? t('search.loading') : t('search.noData')}
            </div>
          ) : versionsData.map((version, i) => (
            <div key={i} className="p-3 border-b border-gray-100 dark:border-gray-700 last:border-b-0">
              <div className="grid grid-cols-3 gap-4 text-sm mb-3">
                <div><span className="text-gray-600 dark:text-gray-400">{t('search.versionsQuery.versionIndex')}:</span> {Number(version.versionIndex)}</div>
                <div><span className="text-gray-600 dark:text-gray-400">{t('search.versionsQuery.creator')}:</span> <span className="font-mono text-xs text-gray-800 dark:text-gray-300">{version.addedBy || t('search.versionsQuery.unknown')}</span></div>
                <div><span className="text-gray-600 dark:text-gray-400">{t('search.versionsQuery.addTime')}:</span> <span className="font-mono text-xs text-gray-800 dark:text-gray-300">{version.timestamp ? new Date(Number(version.timestamp) * 1000).toLocaleString() : t('search.versionsQuery.unknown')}</span></div>
              </div>
              <div className="text-sm space-y-1">
                <div><span className="text-gray-600 dark:text-gray-400">{t('search.versionsQuery.fatherHash')}:</span> <span className="font-mono text-xs break-all text-gray-800 dark:text-gray-300">{version.fatherHash}</span> <span className="text-gray-600 dark:text-gray-400 ml-4">{t('search.versionsQuery.fatherVersion')}:</span> {Number(version.fatherVersionIndex)}</div>
                <div><span className="text-gray-600 dark:text-gray-400">{t('search.versionsQuery.motherHash')}:</span> <span className="font-mono text-xs break-all text-gray-800 dark:text-gray-300">{version.motherHash}</span> <span className="text-gray-600 dark:text-gray-400 ml-4">{t('search.versionsQuery.motherVersion')}:</span> {Number(version.motherVersionIndex)}</div>
                <div><span className="text-gray-600 dark:text-gray-400">{t('search.versionsQuery.versionTag')}:</span> {version.tag || t('search.versionsQuery.none')} {version.metadataCID && <><span className="text-gray-600 dark:text-gray-400 ml-4">{t('search.versionsQuery.metadataCID')}:</span> <span className="font-mono text-xs break-all text-gray-800 dark:text-gray-300">{version.metadataCID}</span></>}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onVersionsPrev} disabled={versionsLoading || versionsOffset === 0} className="px-3 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed">{t('search.prev')}</button>
          <button onClick={onVersionsNext} disabled={versionsLoading || !versionsHasMore} className="px-3 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed">{t('search.next')}</button>
          <div className="text-xs text-gray-500 dark:text-gray-500">{t('search.offset')}: {versionsOffset}</div>
        </div>
        {versionsError && <div className="text-sm text-red-600 dark:text-red-400">{versionsError}</div>}
          </div>
        )}
      </div>
      {/* Hash Calculator Section */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700/70 bg-white dark:bg-gray-900 shadow-sm overflow-hidden">
        <div className="bg-teal-50 dark:bg-gray-800/60 px-4 py-2 flex items-center justify-between cursor-pointer border-b border-gray-200 dark:border-gray-700/60" onClick={() => toggle('hash')}>
          <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">{t('search.hashCalculator.title')}</h3>
          <button type="button" className="text-sm px-2 py-1 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors" onClick={(e) => { e.stopPropagation(); toggle('hash') }} aria-expanded={openSections.hash}>{openSections.hash ? '-' : '+'}</button>
        </div>
        {openSections.hash && (
          <div className="p-3 space-y-3">
        <div className="text-xs text-blue-600 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 p-2 rounded border border-blue-100 dark:border-blue-800/40">
          {t('search.hashCalculator.tip')}
        </div>
        <form onSubmit={hs2((data: any) => onCompute(data))} className="w-full" noValidate>
          <div className="space-y-3">
            <div className="flex flex-wrap items-start gap-6">
              <div className="flex-1 min-w-[240px]">
                <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400 mb-1">{t('search.hashCalculator.name')}</label>
                <input 
                  className="w-full h-10 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-400 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-blue-400/30 outline-none transition" 
                  placeholder={t('search.hashCalculator.nameInputPlaceholder')}
                  {...reg2('fullName')} 
                />
                <FieldError message={e2.fullName?.message as any} />
              </div>
              <div className="w-28">
                <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400 mb-1">{t('search.hashCalculator.gender')}</label>
                <select className="w-full h-10 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-sm text-gray-800 dark:text-gray-100 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-blue-400/30 outline-none transition" {...reg2('gender', { valueAsNumber: true })}>
                  <option value={0}>{t('search.hashCalculator.genderOptions.unknown')}</option>
                  <option value={1}>{t('search.hashCalculator.genderOptions.male')}</option>
                  <option value={2}>{t('search.hashCalculator.genderOptions.female')}</option>
                  <option value={3}>{t('search.hashCalculator.genderOptions.other')}</option>
                </select>
                <FieldError message={e2.gender?.message as any} />
              </div>
            </div>
            <div className="flex flex-nowrap items-start gap-2">
              <div className="flex items-start gap-1">
                <div className="w-20">
                  <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400 mb-1">{t('search.hashCalculator.isBirthBC')}</label>
                  <div className="h-10 flex items-center">
                    <label className="inline-flex items-center gap-2 text-xs font-medium text-gray-700 dark:text-gray-300 cursor-pointer select-none group">
                      <input type="checkbox" className="sr-only" {...reg2('isBirthBC')} />
                      <span className="relative w-11 h-6 rounded-full bg-gray-300 dark:bg-gray-700 group-has-[:checked]:bg-blue-600 transition-colors duration-200">
                        <span className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 group-has-[:checked]:translate-x-5" />
                      </span>
                      <span className="text-gray-600 dark:text-gray-400 group-has-[:checked]:hidden text-[11px]">{t('search.hashCalculator.toggleNo')}</span>
                      <span className="text-blue-600 dark:text-blue-400 hidden group-has-[:checked]:block text-[11px]">{t('search.hashCalculator.toggleYes')}</span>
                    </label>
                  </div>
                  <FieldError />
                </div>
                <div className="w-25">
                  <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400 mb-1">{t('search.hashCalculator.birthYearLabel')}</label>
                  <input type="number" placeholder={t('search.hashCalculator.birthYear')} className="w-full h-10 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-400 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-blue-400/30 outline-none transition" {...reg2('birthYear', { setValueAs: (v) => v === '' ? '' : parseInt(v, 10) })} />
                  <FieldError message={e2.birthYear?.message as any} />
                </div>
              </div>
              <div className="w-24">
                <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400 mb-1">{t('search.hashCalculator.birthMonthLabel')}</label>
                <input type="number" min="0" max="12" placeholder={t('search.hashCalculator.birthMonth')} className="w-full h-10 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-400 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-blue-400/30 outline-none transition" {...reg2('birthMonth', { setValueAs: (v) => v === '' ? '' : parseInt(v, 10) })} />
                <FieldError message={e2.birthMonth?.message as any} />
              </div>
              <div className="w-24">
                <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400 mb-1">{t('search.hashCalculator.birthDayLabel')}</label>
                <input type="number" min="0" max="31" placeholder={t('search.hashCalculator.birthDay')} className="w-full h-10 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-400 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-blue-400/30 outline-none transition" {...reg2('birthDay', { setValueAs: (v) => v === '' ? '' : parseInt(v, 10) })} />
                <FieldError message={e2.birthDay?.message as any} />
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-2 overflow-hidden">
                <button className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 sm:px-5 h-10 text-xs sm:text-sm font-medium text-white shadow-sm hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed transition flex-shrink-0">
                  {t('search.hashCalculator.compute')}
                </button>
                {computedHash && (
                  <div className="flex items-center gap-1 overflow-hidden">
                    <div className="inline-block rounded-md border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 px-2 py-0.5">
                      <code className="font-mono text-[10px] sm:text-[11px] leading-3 break-all text-gray-700 dark:text-gray-300">{computedHash}</code>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                            await navigator.clipboard.writeText(computedHash)
                            toast.show(t('search.copied'))
                            return
                          }
                        } catch {}
                        try {
                          const ta = document.createElement('textarea')
                          ta.value = computedHash
                          ta.style.position = 'fixed'
                          ta.style.left = '-9999px'
                          document.body.appendChild(ta)
                          ta.focus(); ta.select()
                          const ok = document.execCommand('copy')
                          document.body.removeChild(ta)
                          toast.show(ok ? t('search.copied') : t('search.copyFailed'))
                        } catch {
                          toast.show(t('search.copyFailed'))
                        }
                      }}
                      aria-label={t('search.copy')}
                      className="shrink-0 p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700/70 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                      title={t('search.copy')}
                    >
                      <Clipboard size={14} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </form>
        <p className="text-xs text-gray-500 dark:text-gray-500">{t('search.hashCalculator.description')}</p>
          </div>
        )}
      </div>
    </div>
  )
}


