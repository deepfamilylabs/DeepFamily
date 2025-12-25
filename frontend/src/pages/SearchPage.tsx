import React, { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { ethers } from "ethers";
import { ChevronDown, Clipboard, Search, RefreshCw, ArrowLeft, ArrowRight } from "lucide-react";
import { useConfig } from "../context/ConfigContext";
import { useToast } from "../components/ToastProvider";
import DeepFamily from "../abi/DeepFamily.json";
import { formatUnixSeconds, formatHashMiddle, type StoryChunk } from "../types/graph";
import { makeProvider } from "../utils/provider";
import PersonHashCalculator from "../components/PersonHashCalculator";
import {
  getChunkTypeOptions,
  getChunkTypeI18nKey,
  getChunkTypeIcon,
  getChunkTypeColorClass,
  getChunkTypeBorderColorClass,
} from "../constants/chunkTypes";

const MAX_PAGE_SIZE = 100;

const getByteLength = (str: string): number => {
  return new TextEncoder().encode(str).length;
};

const FieldError: React.FC<{ message?: string }> = ({ message }) => {
  if (!message) return null;
  return (
    <div className="text-xs text-red-500 font-medium leading-snug whitespace-normal break-words w-full mt-1 ml-1">
      {message}
    </div>
  );
};

const SectionCard = ({
  title,
  isOpen,
  onToggle,
  children,
}: {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) => (
  <div
    className={`group relative overflow-hidden rounded-3xl bg-white dark:bg-black border border-gray-100 dark:border-gray-800 transition-all duration-500 ${isOpen ? "shadow-2xl shadow-gray-200/50 dark:shadow-gray-900/50" : "shadow-sm hover:shadow-md"}`}
  >
    <div
      className="p-6 flex items-center justify-between cursor-pointer select-none"
      onClick={onToggle}
    >
      <div className="flex items-center gap-4">
        <div
          className={`w-1.5 h-6 rounded-full bg-gradient-to-b from-orange-400 to-red-500 transition-all duration-500 ${isOpen ? "opacity-100 scale-y-100" : "opacity-0 scale-y-0"}`}
        />
        <h3
          className={`text-lg font-bold transition-all duration-300 ${isOpen ? "bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-400" : "text-gray-600 dark:text-gray-400 group-hover:text-gray-900 dark:group-hover:text-gray-200"}`}
        >
          {title}
        </h3>
      </div>
      <button
        type="button"
        className={`flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 text-gray-500 transition-all duration-300 group-hover:scale-110 ${isOpen ? "rotate-180 bg-white dark:bg-black shadow-lg text-orange-500" : ""}`}
      >
        <ChevronDown size={20} />
      </button>
    </div>
    <div
      className={`transition-all duration-500 ease-in-out overflow-hidden ${isOpen ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0"}`}
    >
      <div className="p-6 pt-0">{children}</div>
    </div>
  </div>
);

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className = "", ...props }, ref) => (
    <input
      ref={ref}
      className={`w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all duration-300 ${className}`}
      {...props}
    />
  ),
);
Input.displayName = "Input";

