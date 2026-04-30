import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import {
  Eye,
  EyeOff,
  CloudDownload,
  Upload,
  Link2,
  Lock,
  Shield,
  AlertTriangle,
  Loader2,
  ChevronDown,
} from "lucide-react";
import { parseEncryptedPayload, type AnyEncryptedMetadataPayload } from "../shared/crypto/metadataCrypto";
import { sanitizeErrorForLogging } from "../shared/lib/errors";
import { isDevMode } from "../shared/config/env";
import { IPFS_GATEWAY_BASE_URLS } from "../shared/ipfs/config";
import { cryptoWorkerCall } from "../shared/workers/cryptoWorkerClient";

const normalizeGatewayBaseUrl = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    const lowerPath = url.pathname.toLowerCase();
    if (url.pathname === "/" || url.pathname === "") {
      url.pathname = "/ipfs/";
    } else if (lowerPath.endsWith("/ipfs")) {
      url.pathname = `${url.pathname}/`;
    } else if (!url.pathname.endsWith("/")) {
      url.pathname = `${url.pathname}/`;
    }
    return url.toString();
  } catch {
    return null;
  }
};

export default function DecryptMetadataPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const initialCID = searchParams.get("cid") || "";
  const initialGateway = searchParams.get("gateway") || IPFS_GATEWAY_BASE_URLS[0];
  const isDev = isDevMode();

  const [cid, setCid] = useState(initialCID);
  const [baseUrl, setBaseUrl] = useState(initialGateway);
  const [encryptedJson, setEncryptedJson] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any | null>(null);
  const [payloadMeta, setPayloadMeta] = useState<AnyEncryptedMetadataPayload | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [showGatewayList, setShowGatewayList] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const passwordRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setCid(initialCID);
    setBaseUrl(initialGateway || IPFS_GATEWAY_BASE_URLS[0]);
  }, [initialCID, initialGateway]);

  const normalizedBaseUrl = normalizeGatewayBaseUrl(baseUrl) || baseUrl.trim();
  const isBaseUrlAllowlisted = IPFS_GATEWAY_BASE_URLS.includes(normalizedBaseUrl);
  const metadataIdentityMode =
    result?.identity?.mode === "random" || result?.identity?.mode === "deterministic"
      ? result.identity.mode
      : null;
  const fatherIdentityMode =
    result?.parents?.father?.identityMode === "random" ||
    result?.parents?.father?.identityMode === "deterministic"
      ? result.parents.father.identityMode
      : null;
  const motherIdentityMode =
    result?.parents?.mother?.identityMode === "random" ||
    result?.parents?.mother?.identityMode === "deterministic"
      ? result.parents.mother.identityMode
      : null;
  const hasIdentityRecoverySalt = Boolean(result?.recovery?.identityKdf?.saltHex);

  const renderIdentityModeBadge = (
    mode: "random" | "deterministic" | null,
    labels: {
      empty: string;
      deterministic: string;
      random: string;
    },
  ) => {
    if (mode === "random") {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200/60 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800/50 shadow-sm transition-transform hover:scale-105 cursor-default">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>
          {labels.random}
        </span>
      );
    }
    if (mode === "deterministic") {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-gray-50 text-gray-700 border border-gray-200/60 dark:bg-gray-800/80 dark:text-gray-300 dark:border-gray-700/60 shadow-sm transition-transform hover:scale-105 cursor-default">
          <span className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500"></span>
          {labels.deterministic}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-gray-50/50 text-gray-500 border border-gray-100 dark:bg-gray-900/30 dark:text-gray-500 dark:border-gray-800/50 transition-transform hover:scale-105 cursor-default">
        <span className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-700"></span>
        {labels.empty}
      </span>
    );
  };

  const buildUrl = () => {
    if (!cid.trim()) return "";
    if (!normalizedBaseUrl) return "";
    return normalizedBaseUrl.endsWith("/")
      ? `${normalizedBaseUrl}${cid.trim()}`
      : `${normalizedBaseUrl}/${cid.trim()}`;
  };

  const handleFetch = async () => {
    if (!isDev && !isBaseUrlAllowlisted) {
      setError(
        t(
          "decryptMetadata.gatewayBlockedByCsp",
          "This gateway is not allowlisted for fetch in strict mode (CSP). Choose a gateway from the list, or use file upload / paste.",
        ),
      );
      return;
    }
    const url = buildUrl();
    if (!url) {
      setError(t("decryptMetadata.cidRequired", "Please enter CID and base URL"));
      return;
    }
    setIsFetching(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      setEncryptedJson(text);
      setPayloadMeta(parseEncryptedPayload(text));
    } catch (err: any) {
      console.error("Fetch encrypted metadata failed", sanitizeErrorForLogging(err));
      setError(
        t(
          "decryptMetadata.fetchFailed",
          "Failed to fetch encrypted metadata, please check CID or network",
        ),
      );
    } finally {
      setIsFetching(false);
    }
  };

  const handleFile = async (file?: File) => {
    if (!file) return;
    try {
      const text = await file.text();
      setEncryptedJson(text);
      setError(null);
      setResult(null);
      setPayloadMeta(parseEncryptedPayload(text));
    } catch (err: any) {
      console.error("Read encrypted file failed", sanitizeErrorForLogging(err));
      setError(t("decryptMetadata.readFailed", "Failed to read encrypted file"));
    }
  };

  const handleDecrypt = async () => {
    const password = (passwordRef.current?.value ?? "").trim();
    if (!password) {
      setError(t("decryptMetadata.passwordRequired", "Please enter decryption password"));
      return;
    }
    if (!encryptedJson.trim()) {
      setError(
        t("decryptMetadata.payloadRequired", "Please fetch or paste encrypted content first"),
      );
      return;
    }
    try {
      setIsDecrypting(true);
      setError(null);
      const { data, payload } = await cryptoWorkerCall("decryptMetadataBundleV2", {
        payloadOrJson: encryptedJson,
        password,
      });
      setResult(data);
      setPayloadMeta(payload);
    } catch (err: any) {
      console.error("Decrypt metadata failed", sanitizeErrorForLogging(err));
      const message = err?.message || "";
      const localizedMessage =
        message === "Web Crypto is not available in this environment"
          ? t(
              "decryptMetadata.cryptoUnavailable",
              "Web Crypto is not available in this environment",
            )
          : message === "Plaintext hash verification failed"
            ? t(
                "decryptMetadata.hashMismatch",
                "Plaintext hash verification failed, password or file may be incorrect",
              )
            : message;
      setError(
        localizedMessage ||
          t("decryptMetadata.decryptFailed", "Decryption failed, please check password or file"),
      );
      setResult(null);
    } finally {
      setIsDecrypting(false);
    }
  };

  return (
    <div className="space-y-10 text-gray-900 dark:text-gray-100 animate-in fade-in zoom-in-95 duration-500 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 justify-between border-b border-gray-200/60 dark:border-gray-800/60 pb-6">
        <div className="space-y-1">
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-400 drop-shadow-sm">
            {t("decryptMetadata.title", "Decrypt Metadata")}
          </h1>
        </div>
        <span className="inline-flex px-4 py-1.5 text-xs font-semibold tracking-wide rounded-full bg-orange-50/80 text-orange-700 border border-orange-200/50 dark:bg-orange-900/20 dark:text-orange-300 dark:border-orange-900/30 backdrop-blur-md shadow-sm">
          AES-256-GCM <span className="mx-2 opacity-40">·</span> Argon2id
        </span>
      </div>

      <div className="grid lg:grid-cols-[1fr_0.9fr] gap-6 lg:gap-8">
        <div className="space-y-6 lg:space-y-8">

          {/* Source Section */}
          <div className="group/card relative rounded-3xl border border-gray-200/60 dark:border-gray-800/60 bg-white/70 dark:bg-gray-900/40 backdrop-blur-xl shadow-lg shadow-gray-200/20 dark:shadow-black/10 p-6 sm:p-8 space-y-6 transition-all duration-500 hover:shadow-2xl hover:shadow-orange-500/5 hover:-translate-y-1 hover:border-orange-500/20 dark:hover:border-orange-500/20 z-10">
            <div className="flex items-center gap-4 text-base font-bold text-gray-900 dark:text-white">
              <div className="flex items-center justify-center w-11 h-11 rounded-2xl bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 group-hover/card:scale-110 group-hover/card:bg-blue-100 dark:group-hover/card:bg-blue-900/40 group-hover/card:shadow-inner transition-all duration-300">
                <Link2 className="w-5 h-5" />
              </div>
              <span className="text-lg">{t("decryptMetadata.source", "Fetch Encrypted Data")}</span>
            </div>

            <div className="grid sm:grid-cols-2 gap-5">
              <div className="space-y-2">
                <label className="text-xs font-bold tracking-wide uppercase text-gray-500 dark:text-gray-400 ml-1">
                  {t("decryptMetadata.baseUrl", "Base URL")}
                </label>
                <div className="relative group">
                  <div className="absolute -inset-0.5 bg-gradient-to-r from-orange-400 to-red-500 rounded-2xl blur opacity-0 group-focus-within:opacity-20 transition duration-500"></div>
                  <div className="relative flex items-center h-14 rounded-2xl border border-gray-200/80 dark:border-gray-700/80 bg-white/90 dark:bg-gray-900/90 focus-within:border-orange-500 focus-within:ring-2 focus-within:ring-orange-500/20 transition-all duration-300 shadow-sm">
                    <input
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      onFocus={() => setShowGatewayList(true)}
                      onBlur={() => setTimeout(() => setShowGatewayList(false), 120)}
                      readOnly={!isDev}
                      className="flex-1 min-w-0 h-full bg-transparent border-none outline-none px-4 text-sm font-medium text-gray-900 dark:text-gray-100 placeholder-gray-400"
                      placeholder="https://ipfs.io/ipfs/"
                    />
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setShowGatewayList((v) => !v)}
                      className="h-full px-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                    >
                      <ChevronDown className="w-5 h-5" />
                    </button>
                  </div>
                  {showGatewayList && (
                    <div className="absolute z-30 mt-2 w-full rounded-2xl border border-gray-100 dark:border-gray-700 bg-white/95 dark:bg-gray-800/95 backdrop-blur-xl shadow-xl shadow-gray-200/50 dark:shadow-black/50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                      {IPFS_GATEWAY_BASE_URLS.map((g) => (
                        <button
                          type="button"
                          key={g}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setBaseUrl(g);
                            setShowGatewayList(false);
                          }}
                          className="w-full text-left px-4 py-3.5 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                        >
                          {g}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {!isDev && (
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 px-1">
                    {t(
                      "decryptMetadata.gatewayCspHint",
                      "Restricted by CSP in production. Use listed gateways or file upload.",
                    )}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold tracking-wide uppercase text-gray-500 dark:text-gray-400 ml-1">
                  CID
                </label>
                <div className="relative group">
                  <div className="absolute -inset-0.5 bg-gradient-to-r from-orange-400 to-red-500 rounded-2xl blur opacity-0 group-focus-within:opacity-20 transition duration-500"></div>
                  <input
                    value={cid}
                    onChange={(e) => setCid(e.target.value)}
                    className="relative w-full h-14 rounded-2xl border border-gray-200/80 dark:border-gray-700/80 bg-white/90 dark:bg-gray-900/90 px-4 text-sm font-medium focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20 transition-all duration-300 shadow-sm placeholder-gray-400"
                    placeholder={t("decryptMetadata.cidPlaceholder", "Paste CID")}
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-4 pt-2">
              <button
                type="button"
                onClick={handleFetch}
                disabled={isFetching || (!isDev && !isBaseUrlAllowlisted)}
                className="group relative inline-flex items-center gap-2 px-7 h-12 rounded-full bg-gradient-to-r from-orange-400 to-red-500 text-white text-sm font-bold transition-all duration-300 hover:scale-105 active:scale-95 disabled:opacity-60 disabled:hover:scale-100"
              >
                <div className="absolute -inset-1 bg-gradient-to-r from-orange-400 to-red-500 rounded-full blur opacity-30 group-hover:opacity-50 transition duration-300"></div>
                <div className="relative flex items-center gap-2">
                  {isFetching ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CloudDownload className="w-4 h-4" />
                  )}
                  {t("decryptMetadata.fetch", "Fetch Data")}
                </div>
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-7 h-12 rounded-full border-2 border-gray-200/80 dark:border-gray-700/80 bg-white/50 dark:bg-gray-800/50 text-sm font-bold text-gray-600 dark:text-gray-300 hover:border-orange-400 hover:text-orange-500 dark:hover:border-orange-500 dark:hover:text-orange-400 transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0 shadow-sm"
              >
                <Upload className="w-4 h-4" />
                {t("decryptMetadata.upload", "Upload File")}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
            </div>

            <div className="space-y-3 pt-6 border-t border-gray-100 dark:border-gray-800/60">
              <label className="text-xs font-bold tracking-wide uppercase text-gray-500 dark:text-gray-400 flex items-center gap-1.5 ml-1">
                <Lock className="w-3.5 h-3.5 text-orange-500" />
                {t("decryptMetadata.password", "Decryption Password")}
              </label>
              <div className="relative group">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-orange-400 to-red-500 rounded-2xl blur opacity-0 group-focus-within:opacity-20 transition duration-500"></div>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    ref={passwordRef}
                    onChange={() => {
                      if (error) setError(null);
                    }}
                    className="w-full h-14 rounded-2xl border border-gray-200/80 dark:border-gray-700/80 bg-white/90 dark:bg-gray-900/90 pl-5 pr-14 text-sm font-medium focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20 transition-all duration-300 shadow-sm placeholder-gray-400"
                    placeholder={t(
                      "decryptMetadata.passwordPlaceholder",
                      "Enter decryption password",
                    )}
                    inputMode="text"
                    autoCapitalize="none"
                    autoComplete="new-password"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 h-10 w-10 rounded-xl text-gray-400 hover:text-orange-500 dark:hover:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-all flex items-center justify-center"
                    aria-label={
                      showPassword
                        ? t("decryptMetadata.hidePassword", "Hide password")
                        : t("decryptMetadata.showPassword", "Show password")
                    }
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Payload Section */}
          <div className="group/card relative rounded-3xl border border-gray-200/60 dark:border-gray-800/60 bg-white/70 dark:bg-gray-900/40 backdrop-blur-xl shadow-lg shadow-gray-200/20 dark:shadow-black/10 p-6 sm:p-8 space-y-5 transition-all duration-500 hover:shadow-2xl hover:shadow-orange-500/5 hover:-translate-y-1 hover:border-orange-500/20 dark:hover:border-orange-500/20 z-10">
            <div className="flex items-center gap-4 text-base font-bold text-gray-900 dark:text-white">
              <div className="flex items-center justify-center w-11 h-11 rounded-2xl bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 group-hover/card:scale-110 group-hover/card:bg-purple-100 dark:group-hover/card:bg-purple-900/40 group-hover/card:shadow-inner transition-all duration-300">
                <Shield className="w-5 h-5" />
              </div>
              <span className="text-lg">{t("decryptMetadata.payload", "Encrypted Content")}</span>
            </div>

            <div className="relative group">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-orange-400 to-red-500 rounded-2xl blur opacity-0 group-focus-within:opacity-20 transition duration-500 pointer-events-none"></div>
              <textarea
                value={encryptedJson}
                onChange={(e) => setEncryptedJson(e.target.value)}
                className="relative w-full min-h-[220px] rounded-2xl border border-gray-200/80 dark:border-gray-700/80 bg-gray-50/80 dark:bg-gray-950/80 px-5 py-5 text-sm font-mono focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20 transition-all duration-300 shadow-inner placeholder-gray-400 custom-scrollbar resize-y leading-relaxed text-gray-700 dark:text-gray-300"
                placeholder="Encrypted JSON content will appear here..."
              />
            </div>

            {payloadMeta && (
              <div className="grid sm:grid-cols-3 gap-4 text-xs">
                <div className="flex flex-col gap-1.5 px-5 py-4 rounded-xl border border-gray-100/80 dark:border-gray-800/80 bg-white/80 dark:bg-gray-900/80 shadow-sm transition-transform hover:scale-[1.02]">
                  <span className="text-[10px] uppercase tracking-widest text-gray-400 dark:text-gray-500 font-bold">
                    {t("decryptMetadata.payloadMeta.version", "Format Version")}
                  </span>
                  <span className="text-gray-900 dark:text-gray-100 font-bold text-sm">
                    {payloadMeta.version || "—"}
                  </span>
                </div>
                <div className="flex flex-col gap-1.5 px-5 py-4 rounded-xl border border-gray-100/80 dark:border-gray-800/80 bg-white/80 dark:bg-gray-900/80 shadow-sm transition-transform hover:scale-[1.02]">
                  <span className="text-[10px] uppercase tracking-widest text-gray-400 dark:text-gray-500 font-bold">
                    Schema
                  </span>
                  <span className="text-gray-900 dark:text-gray-100 font-bold text-sm truncate" title={payloadMeta.schema || payloadMeta.aad}>
                    {payloadMeta.schema || payloadMeta.aad || "—"}
                  </span>
                </div>
                <div className="flex flex-col gap-1.5 px-5 py-4 rounded-xl border border-gray-100/80 dark:border-gray-800/80 bg-white/80 dark:bg-gray-900/80 shadow-sm transition-transform hover:scale-[1.02]">
                  <span className="text-[10px] uppercase tracking-widest text-gray-400 dark:text-gray-500 font-bold">
                    {t("decryptMetadata.payloadMeta.cipher", "Algorithm")}
                  </span>
                  <span className="text-gray-900 dark:text-gray-100 font-bold text-sm">
                    {payloadMeta.cipher || "—"}
                  </span>
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="p-5 rounded-2xl border border-red-200/60 bg-red-50/80 dark:bg-red-900/20 dark:border-red-900/40 text-red-700 dark:text-red-400 text-sm flex items-start gap-3.5 animate-in fade-in slide-in-from-top-4 duration-300 shadow-sm">
              <div className="p-1.5 rounded-full bg-red-100 dark:bg-red-900/40 shrink-0">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <span className="font-semibold pt-0.5 leading-relaxed">{error}</span>
            </div>
          )}

          <div className="flex justify-end pt-4">
            <button
              type="button"
              onClick={handleDecrypt}
              disabled={isDecrypting}
              className="relative group inline-flex items-center justify-center gap-3 px-10 h-16 rounded-full bg-gradient-to-r from-orange-400 to-red-500 text-white text-lg font-extrabold transition-all duration-300 hover:scale-[1.03] active:scale-95 disabled:opacity-60 disabled:hover:scale-100 w-full sm:w-auto"
            >
              <div className="absolute -inset-1.5 bg-gradient-to-r from-orange-400 to-red-500 rounded-full blur opacity-40 group-hover:opacity-70 transition duration-300"></div>
              <div className="relative flex items-center gap-2">
                {isDecrypting ? (
                  <Loader2 className="w-6 h-6 animate-spin" />
                ) : (
                  <Eye className="w-6 h-6 group-hover:scale-110 transition-transform duration-300" />
                )}
                <span>{t("decryptMetadata.decrypt", "Decrypt and View")}</span>
              </div>
            </button>
          </div>
        </div>

        {/* Result Section */}
        <div className="space-y-6 lg:space-y-8">
          <div className="group/card relative rounded-3xl border border-gray-200/60 dark:border-gray-800/60 bg-white/70 dark:bg-gray-900/40 backdrop-blur-xl shadow-lg shadow-gray-200/20 dark:shadow-black/10 p-6 sm:p-8 min-h-[500px] flex flex-col transition-all duration-500 hover:shadow-2xl hover:shadow-orange-500/5 hover:-translate-y-1 hover:border-orange-500/20 dark:hover:border-orange-500/20 z-10">
            <div className="flex items-center gap-4 mb-8 text-base font-bold text-gray-900 dark:text-white">
              <div className="flex items-center justify-center w-11 h-11 rounded-2xl bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 group-hover/card:scale-110 group-hover/card:bg-green-100 dark:group-hover/card:bg-green-900/40 group-hover/card:shadow-inner transition-all duration-300">
                <Eye className="w-5 h-5" />
              </div>
              <span className="text-lg">{t("decryptMetadata.result", "Decryption Result")}</span>
            </div>

            {result ? (
              <div className="flex-1 space-y-6 overflow-hidden flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="rounded-2xl border border-blue-100/80 dark:border-blue-900/40 bg-blue-50/50 dark:bg-blue-900/10 p-5 space-y-5 shadow-inner">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <div>
                      <h3 className="text-sm font-extrabold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                        {t("decryptMetadata.identityModeSummary", "Identity Mode Summary")}
                      </h3>
                      <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mt-2 leading-relaxed max-w-md">
                        {t(
                          "decryptMetadata.identityModeSummaryHint",
                          "This metadata records whether each identity path uses standard deterministic recovery or enhanced random-salt recovery.",
                        )}
                      </p>
                    </div>
                    <div className="shrink-0">
                      {renderIdentityModeBadge(metadataIdentityMode, {
                        empty: t("decryptMetadata.identityModeUnknown", "Unknown"),
                        deterministic: t(
                          "decryptMetadata.identityModeStandardShort",
                          "Standard",
                        ),
                        random: t("decryptMetadata.identityModeEnhancedShort", "Enhanced"),
                      })}
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="rounded-xl border border-white/80 dark:border-gray-800/80 bg-white/80 dark:bg-gray-950/60 p-4 space-y-3 shadow-sm transition-colors hover:border-blue-200 dark:hover:border-blue-800">
                      <div className="text-[10px] font-extrabold tracking-widest uppercase text-blue-600 dark:text-blue-400">
                        {t("decryptMetadata.personIdentityMode", "Person")}
                      </div>
                      <div>
                        {renderIdentityModeBadge(metadataIdentityMode, {
                          empty: t("decryptMetadata.identityModeUnknown", "Unknown"),
                          deterministic: t(
                            "decryptMetadata.identityModeStandard",
                            "Standard deterministic salt",
                          ),
                          random: t(
                            "decryptMetadata.identityModeEnhanced",
                            "Enhanced random recovery salt",
                          ),
                        })}
                      </div>
                      <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400 leading-relaxed border-t border-gray-100 dark:border-gray-800/50 pt-3">
                        {hasIdentityRecoverySalt
                          ? t(
                              "decryptMetadata.identityRecoveryPresent",
                              "Recovery salt is present in this metadata package.",
                            )
                          : t(
                              "decryptMetadata.identityRecoveryAbsent",
                              "No recovery salt stored. This usually means standard deterministic mode.",
                            )}
                      </p>
                    </div>

                    <div className="rounded-xl border border-white/80 dark:border-gray-800/80 bg-white/80 dark:bg-gray-950/60 p-4 space-y-3 shadow-sm transition-colors hover:border-blue-200 dark:hover:border-blue-800">
                      <div className="text-[10px] font-extrabold tracking-widest uppercase text-blue-600 dark:text-blue-400">
                        {t("decryptMetadata.parentIdentityModes", "Parents")}
                      </div>
                      <div className="flex flex-col gap-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Father</span>
                          {renderIdentityModeBadge(fatherIdentityMode, {
                            empty: "Unknown",
                            deterministic: "Standard",
                            random: "Enhanced",
                          })}
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Mother</span>
                          {renderIdentityModeBadge(motherIdentityMode, {
                            empty: "Unknown",
                            deterministic: "Standard",
                            random: "Enhanced",
                          })}
                        </div>
                      </div>
                      <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400 leading-relaxed border-t border-gray-100 dark:border-gray-800/50 pt-3">
                        {t(
                          "decryptMetadata.parentIdentityModesHint",
                          "Parent modes only affect how their identity proof is reconstructed when linking versions.",
                        )}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="relative flex-1 rounded-2xl bg-[#0d1117] dark:bg-black/40 border border-gray-800/40 p-1 overflow-hidden shadow-xl group/code">
                  <div className="absolute top-0 left-0 w-full h-8 bg-gradient-to-b from-[#161b22] to-transparent pointer-events-none z-10" />
                  <div className="absolute top-3 left-4 flex gap-1.5 z-20 opacity-50 group-hover/code:opacity-100 transition-opacity">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-500/80"></div>
                    <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/80"></div>
                    <div className="w-2.5 h-2.5 rounded-full bg-green-500/80"></div>
                  </div>
                  <pre className="h-full pt-10 pb-4 px-5 text-sm text-[#e6edf3] font-mono overflow-auto whitespace-pre-wrap break-words custom-scrollbar leading-relaxed">
                    {JSON.stringify(result, null, 2)}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 rounded-2xl border-2 border-dashed border-gray-200/80 dark:border-gray-700/80 bg-gray-50/40 dark:bg-gray-900/20 group/lock transition-colors hover:border-orange-300 dark:hover:border-orange-700/50">
                <div className="relative w-20 h-20 mb-6 flex items-center justify-center">
                  <div className="absolute inset-0 bg-gray-100 dark:bg-gray-800 rounded-full scale-100 group-hover/lock:scale-110 group-hover/lock:bg-orange-50 dark:group-hover/lock:bg-orange-900/20 transition-all duration-500 ease-out shadow-sm" />
                  <Lock className="w-8 h-8 text-gray-400 dark:text-gray-500 relative z-10 group-hover/lock:text-orange-500 transition-colors duration-300" />
                </div>
                <h4 className="text-base font-bold text-gray-700 dark:text-gray-300 mb-2">
                  Ready to Decrypt
                </h4>
                <p className="text-sm font-medium text-gray-500 dark:text-gray-500 max-w-[240px] leading-relaxed">
                  {t(
                    "decryptMetadata.resultPlaceholder",
                    "Decrypted plaintext metadata will be displayed here securely.",
                  )}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
