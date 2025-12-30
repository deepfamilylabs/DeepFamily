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
import { parseEncryptedPayload, EncryptedMetadataPayload } from "../lib/metadataCrypto";
import { sanitizeErrorForLogging } from "../lib/errors";
import { IPFS_GATEWAY_BASE_URLS } from "../config/ipfs";
import { cryptoWorkerCall } from "../lib/cryptoWorkerClient";

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
  const isDev = import.meta.env.DEV;

  const [cid, setCid] = useState(initialCID);
  const [baseUrl, setBaseUrl] = useState(initialGateway);
  const [encryptedJson, setEncryptedJson] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any | null>(null);
  const [payloadMeta, setPayloadMeta] = useState<EncryptedMetadataPayload | null>(null);
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
      const { data, payload } = await cryptoWorkerCall("decryptMetadataBundle", {
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
    <div className="space-y-8 text-gray-900 dark:text-gray-100">
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 justify-between border-b border-gray-200 dark:border-gray-800 pb-6">
        <div className="space-y-1">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-400">
            {t("decryptMetadata.title", "Decrypt Metadata")}
          </h1>
        </div>
        <span className="inline-flex px-4 py-1.5 text-xs font-medium rounded-full bg-orange-50 text-orange-700 border border-orange-100 dark:bg-orange-900/20 dark:text-orange-300 dark:border-orange-900/30 backdrop-blur-sm">
          AES-256-GCM · PBKDF2-SHA256
        </span>
      </div>

      <div className="grid lg:grid-cols-[1fr_0.9fr] gap-6 lg:gap-8">
        <div className="space-y-6">
          <div className="rounded-3xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900/50 backdrop-blur-xl shadow-xl shadow-gray-200/40 dark:shadow-black/20 p-6 sm:p-8 space-y-6 transition-all duration-300 hover:shadow-2xl hover:shadow-gray-200/60 dark:hover:shadow-black/30">
            <div className="flex items-center gap-3 text-base font-semibold text-gray-900 dark:text-white">
              <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">
                <Link2 className="w-5 h-5" />
              </div>
              <span>{t("decryptMetadata.source", "Fetch Encrypted Data")}</span>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 ml-1">
                  {t(
                    "decryptMetadata.baseUrl",
                    "Base URL",
                  )}
                </label>
                <div className="relative group">
                  <div className="flex items-center h-12 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50 focus-within:border-orange-500 focus-within:ring-4 focus-within:ring-orange-500/10 transition-all duration-300">
                    <input
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      onFocus={() => setShowGatewayList(true)}
                      onBlur={() => setTimeout(() => setShowGatewayList(false), 120)}
                      readOnly={!isDev}
                      className="flex-1 min-w-0 h-full bg-transparent border-none outline-none px-4 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400"
                      placeholder="https://ipfs.io/ipfs/"
                    />
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setShowGatewayList((v) => !v)}
                      className="h-full px-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                    >
                      <ChevronDown className="w-4 h-4" />
                    </button>
                  </div>
                  {showGatewayList && (
                    <div className="absolute z-30 mt-2 w-full rounded-2xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl shadow-gray-200/50 dark:shadow-black/50 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                      {IPFS_GATEWAY_BASE_URLS.map((g) => (
                        <button
                          type="button"
                          key={g}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setBaseUrl(g);
                            setShowGatewayList(false);
                          }}
                          className="w-full text-left px-4 py-3 text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                        >
                          {g}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {!isDev && (
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 px-1">
                    {t(
                      "decryptMetadata.gatewayCspHint",
                      "Restricted by CSP in production. Use listed gateways or file upload.",
                    )}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 ml-1">CID</label>
                <input
                  value={cid}
                  onChange={(e) => setCid(e.target.value)}
                  className="w-full h-12 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50 px-4 text-sm focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 transition-all duration-300 placeholder-gray-400"
                  placeholder={t("decryptMetadata.cidPlaceholder", "Paste CID")}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-3 pt-2">
              <button
                type="button"
                onClick={handleFetch}
                disabled={isFetching || (!isDev && !isBaseUrlAllowlisted)}
                className="inline-flex items-center gap-2 px-6 h-12 rounded-full bg-gradient-to-r from-orange-400 to-red-500 text-white text-sm font-semibold shadow-lg shadow-orange-500/30 hover:shadow-orange-500/50 hover:scale-105 active:scale-95 transition-all duration-300 disabled:opacity-60 disabled:hover:scale-100 disabled:shadow-none"
              >
                {isFetching ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CloudDownload className="w-4 h-4" />
                )}
                {t("decryptMetadata.fetch", "Fetch Data")}
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-6 h-12 rounded-full border-2 border-gray-200 dark:border-gray-700 bg-transparent text-sm font-semibold text-gray-600 dark:text-gray-300 hover:border-orange-400 dark:hover:border-orange-500 hover:text-orange-500 dark:hover:text-orange-400 transition-all duration-300 active:scale-95"
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
            <div className="space-y-2 pt-2 border-t border-gray-100 dark:border-gray-800/50">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 flex items-center gap-1.5 ml-1">
                <Lock className="w-3.5 h-3.5 text-orange-500" />
                {t(
                  "decryptMetadata.password",
                  "Decryption Password",
                )}
              </label>
              <div className="relative group">
                <input
                  type={showPassword ? "text" : "password"}
                  ref={passwordRef}
                  onChange={() => {
                    if (error) setError(null);
                  }}
                  className="w-full h-12 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50 pl-4 pr-12 text-sm focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 transition-all duration-300 placeholder-gray-400"
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
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-all flex items-center justify-center"
                  aria-label={
                    showPassword
                      ? t("decryptMetadata.hidePassword", "Hide password")
                      : t("decryptMetadata.showPassword", "Show password")
                  }
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900/50 backdrop-blur-xl shadow-xl shadow-gray-200/40 dark:shadow-black/20 p-6 sm:p-8 space-y-4 transition-all duration-300 hover:shadow-2xl hover:shadow-gray-200/60 dark:hover:shadow-black/30">
            <div className="flex items-center gap-3 text-base font-semibold text-gray-900 dark:text-white">
              <div className="p-2 rounded-xl bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400">
                <Shield className="w-5 h-5" />
              </div>
              <span>{t("decryptMetadata.payload", "Encrypted Content")}</span>
            </div>
            <textarea
              value={encryptedJson}
              onChange={(e) => setEncryptedJson(e.target.value)}
              className="w-full min-h-[200px] rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-950/50 px-4 py-4 text-sm font-mono focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 transition-all duration-300 placeholder-gray-400"
              placeholder="Encrypted JSON content will appear here..."
            />
            {payloadMeta && (
              <div className="grid sm:grid-cols-3 gap-3 text-xs">
                <div className="flex flex-col gap-1 px-4 py-3 rounded-2xl border border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
                  <span className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-bold">
                    {t("decryptMetadata.payloadMeta.version", "Format Version")}
                  </span>
                  <span className="text-gray-900 dark:text-gray-100 font-semibold">
                    {payloadMeta.version || "—"}
                  </span>
                </div>
                <div className="flex flex-col gap-1 px-4 py-3 rounded-2xl border border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
                  <span className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-bold">
                    Schema
                  </span>
                  <span className="text-gray-900 dark:text-gray-100 font-semibold break-words">
                    {payloadMeta.schema || payloadMeta.aad || "—"}
                  </span>
                </div>
                <div className="flex flex-col gap-1 px-4 py-3 rounded-2xl border border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
                  <span className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-bold">
                    {t("decryptMetadata.payloadMeta.cipher", "Algorithm")}
                  </span>
                  <span className="text-gray-900 dark:text-gray-100 font-semibold">
                    {payloadMeta.cipher || "—"}
                  </span>
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="p-4 rounded-2xl border border-red-200/50 bg-red-50/50 dark:bg-red-900/10 dark:border-red-900/30 text-red-600 dark:text-red-400 text-sm flex items-start gap-3 animate-in fade-in slide-in-from-top-2 duration-300">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <span className="font-medium">{error}</span>
            </div>
          )}

          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={handleDecrypt}
              disabled={isDecrypting}
              className="inline-flex items-center gap-2 px-8 h-14 rounded-full bg-gradient-to-r from-orange-400 to-red-500 text-white text-base font-bold shadow-xl shadow-orange-500/30 hover:shadow-2xl hover:shadow-orange-500/50 hover:scale-105 active:scale-95 transition-all duration-300 disabled:opacity-60 disabled:hover:scale-100 disabled:shadow-none w-full sm:w-auto justify-center"
            >
              {isDecrypting ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Eye className="w-5 h-5" />
              )}
              {t("decryptMetadata.decrypt", "Decrypt and View")}
            </button>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-3xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900/50 backdrop-blur-xl shadow-xl shadow-gray-200/40 dark:shadow-black/20 p-6 sm:p-8 min-h-[400px] flex flex-col transition-all duration-300 hover:shadow-2xl hover:shadow-gray-200/60 dark:hover:shadow-black/30">
            <div className="flex items-center gap-3 mb-6 text-base font-semibold">
              <div className="p-2 rounded-xl bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400">
                <Eye className="w-5 h-5" />
              </div>
              <span className="text-gray-900 dark:text-white">
                {t("decryptMetadata.result", "Decryption Result")}
              </span>
            </div>
            {result ? (
              <div className="flex-1 rounded-2xl bg-gray-50 dark:bg-gray-950/50 border border-gray-100 dark:border-gray-800 p-4 overflow-hidden">
                <pre className="text-xs sm:text-sm text-gray-800 dark:text-gray-200 font-mono overflow-x-auto h-full whitespace-pre-wrap break-words custom-scrollbar">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 rounded-2xl border-2 border-dashed border-gray-100 dark:border-gray-800 bg-gray-50/30 dark:bg-gray-900/30">
                <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4 text-gray-400 dark:text-gray-500">
                  <Lock className="w-8 h-8 opacity-50" />
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400 max-w-[200px]">
                  {t(
                    "decryptMetadata.resultPlaceholder",
                    "Decrypted plaintext metadata will be displayed here",
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