const ButtonPrimary = ({
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    className={`px-6 py-2.5 rounded-full bg-gradient-to-r from-orange-400 to-red-500 text-white font-medium shadow-lg shadow-orange-500/30 hover:shadow-orange-500/50 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 transition-all duration-300 flex items-center justify-center gap-2 ${className}`}
    {...props}
  />
);

const ButtonSecondary = ({
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    className={`px-6 py-2.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 font-medium hover:bg-gray-200 dark:hover:bg-gray-700 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 transition-all duration-300 flex items-center justify-center gap-2 ${className}`}
    {...props}
  />
);

const sanitizeNumberInput = (value: unknown) => {
  if (value === "" || value === null || value === undefined) return undefined;
  const num = Number(value);
  return Number.isNaN(num) ? undefined : num;
};
// Simple themed select (no native popup) for small option sets
const ThemedSelect: React.FC<{
  value: number;
  onChange: (v: number) => void;
  options: { value: number; label: string }[];
  className?: string;
}> = ({ value, onChange, options, className = "" }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const current = options.find((o) => o.value === value)?.label ?? "";

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full h-[50px] px-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 text-left text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 hover:bg-white dark:hover:bg-black transition-all duration-300 flex items-center justify-between"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{current}</span>
        <ChevronDown
          size={16}
          className={`text-gray-500 dark:text-gray-400 transition-transform duration-300 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="absolute z-20 mt-2 w-full rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
          <ul role="listbox" className="max-h-60 overflow-auto p-1">
            {options.map((o) => (
              <li
                key={o.value}
                role="option"
                aria-selected={o.value === value}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={`px-3 py-2.5 rounded-lg text-sm cursor-pointer select-none transition-colors ${
                  o.value === value
                    ? "bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 font-medium"
                    : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
              >
                {o.label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

// Type definitions for forms
type EndorsementStatsForm = {
  personHash: string;
  pageSize: number;
};

type TokenURIHistoryForm = {
  tokenId: number;
  pageSize: number;
};

type PersonVersionsForm = {
  personHash: string;
  pageSize: number;
};

type StoryChunksForm = {
  tokenId: number;
  pageSize: number;
};

type ChildrenForm = {
  parentHash: string;
  parentVersionIndex: number;
  pageSize: number;
};

export default function SearchPage() {
  const { t } = useTranslation();
  const createSchemas = () => ({
    endorsementStats: z.object({
      personHash: z
        .string()
        .min(1, t("search.validation.hashRequired"))
        .regex(/^0x[a-fA-F0-9]{64}$/, t("search.validation.hashInvalid")),
      pageSize: z
        .number()
        .int({ message: t("search.validation.pageSizeRange", { max: MAX_PAGE_SIZE }) })
        .min(1, { message: t("search.validation.pageSizeRange", { max: MAX_PAGE_SIZE }) })
        .max(MAX_PAGE_SIZE, {
          message: t("search.validation.pageSizeRange", { max: MAX_PAGE_SIZE }),
        }),
    }),
    tokenURIHistory: z.object({
      tokenId: z
        .number({ message: t("search.validation.tokenIdRequired") })
        .int({ message: t("search.validation.tokenIdRequired") })
        .min(1, { message: t("search.validation.tokenIdRequired") }),
      pageSize: z
        .number()
        .int({ message: t("search.validation.pageSizeRange", { max: MAX_PAGE_SIZE }) })
        .min(1, { message: t("search.validation.pageSizeRange", { max: MAX_PAGE_SIZE }) })
        .max(MAX_PAGE_SIZE, {
          message: t("search.validation.pageSizeRange", { max: MAX_PAGE_SIZE }),
        }),
    }),
    personVersions: z.object({
      personHash: z
        .string()
        .min(1, t("search.validation.hashRequired"))
        .regex(/^0x[a-fA-F0-9]{64}$/, t("search.validation.hashInvalid")),
      pageSize: z
        .number()
        .int({ message: t("search.validation.pageSizeRange", { max: MAX_PAGE_SIZE }) })
        .min(1, { message: t("search.validation.pageSizeRange", { max: MAX_PAGE_SIZE }) })
        .max(MAX_PAGE_SIZE, {
          message: t("search.validation.pageSizeRange", { max: MAX_PAGE_SIZE }),
        }),
    }),
    storyChunks: z.object({
      tokenId: z
        .number({ message: t("search.validation.tokenIdRequired") })
        .int({ message: t("search.validation.tokenIdRequired") })
        .min(1, { message: t("search.validation.tokenIdRequired") }),
      pageSize: z
        .number()
        .int({ message: t("search.validation.pageSizeRange", { max: MAX_PAGE_SIZE }) })
        .min(1, { message: t("search.validation.pageSizeRange", { max: MAX_PAGE_SIZE }) })
        .max(MAX_PAGE_SIZE, {
          message: t("search.validation.pageSizeRange", { max: MAX_PAGE_SIZE }),
        }),
    }),
    children: z.object({
      parentHash: z
        .string()
        .min(1, t("search.validation.hashRequired"))
        .regex(/^0x[a-fA-F0-9]{64}$/, t("search.validation.hashInvalid")),
      parentVersionIndex: z
        .number({ message: t("search.validation.versionIndexRequired") })
        .int({ message: t("search.validation.versionIndexRequired") })
        .min(0, { message: t("search.validation.versionIndexRequired") }),
      pageSize: z
        .number()
        .int({ message: t("search.validation.pageSizeRange", { max: MAX_PAGE_SIZE }) })
        .min(1, { message: t("search.validation.pageSizeRange", { max: MAX_PAGE_SIZE }) })
        .max(MAX_PAGE_SIZE, {
          message: t("search.validation.pageSizeRange", { max: MAX_PAGE_SIZE }),
        }),
    }),
  });

  const schemas = createSchemas();
  const { rpcUrl, contractAddress, chainId } = useConfig();
  const toast = useToast();

  const tokenIdValidationMessage = useMemo(() => t("search.validation.tokenIdRequired"), [t]);
  const pageSizeValidationMessage = useMemo(
    () => t("search.validation.pageSizeRange", { max: MAX_PAGE_SIZE }),
    [t],
  );
  const versionIndexValidationMessage = useMemo(
    () => t("search.validation.versionIndexRequired"),
    [t],
  );
  const formatNumericError = useCallback((message: unknown, fallback: string) => {
    if (!message) return undefined;
    const text = typeof message === "string" ? message : String(message);
    return /expected number/i.test(text) || /required/i.test(text) ? fallback : text;
  }, []);

  const copyText = React.useCallback(async (text: string) => {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {}
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }, []);

  const onCopy = async (text: string) => {
    const ok = await copyText(text);
    toast.show(ok ? t("search.copied") : t("search.copyFailed"));
  };

  const [endorsementOffset, setEndorsementOffset] = useState<number>(0);
  const [endorsementLoading, setEndorsementLoading] = useState<boolean>(false);
  const [endorsementError, setEndorsementError] = useState<string | null>(null);
  const [endorsementData, setEndorsementData] = useState<{
    versionIndices: number[];
    endorsementCounts: number[];
    tokenIds: number[];
  }>({ versionIndices: [], endorsementCounts: [], tokenIds: [] });
  const [endorsementTotal, setEndorsementTotal] = useState<number>(0);
  const [endorsementHasMore, setEndorsementHasMore] = useState<boolean>(false);
  const [endorsementQueried, setEndorsementQueried] = useState<boolean>(false);

  const [uriOffset, setUriOffset] = useState<number>(0);
  const [uriLoading, setUriLoading] = useState<boolean>(false);
  const [uriError, setUriError] = useState<string | null>(null);
  const [uriData, setUriData] = useState<string[]>([]);
  const [uriTotal, setUriTotal] = useState<number>(0);
  const [uriHasMore, setUriHasMore] = useState<boolean>(false);
  const [uriQueried, setUriQueried] = useState<boolean>(false);

  const [versionsOffset, setVersionsOffset] = useState<number>(0);
  const [versionsLoading, setVersionsLoading] = useState<boolean>(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [versionsData, setVersionsData] = useState<any[]>([]);
  const [versionsTotal, setVersionsTotal] = useState<number>(0);
  const [versionsHasMore, setVersionsHasMore] = useState<boolean>(false);
  const [versionsQueried, setVersionsQueried] = useState<boolean>(false);

  const [storyChunksOffset, setStoryChunksOffset] = useState<number>(0);
  const [storyChunksLoading, setStoryChunksLoading] = useState<boolean>(false);
  const [storyChunksError, setStoryChunksError] = useState<string | null>(null);
  const [storyChunksData, setStoryChunksData] = useState<StoryChunk[]>([]);
  const [storyChunksTotal, setStoryChunksTotal] = useState<number>(0);
  const [storyChunksHasMore, setStoryChunksHasMore] = useState<boolean>(false);
  const [storyChunksQueried, setStoryChunksQueried] = useState<boolean>(false);

  const [childrenOffset, setChildrenOffset] = useState<number>(0);
  const [childrenLoading, setChildrenLoading] = useState<boolean>(false);
  const [childrenError, setChildrenError] = useState<string | null>(null);
  const [childrenData, setChildrenData] = useState<{
    childHashes: string[];
    childVersions: number[];
  }>({ childHashes: [], childVersions: [] });
  const [childrenTotal, setChildrenTotal] = useState<number>(0);
  const [childrenHasMore, setChildrenHasMore] = useState<boolean>(false);
  const [childrenQueried, setChildrenQueried] = useState<boolean>(false);

  const [openSections, setOpenSections] = useState({
    hash: true,
    versions: false,
    endorsement: false,
    children: false,
    storyChunks: false,
    uri: false,
  });
  const toggle = (k: keyof typeof openSections) => setOpenSections((s) => ({ ...s, [k]: !s[k] }));

  const {
    register: reg3,
    handleSubmit: hs3,
    formState: { errors: e3 },
    watch: w3,
  } = useForm<EndorsementStatsForm>({
    resolver: zodResolver(schemas.endorsementStats),
    defaultValues: { personHash: "", pageSize: MAX_PAGE_SIZE },
  });
  const {
    register: reg4,
    handleSubmit: hs4,
    formState: { errors: e4 },
    watch: w4,
  } = useForm<TokenURIHistoryForm>({
    resolver: zodResolver(schemas.tokenURIHistory),
    defaultValues: { tokenId: undefined as any, pageSize: MAX_PAGE_SIZE },
  });
  const {
    register: reg5,
    handleSubmit: hs5,
    formState: { errors: e5 },
    watch: w5,
  } = useForm<PersonVersionsForm>({
    resolver: zodResolver(schemas.personVersions),
    defaultValues: { personHash: "", pageSize: MAX_PAGE_SIZE },
  });
  const {
    register: reg6,
    handleSubmit: hs6,
    formState: { errors: e6 },
    watch: w6,
  } = useForm<StoryChunksForm>({
    resolver: zodResolver(schemas.storyChunks),
    defaultValues: { tokenId: undefined as any, pageSize: MAX_PAGE_SIZE },
  });
  const {
    register: reg7,
    handleSubmit: hs7,
    formState: { errors: e7 },
    watch: w7,
  } = useForm<ChildrenForm>({
    resolver: zodResolver(schemas.children),
    defaultValues: {
      parentHash: "",
      parentVersionIndex: undefined as any,
      pageSize: MAX_PAGE_SIZE,
    },
  });

  const endorsementPageSize = useMemo(() => Number(w3("pageSize") || MAX_PAGE_SIZE), [w3]);
  const uriPageSize = useMemo(() => Number(w4("pageSize") || MAX_PAGE_SIZE), [w4]);
  const versionsPageSize = useMemo(() => Number(w5("pageSize") || MAX_PAGE_SIZE), [w5]);
  const storyChunksPageSize = useMemo(() => Number(w6("pageSize") || MAX_PAGE_SIZE), [w6]);
  const childrenPageSize = useMemo(() => Number(w7("pageSize") || MAX_PAGE_SIZE), [w7]);
  const getWatchedUriTokenId = () => {
    const raw = w4("tokenId");
    return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
  };
  const getWatchedStoryTokenId = () => {
    const raw = w6("tokenId");
    return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
  };
  const getWatchedParentVersionIndex = () => {
    const raw = w7("parentVersionIndex");
    return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
  };
  const chunkTypeOptions = useMemo(() => getChunkTypeOptions(t), [t]);
  const getChunkTypeLabel = useCallback(
    (type: number) => {
      const numericType = Number.isFinite(type) ? Number(type) : 0;
      const match = chunkTypeOptions.find((opt) => opt.value === numericType);
      return match ? match.label : t("storyChunkEditor.chunkTypes.unknown", "Unknown");
    },
    [chunkTypeOptions, t],
  );

  const onQueryEndorsementStats = async (data: EndorsementStatsForm, startOffset?: number) => {
    setEndorsementQueried(true);
    if ((startOffset ?? 0) === 0) {
      setEndorsementData({ versionIndices: [], endorsementCounts: [], tokenIds: [] });
      setEndorsementTotal(0);
      setEndorsementHasMore(false);
      setEndorsementOffset(0);
    }
    setEndorsementLoading(true);
    setEndorsementError(null);
    try {
      const provider = makeProvider(rpcUrl, chainId);
      const contract = new ethers.Contract(contractAddress, (DeepFamily as any).abi, provider);
      const off = startOffset !== undefined ? startOffset : endorsementOffset;
      const out = await contract.listVersionEndorsements(data.personHash, off, data.pageSize);
      const versionIndices: number[] = Array.from(out?.[0] || []).map(Number);
      const endorsementCounts: number[] = Array.from(out?.[1] || []).map(Number);
      const tokenIds: number[] = Array.from(out?.[2] || []).map(Number);
      const totalVersions: number = Number(out?.[3] || 0);
      const more: boolean = Boolean(out?.[4]);
      const nextOffset: number = Number(out?.[5] || 0);
      setEndorsementData({ versionIndices, endorsementCounts, tokenIds });
      setEndorsementTotal(totalVersions);
      setEndorsementHasMore(more);
      setEndorsementOffset(nextOffset);
    } catch (e: any) {
      setEndorsementError(e?.message || t("search.queryFailed"));
    } finally {
      setEndorsementLoading(false);
    }
  };

  const onResetEndorsementQuery = () => {
    setEndorsementData({ versionIndices: [], endorsementCounts: [], tokenIds: [] });
    setEndorsementTotal(0);
    setEndorsementHasMore(false);
    setEndorsementOffset(0);
    setEndorsementError(null);
    setEndorsementQueried(false);
  };

  const onEndorsementNext = async () => {
    await onQueryEndorsementStats({
      personHash: w3("personHash") || "",
      pageSize: endorsementPageSize,
    });
  };
  const onEndorsementPrev = async () => {
    const prev = Math.max(0, endorsementOffset - endorsementPageSize * 2);
    await onQueryEndorsementStats(
      { personHash: w3("personHash") || "", pageSize: endorsementPageSize },
      prev,
    );
  };

  const onQueryTokenURIHistory = async (data: TokenURIHistoryForm, startOffset?: number) => {
    setUriQueried(true);
    if ((startOffset ?? 0) === 0) {
      setUriData([]);
      setUriTotal(0);
      setUriHasMore(false);
      setUriOffset(0);
    }
    setUriLoading(true);
    setUriError(null);
    try {
      const provider = makeProvider(rpcUrl, chainId);
      const contract = new ethers.Contract(contractAddress, (DeepFamily as any).abi, provider);
      const off = startOffset !== undefined ? startOffset : uriOffset;
      if (data.tokenId === undefined || !Number.isFinite(data.tokenId)) {
        throw new Error(t("search.validation.tokenIdRequired"));
      }
      const out = await contract.listTokenURIHistory(data.tokenId, off, data.pageSize);
      const uris: string[] = Array.from(out?.[0] || []);
      const totalCount: number = Number(out?.[1] || 0);
      const more: boolean = Boolean(out?.[2]);
      const nextOffset: number = Number(out?.[3] || 0);
      setUriData(uris);
      setUriTotal(totalCount);
      setUriHasMore(more);
      setUriOffset(nextOffset);
    } catch (e: any) {
      setUriError(e?.message || t("search.queryFailed"));
    } finally {
      setUriLoading(false);
    }
  };

  const onResetUriQuery = () => {
    setUriData([]);
    setUriTotal(0);
    setUriHasMore(false);
    setUriOffset(0);
    setUriError(null);
    setUriQueried(false);
  };

  const onUriNext = async () => {
    const tokenId = getWatchedUriTokenId();
    if (tokenId === undefined) {
      setUriError(t("search.validation.tokenIdRequired"));
      return;
    }
    await onQueryTokenURIHistory({ tokenId, pageSize: uriPageSize });
  };
  const onUriPrev = async () => {
    const prev = Math.max(0, uriOffset - uriPageSize * 2);
    const tokenId = getWatchedUriTokenId();
    if (tokenId === undefined) {
      setUriError(t("search.validation.tokenIdRequired"));
      return;
    }
    await onQueryTokenURIHistory({ tokenId, pageSize: uriPageSize }, prev);
  };

  const onQueryPersonVersions = async (data: PersonVersionsForm, startOffset?: number) => {
    setVersionsQueried(true);
    if ((startOffset ?? 0) === 0) {
      setVersionsData([]);
      setVersionsTotal(0);
      setVersionsHasMore(false);
      setVersionsOffset(0);
    }
    setVersionsLoading(true);
    setVersionsError(null);
    try {
      const provider = makeProvider(rpcUrl, chainId);
      const contract = new ethers.Contract(contractAddress, (DeepFamily as any).abi, provider);
      const off = startOffset !== undefined ? startOffset : versionsOffset;
      const out = await contract.listPersonVersions(data.personHash, off, data.pageSize);
      const versions: any[] = Array.from(out?.[0] || []);
      const totalCount: number = Number(out?.[1] || 0);
      const more: boolean = Boolean(out?.[2]);
      const nextOffset: number = Number(out?.[3] || 0);
      setVersionsData(versions);
      setVersionsTotal(totalCount);
      setVersionsHasMore(more);
      setVersionsOffset(nextOffset);
    } catch (e: any) {
      setVersionsError(e?.message || t("search.queryFailed"));
    } finally {
      setVersionsLoading(false);
    }
  };

  const onResetVersionsQuery = () => {
    setVersionsData([]);
    setVersionsTotal(0);
    setVersionsHasMore(false);
    setVersionsOffset(0);
    setVersionsError(null);
    setVersionsQueried(false);
  };

  const onVersionsNext = async () => {
    await onQueryPersonVersions({ personHash: w5("personHash") || "", pageSize: versionsPageSize });
  };
  const onVersionsPrev = async () => {
    const prev = Math.max(0, versionsOffset - versionsPageSize * 2);
    await onQueryPersonVersions(
      { personHash: w5("personHash") || "", pageSize: versionsPageSize },
      prev,
    );
  };

  const onQueryStoryChunks = async (data: StoryChunksForm, startOffset?: number) => {
    setStoryChunksQueried(true);
    if ((startOffset ?? 0) === 0) {
      setStoryChunksData([]);
      setStoryChunksTotal(0);
      setStoryChunksHasMore(false);
      setStoryChunksOffset(0);
    }
    setStoryChunksLoading(true);
    setStoryChunksError(null);
    try {
      const provider = makeProvider(rpcUrl, chainId);
      const contract = new ethers.Contract(contractAddress, (DeepFamily as any).abi, provider);
      const off = startOffset !== undefined ? startOffset : storyChunksOffset;
      if (data.tokenId === undefined || !Number.isFinite(data.tokenId)) {
        throw new Error(t("search.validation.tokenIdRequired"));
      }
      const out: any = await contract.listStoryChunks(data.tokenId, off, data.pageSize);
      const rawChunks: any[] = Array.from(out?.chunks ?? out?.[0] ?? []);
      const chunks: StoryChunk[] = rawChunks.map(
        (chunk: any): StoryChunk => ({
          chunkIndex: Number(chunk?.chunkIndex ?? chunk?.[0] ?? 0),
          chunkHash: String(chunk?.chunkHash ?? chunk?.[1] ?? ethers.ZeroHash),
          content: String(chunk?.content ?? chunk?.[2] ?? ""),
          timestamp: Number(chunk?.timestamp ?? chunk?.[3] ?? 0),
          editor: String(chunk?.editor ?? chunk?.[4] ?? ethers.ZeroAddress),
          chunkType: Number(chunk?.chunkType ?? chunk?.[5] ?? 0),
          attachmentCID: String(chunk?.attachmentCID ?? chunk?.[6] ?? ""),
        }),
      );
      const totalChunks: number = Number(out?.totalChunks ?? out?.[1] ?? 0);
      const more: boolean = Boolean(out?.hasMore ?? out?.[2]);
      const nextOffset: number = Number(out?.nextOffset ?? out?.[3] ?? 0);
      setStoryChunksData(chunks);
      setStoryChunksTotal(totalChunks);
      setStoryChunksHasMore(more);
      setStoryChunksOffset(nextOffset);
    } catch (e: any) {
      setStoryChunksError(e?.message || t("search.queryFailed"));
    } finally {
      setStoryChunksLoading(false);
    }
  };

  const onResetStoryChunksQuery = () => {
    setStoryChunksData([]);
    setStoryChunksTotal(0);
    setStoryChunksHasMore(false);
    setStoryChunksOffset(0);
    setStoryChunksError(null);
    setStoryChunksQueried(false);
  };

  const onStoryChunksNext = async () => {
    const tokenId = getWatchedStoryTokenId();
    if (tokenId === undefined) {
      setStoryChunksError(t("search.validation.tokenIdRequired"));
      return;
    }
    await onQueryStoryChunks({ tokenId, pageSize: storyChunksPageSize });
  };
  const onStoryChunksPrev = async () => {
    const prev = Math.max(0, storyChunksOffset - storyChunksPageSize * 2);
    const tokenId = getWatchedStoryTokenId();
    if (tokenId === undefined) {
      setStoryChunksError(t("search.validation.tokenIdRequired"));
      return;
    }
    await onQueryStoryChunks({ tokenId, pageSize: storyChunksPageSize }, prev);
  };

  const onQueryChildren = async (data: ChildrenForm, startOffset?: number) => {
    setChildrenQueried(true);
    if ((startOffset ?? 0) === 0) {
      setChildrenData({ childHashes: [], childVersions: [] });
      setChildrenTotal(0);
      setChildrenHasMore(false);
      setChildrenOffset(0);
    }
    setChildrenLoading(true);
    setChildrenError(null);
    try {
      const provider = makeProvider(rpcUrl, chainId);
      const contract = new ethers.Contract(contractAddress, (DeepFamily as any).abi, provider);
      const off = startOffset !== undefined ? startOffset : childrenOffset;
      const parentVersionIndex = Number(data.parentVersionIndex);
      if (!Number.isFinite(parentVersionIndex)) {
        throw new Error("Invalid parent version index");
      }
      const out = await contract.listChildren(
        data.parentHash,
        parentVersionIndex,
        off,
        data.pageSize,
      );
      const childHashes: string[] = Array.from(out?.[0] || []);
      const childVersions: number[] = Array.from(out?.[1] || []).map(Number);
      const totalChildren: number = Number(out?.[2] || 0);
      const more: boolean = Boolean(out?.[3]);
      const nextOffset: number = Number(out?.[4] || 0);
      setChildrenData({ childHashes, childVersions });
      setChildrenTotal(totalChildren);
      setChildrenHasMore(more);
      setChildrenOffset(nextOffset);
    } catch (e: any) {
      setChildrenError(e?.message || t("search.queryFailed"));
    } finally {
      setChildrenLoading(false);
    }
  };

  const onResetChildrenQuery = () => {
    setChildrenData({ childHashes: [], childVersions: [] });
    setChildrenTotal(0);
    setChildrenHasMore(false);
    setChildrenOffset(0);
    setChildrenError(null);
    setChildrenQueried(false);
  };

  const onChildrenNext = async () => {
    const parentVersionIndex = getWatchedParentVersionIndex();
    if (parentVersionIndex === undefined) {
      setChildrenError(t("search.validation.versionIndexRequired"));
      return;
    }
    await onQueryChildren({
      parentHash: w7("parentHash") || "",
      parentVersionIndex,
      pageSize: childrenPageSize,
    });
  };
  const onChildrenPrev = async () => {
    const prev = Math.max(0, childrenOffset - childrenPageSize * 2);
    const parentVersionIndex = getWatchedParentVersionIndex();
    if (parentVersionIndex === undefined) {
      setChildrenError(t("search.validation.versionIndexRequired"));
      return;
    }
    await onQueryChildren(
      { parentHash: w7("parentHash") || "", parentVersionIndex, pageSize: childrenPageSize },
      prev,
    );
  };

  return (
    <div className="space-y-6 text-gray-900 dark:text-gray-100 pb-8 md:pb-0 max-w-7xl mx-auto">
      {/* Hash Calculator Section */}
      <SectionCard
        title={t("search.hashCalculator.title")}
        isOpen={openSections.hash}
        onToggle={() => toggle("hash")}
      >
        <div className="space-y-4">
          <div className="w-full">
            <PersonHashCalculator
              showTitle={false}
              collapsible={false}
              className="border-0 shadow-none bg-transparent p-0"
            />
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("search.hashCalculator.description")}
          </p>
        </div>
      </SectionCard>
      {/* Versions Section */}
      <SectionCard
        title={t("search.versionsQuery.title")}
        isOpen={openSections.versions}
        onToggle={() => toggle("versions")}
      >
        <div className="space-y-6">
          <form
            onSubmit={hs5((d) => onQueryPersonVersions(d, 0))}
            className="flex flex-col md:flex-row gap-4 items-start"
          >
            <div className="flex-1 w-full">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                {t("search.versionsQuery.personHash")}
              </label>
              <Input placeholder={t("search.versionsQuery.placeholder")} {...reg5("personHash")} />
              <FieldError message={e5.personHash?.message as any} />
            </div>
            <div className="w-full md:w-32">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                {t("search.nameQuery.pageSize")}
              </label>
              <Input
                type="number"
                placeholder={t("search.pageSizePlaceholder", { defaultValue: "≤100" })}
                {...reg5("pageSize", { setValueAs: sanitizeNumberInput })}
              />
              <FieldError
                message={formatNumericError(e5.pageSize?.message, pageSizeValidationMessage)}
              />
            </div>
            <div className="flex gap-3 pt-7 w-full md:w-auto">
              <ButtonPrimary type="submit" disabled={versionsLoading}>
                {versionsLoading ? (
                  <RefreshCw className="animate-spin" size={18} />
                ) : (
                  <Search size={18} />
                )}
                {t("search.query")}
              </ButtonPrimary>
              <ButtonSecondary type="button" onClick={onResetVersionsQuery}>
                {t("search.reset")}
              </ButtonSecondary>
            </div>
          </form>

          {versionsQueried && (
            <div className="space-y-4">
              <div className="text-sm text-gray-500 dark:text-gray-400 font-medium">
                {t("search.totalResults")}: {versionsTotal}
              </div>
              <div className="rounded-2xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
                {versionsData.length === 0 ? (
                  <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                    {versionsLoading ? t("search.loading") : t("search.noData")}
                  </div>
                ) : (
                  versionsData.map((version, i) => (
                    <div
                      key={i}
                      className="p-4 hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors"
                    >
                      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm mb-3">
                        <div className="px-2.5 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 font-medium text-xs">
                          v{Number(version.versionIndex)}
                        </div>
                        <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                          <span>{t("search.versionsQuery.creator")}:</span>
                          <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-md">
                            <HashInline
                              value={String(version.addedBy || "")}
                              className="font-mono text-xs text-gray-900 dark:text-gray-200"
                            />
                            <button
                              onClick={() => onCopy(String(version.addedBy || ""))}
                              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                            >
                              <Clipboard size={12} />
                            </button>
                          </div>
                        </div>
                        <div className="text-gray-500 dark:text-gray-500 text-xs">
                          {version.timestamp
                            ? formatUnixSeconds(version.timestamp)
                            : t("search.versionsQuery.unknown")}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm bg-gray-50 dark:bg-gray-900/30 rounded-xl p-4">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-gray-500 dark:text-gray-400">
                              {t("search.versionsQuery.versionTag")}:
                            </span>
                            <span className="font-medium text-gray-900 dark:text-gray-100">
                              {version.tag || t("search.versionsQuery.none")}
                            </span>
                          </div>
                          {version.metadataCID && (
                            <div className="flex items-center justify-between">
                              <span className="text-gray-500 dark:text-gray-400">
                                {t("search.versionsQuery.metadataCID")}:
                              </span>
                              <span className="font-mono text-xs text-gray-900 dark:text-gray-100 truncate max-w-[150px]">
                                {version.metadataCID}
                              </span>
                            </div>
                          )}
                        </div>

                        <div className="space-y-2 border-t md:border-t-0 md:border-l border-gray-200 dark:border-gray-700 pt-2 md:pt-0 md:pl-4">
                          <div className="flex items-center justify-between">
                            <span className="text-gray-500 dark:text-gray-400">
                              {t("search.versionsQuery.fatherHash")}:
                            </span>
                            <div className="flex items-center gap-1">
                              <HashInline
                                value={version.fatherHash}
                                className="font-mono text-xs"
                              />
                              <span className="text-xs text-gray-400">
                                (v{Number(version.fatherVersionIndex)})
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-gray-500 dark:text-gray-400">
                              {t("search.versionsQuery.motherHash")}:
                            </span>
                            <div className="flex items-center gap-1">
                              <HashInline
                                value={version.motherHash}
                                className="font-mono text-xs"
                              />
                              <span className="text-xs text-gray-400">
                                (v{Number(version.motherVersionIndex)})
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="flex items-center justify-between pt-2">
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {t("search.offset")}: {versionsOffset}
                </div>
                <div className="flex gap-2">
                  <ButtonSecondary
                    onClick={onVersionsPrev}
                    disabled={versionsLoading || versionsOffset === 0}
                    className="!px-4 !py-1.5 text-sm"
                  >
                    <ArrowLeft size={14} />
                    {t("search.prev")}
                  </ButtonSecondary>
                  <ButtonSecondary
                    onClick={onVersionsNext}
                    disabled={versionsLoading || !versionsHasMore}
                    className="!px-4 !py-1.5 text-sm"
                  >
                    {t("search.next")}
                    <ArrowRight size={14} />
                  </ButtonSecondary>
                </div>
              </div>
              {versionsError && (
                <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-100 dark:border-red-800/30">
                  {versionsError}
                </div>
              )}
            </div>
          )}
        </div>
      </SectionCard>
      {/* Endorsement Stats Section */}
      <SectionCard
        title={t("search.endorsementQuery.title")}
        isOpen={openSections.endorsement}
        onToggle={() => toggle("endorsement")}
      >
        <div className="space-y-6">
          <form
            onSubmit={hs3((d) => onQueryEndorsementStats(d, 0))}
            className="flex flex-col md:flex-row gap-4 items-start"
          >
            <div className="flex-1 w-full">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                {t("search.endorsementQuery.personHash")}
              </label>
              <Input
                placeholder={t("search.endorsementQuery.placeholder")}
                {...reg3("personHash")}
              />
              <FieldError message={e3.personHash?.message as any} />
            </div>
            <div className="w-full md:w-32">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                {t("search.nameQuery.pageSize")}
              </label>
              <Input
                type="number"
                placeholder={t("search.pageSizePlaceholder", { defaultValue: "≤100" })}
                {...reg3("pageSize", { setValueAs: sanitizeNumberInput })}
              />
              <FieldError
                message={formatNumericError(e3.pageSize?.message, pageSizeValidationMessage)}
              />
            </div>
            <div className="flex gap-3 pt-7 w-full md:w-auto">
              <ButtonPrimary type="submit" disabled={endorsementLoading}>
                {endorsementLoading ? (
                  <RefreshCw className="animate-spin" size={18} />
                ) : (
                  <Search size={18} />
                )}
                {t("search.query")}
              </ButtonPrimary>
              <ButtonSecondary type="button" onClick={onResetEndorsementQuery}>
                {t("search.reset")}
              </ButtonSecondary>
            </div>
          </form>

          {endorsementQueried && (
            <div className="space-y-4">
              <div className="text-sm text-gray-500 dark:text-gray-400 font-medium">
                {t("search.totalResults")}: {endorsementTotal}
              </div>
              <div className="rounded-2xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
                {endorsementData.versionIndices.length === 0 ? (
                  <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                    {endorsementLoading ? t("search.loading") : t("search.noData")}
                  </div>
                ) : (
                  endorsementData.versionIndices.map((versionIndex, i) => (
                    <div
                      key={i}
                      className="p-4 hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors"
                    >
                      <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="text-gray-500 dark:text-gray-400">
                            {t("search.endorsementQuery.version")}:
                          </span>
                          <span className="font-medium text-gray-900 dark:text-gray-100 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-md">
                            v{versionIndex}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-gray-500 dark:text-gray-400">
                            {t("search.endorsementQuery.endorsementCount")}:
                          </span>
                          <span className="font-bold text-orange-500">
                            {endorsementData.endorsementCounts[i]}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-gray-500 dark:text-gray-400">
                            {t("search.endorsementQuery.tokenId")}:
                          </span>
                          <span className="font-mono text-gray-900 dark:text-gray-100">
                            #{endorsementData.tokenIds[i]}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="flex items-center justify-between pt-2">
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {t("search.offset")}: {endorsementOffset}
                </div>
                <div className="flex gap-2">
                  <ButtonSecondary
                    onClick={onEndorsementPrev}
                    disabled={endorsementLoading || endorsementOffset === 0}
                    className="!px-4 !py-1.5 text-sm"
                  >
                    <ArrowLeft size={14} />
                    {t("search.prev")}
                  </ButtonSecondary>
                  <ButtonSecondary
                    onClick={onEndorsementNext}
                    disabled={endorsementLoading || !endorsementHasMore}
                    className="!px-4 !py-1.5 text-sm"
                  >
                    {t("search.next")}
                    <ArrowRight size={14} />
                  </ButtonSecondary>
                </div>
              </div>
              {endorsementError && (
                <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-100 dark:border-red-800/30">
                  {endorsementError}
                </div>
              )}
            </div>
          )}
        </div>
      </SectionCard>
      {/* Children Query Section */}
      <SectionCard
        title={t("search.childrenQuery.title")}
        isOpen={openSections.children}
        onToggle={() => toggle("children")}
      >
        <div className="space-y-6">
          <form
            onSubmit={hs7((d) => onQueryChildren(d, 0))}
            className="flex flex-col md:flex-row gap-4 items-start"
          >
            <div className="flex-1 w-full">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                {t("search.childrenQuery.parentHash")}
              </label>
              <Input
                placeholder={t("search.childrenQuery.parentHashPlaceholder")}
                {...reg7("parentHash")}
              />
              <FieldError message={e7.parentHash?.message as any} />
            </div>
            <div className="w-full md:w-32">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                {t("search.childrenQuery.parentVersion")}
              </label>
              <Input
                type="number"
                placeholder={t("search.versionIndexPlaceholder", { defaultValue: "≥0" })}
                title={t("search.versionIndexPlaceholder", { defaultValue: "≥0" })}
                {...reg7("parentVersionIndex", { setValueAs: sanitizeNumberInput })}
              />
              <FieldError
                message={formatNumericError(
                  e7.parentVersionIndex?.message,
                  versionIndexValidationMessage,
                )}
              />
            </div>
            <div className="w-full md:w-32">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                {t("search.nameQuery.pageSize")}
              </label>
              <Input
                type="number"
                placeholder={t("search.pageSizePlaceholder", { defaultValue: "≤100" })}
                {...reg7("pageSize", { setValueAs: sanitizeNumberInput })}
              />
              <FieldError
                message={formatNumericError(e7.pageSize?.message, pageSizeValidationMessage)}
              />
            </div>
            <div className="flex gap-3 pt-7 w-full md:w-auto">
              <ButtonPrimary type="submit" disabled={childrenLoading}>
                {childrenLoading ? (
                  <RefreshCw className="animate-spin" size={18} />
                ) : (
                  <Search size={18} />
                )}
                {t("search.query")}
              </ButtonPrimary>
              <ButtonSecondary type="button" onClick={onResetChildrenQuery}>
                {t("search.reset")}
              </ButtonSecondary>
            </div>
          </form>

          {childrenQueried && (
            <div className="space-y-4">
              <div className="text-sm text-gray-500 dark:text-gray-400 font-medium">
                {t("search.childrenQuery.totalChildren")}: {childrenTotal}
              </div>
              <div className="rounded-2xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
                {childrenData.childHashes.length === 0 ? (
                  <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                    {childrenLoading ? t("search.loading") : t("search.noData")}
                  </div>
                ) : (
                  childrenData.childHashes.map((childHash, i) => (
                    <div
                      key={i}
                      className="p-4 hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors"
                    >
                      <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="text-gray-500 dark:text-gray-400">
                            {t("search.childrenQuery.childHash")}:
                          </span>
                          <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-md">
                            <HashInline
                              value={childHash}
                              className="font-mono text-xs text-gray-900 dark:text-gray-200"
                            />
                            <button
                              onClick={() => onCopy(childHash)}
                              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                            >
                              <Clipboard size={12} />
                            </button>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-gray-500 dark:text-gray-400">
                            {t("search.childrenQuery.childVersion")}:
                          </span>
                          <span className="font-medium text-gray-900 dark:text-gray-100 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-md">
                            v{childrenData.childVersions[i]}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="flex items-center justify-between pt-2">
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {t("search.offset")}: {childrenOffset}
                </div>
                <div className="flex gap-2">
                  <ButtonSecondary
                    onClick={onChildrenPrev}
                    disabled={childrenLoading || childrenOffset === 0}
                    className="!px-4 !py-1.5 text-sm"
                  >
                    <ArrowLeft size={14} />
                    {t("search.prev")}
                  </ButtonSecondary>
                  <ButtonSecondary
                    onClick={onChildrenNext}
                    disabled={childrenLoading || !childrenHasMore}
                    className="!px-4 !py-1.5 text-sm"
                  >
                    {t("search.next")}
                    <ArrowRight size={14} />
                  </ButtonSecondary>
                </div>
              </div>
              {childrenError && (
                <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-100 dark:border-red-800/30">
                  {childrenError}
                </div>
              )}
            </div>
          )}
        </div>
      </SectionCard>
      {/* Story Chunks Query Section */}
      <SectionCard
        title={t("search.storyChunksQuery.title")}
        isOpen={openSections.storyChunks}
        onToggle={() => toggle("storyChunks")}
      >
        <div className="space-y-6">
          <form
            onSubmit={hs6((d) => onQueryStoryChunks(d, 0))}
            className="flex flex-col md:flex-row gap-4 items-start"
          >
            <div className="flex-1 w-full">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                {t("search.storyChunksQuery.tokenId")}
              </label>
              <Input
                type="number"
                placeholder={t("search.storyChunksQuery.placeholder")}
                title={t("search.storyChunksQuery.placeholder")}
                {...reg6("tokenId", { setValueAs: sanitizeNumberInput })}
              />
              <FieldError
                message={formatNumericError(e6.tokenId?.message, tokenIdValidationMessage)}
              />
            </div>
            <div className="w-full md:w-32">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                {t("search.nameQuery.pageSize")}
              </label>
              <Input
                type="number"
                placeholder={t("search.pageSizePlaceholder", { defaultValue: "≤100" })}
                {...reg6("pageSize", { setValueAs: sanitizeNumberInput })}
              />
              <FieldError
                message={formatNumericError(e6.pageSize?.message, pageSizeValidationMessage)}
              />
            </div>
            <div className="flex gap-3 pt-7 w-full md:w-auto">
              <ButtonPrimary type="submit" disabled={storyChunksLoading}>
                {storyChunksLoading ? (
                  <RefreshCw className="animate-spin" size={18} />
                ) : (
                  <Search size={18} />
                )}
                {t("search.query")}
              </ButtonPrimary>
              <ButtonSecondary type="button" onClick={onResetStoryChunksQuery}>
                {t("search.reset")}
              </ButtonSecondary>
            </div>
          </form>

          {storyChunksQueried && (
            <div className="space-y-4">
              <div className="text-sm text-gray-500 dark:text-gray-400 font-medium">
                {t("search.storyChunksQuery.totalChunks")}: {storyChunksTotal}
              </div>
              <div className="rounded-2xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
                {storyChunksData.length === 0 ? (
                  <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                    {storyChunksLoading ? t("search.loading") : t("search.noData")}
                  </div>
                ) : (
                  storyChunksData.map((chunk, i) => (
                    <div
                      key={i}
                      className="p-4 hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors"
                    >
                      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm mb-3">
                        <div className="px-2.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-medium text-xs">
                          #{Number(chunk.chunkIndex)}
                        </div>
                        <div className="text-gray-500 dark:text-gray-500 text-xs">
                          {chunk.timestamp
                            ? formatUnixSeconds(chunk.timestamp)
                            : t("search.versionsQuery.unknown")}
                        </div>
                        <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400 ml-auto">
                          <span className="text-xs">{t("search.storyChunksQuery.chunkType")}:</span>
                          <span className="font-medium text-gray-900 dark:text-gray-100">
                            {getChunkTypeLabel(Number(chunk.chunkType ?? 0))}
                          </span>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <div className="bg-gray-50 dark:bg-gray-900/50 p-3 rounded-xl text-sm text-gray-700 dark:text-gray-300 leading-relaxed max-h-32 overflow-y-auto">
                          {chunk.content || (
                            <span className="text-gray-400 italic">{t("search.noData")}</span>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-4 text-xs text-gray-500 dark:text-gray-400">
                          <div className="flex items-center gap-1">
                            <span>{t("search.storyChunksQuery.chunkHash")}:</span>
                            <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
                              <HashInline value={chunk.chunkHash} className="font-mono" />
                              <button onClick={() => onCopy(String(chunk.chunkHash || ""))}>
                                <Clipboard size={10} />
                              </button>
                            </div>
                          </div>

                          {chunk.editor && (
                            <div className="flex items-center gap-1">
                              <span>{t("search.storyChunksQuery.editor")}:</span>
                              <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
                                <HashInline value={String(chunk.editor)} className="font-mono" />
                                <button onClick={() => onCopy(String(chunk.editor))}>
                                  <Clipboard size={10} />
                                </button>
                              </div>
                            </div>
                          )}

                          {chunk.attachmentCID && chunk.attachmentCID.length > 0 && (
                            <div className="flex items-center gap-1">
                              <span>{t("search.storyChunksQuery.attachmentCID")}:</span>
                              <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
                                <span className="font-mono truncate max-w-[100px]">
                                  {chunk.attachmentCID}
                                </span>
                                <button onClick={() => onCopy(String(chunk.attachmentCID))}>
                                  <Clipboard size={10} />
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="flex items-center justify-between pt-2">
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {t("search.offset")}: {storyChunksOffset}
                </div>
                <div className="flex gap-2">
                  <ButtonSecondary
                    onClick={onStoryChunksPrev}
                    disabled={storyChunksLoading || storyChunksOffset === 0}
                    className="!px-4 !py-1.5 text-sm"
                  >
                    <ArrowLeft size={14} />
                    {t("search.prev")}
                  </ButtonSecondary>
                  <ButtonSecondary
                    onClick={onStoryChunksNext}
                    disabled={storyChunksLoading || !storyChunksHasMore}
                    className="!px-4 !py-1.5 text-sm"
                  >
                    {t("search.next")}
                    <ArrowRight size={14} />
                  </ButtonSecondary>
                </div>
              </div>
              {storyChunksError && (
                <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-100 dark:border-red-800/30">
                  {storyChunksError}
                </div>
              )}
            </div>
          )}
        </div>
      </SectionCard>
      {/* URI History Section */}
      <SectionCard
        title={t("search.uriQuery.title")}
        isOpen={openSections.uri}
        onToggle={() => toggle("uri")}
      >
        <div className="space-y-6">
          <form
            onSubmit={hs4((d) => onQueryTokenURIHistory(d, 0))}
            className="flex flex-col md:flex-row gap-4 items-start"
          >
            <div className="flex-1 w-full">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                {t("search.uriQuery.tokenId")}
              </label>
              <Input
                type="number"
                placeholder={t("search.uriQuery.placeholder")}
                title={t("search.uriQuery.placeholder")}
                {...reg4("tokenId", { setValueAs: sanitizeNumberInput })}
              />
              <FieldError
                message={formatNumericError(e4.tokenId?.message, tokenIdValidationMessage)}
              />
            </div>
            <div className="w-full md:w-32">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                {t("search.nameQuery.pageSize")}
              </label>
              <Input
                type="number"
                placeholder={t("search.pageSizePlaceholder", { defaultValue: "≤100" })}
                {...reg4("pageSize", { setValueAs: sanitizeNumberInput })}
              />
              <FieldError
                message={formatNumericError(e4.pageSize?.message, pageSizeValidationMessage)}
              />
            </div>
            <div className="flex gap-3 pt-7 w-full md:w-auto">
              <ButtonPrimary type="submit" disabled={uriLoading}>
                {uriLoading ? (
                  <RefreshCw className="animate-spin" size={18} />
                ) : (
                  <Search size={18} />
                )}
                {t("search.query")}
              </ButtonPrimary>
              <ButtonSecondary type="button" onClick={onResetUriQuery}>
                {t("search.reset")}
              </ButtonSecondary>
            </div>
          </form>

          {uriQueried && (
            <div className="space-y-4">
              <div className="text-sm text-gray-500 dark:text-gray-400 font-medium">
                {t("search.totalResults")}: {uriTotal}
              </div>
              <div className="rounded-2xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
                {uriData.length === 0 ? (
                  <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                    {uriLoading ? t("search.loading") : t("search.noData")}
                  </div>
                ) : (
                  uriData.map((uri, i) => (
                    <div
                      key={i}
                      className="p-4 hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors flex items-center gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 px-3 py-2 rounded-lg">
                          <span
                            className="font-mono text-sm text-gray-700 dark:text-gray-300 truncate flex-1"
                            title={uri}
                          >
                            {uri}
                          </span>
                          <button
                            onClick={() => onCopy(uri)}
                            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                          >
                            <Clipboard size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="flex items-center justify-between pt-2">
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {t("search.offset")}: {uriOffset}
                </div>
                <div className="flex gap-2">
                  <ButtonSecondary
                    onClick={onUriPrev}
                    disabled={uriLoading || uriOffset === 0}
                    className="!px-4 !py-1.5 text-sm"
                  >
                    <ArrowLeft size={14} />
                    {t("search.prev")}
                  </ButtonSecondary>
                  <ButtonSecondary
                    onClick={onUriNext}
                    disabled={uriLoading || !uriHasMore}
                    className="!px-4 !py-1.5 text-sm"
                  >
                    {t("search.next")}
                    <ArrowRight size={14} />
                  </ButtonSecondary>
                </div>
              </div>
              {uriError && (
                <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-100 dark:border-red-800/30">
                  {uriError}
                </div>
              )}
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
// Inline hash renderer: shows full when fits; otherwise 10...8 middle ellipsis
const HashInline: React.FC<{
  value: string;
  className?: string;
  titleText?: string;
  prefix?: number;
  suffix?: number;
}> = ({ value, className = "", titleText, prefix = 10, suffix = 8 }) => {
  const containerRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState<string>(value);

  const recompute = () => {
    const container = containerRef.current;
    const meas = measureRef.current;
    if (!container || !meas) return;
    meas.textContent = value;
    const fits = meas.scrollWidth <= container.clientWidth;
    setDisplay(fits ? value : formatHashMiddle(value, prefix, suffix));
  };

  useEffect(() => {
    recompute();
    const ro = new ResizeObserver(() => recompute());
    if (containerRef.current) ro.observe(containerRef.current);
    const onResize = () => recompute();
    window.addEventListener("resize", onResize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [value, prefix, suffix]);

  return (
    <>
      <span
        ref={containerRef}
        className={`min-w-0 overflow-hidden whitespace-nowrap ${className}`}
        title={titleText ?? value}
      >
        {display}
      </span>
      {/* measurement node mirrors font styles to ensure accurate width */}
      <span
        ref={measureRef}
        className={`absolute left-[-99999px] top-0 invisible whitespace-nowrap ${className}`}
      />
    </>
  );
};
