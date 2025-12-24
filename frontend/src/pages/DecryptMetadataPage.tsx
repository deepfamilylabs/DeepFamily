import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import {
  Eye,
  EyeOff,
  CloudDownload,
  FileDown,
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
    <div className="space-y-6 text-gray-900 dark:text-gray-100 pb-4 md:pb-0">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <h1 className="text-2xl sm:text-3xl font-semibold">
          {t("decryptMetadata.title", "Decrypt Metadata")}
        </h1>
        <span className="inline-flex px-3 py-1 text-[11px] font-semibold rounded-full bg-gray-200 text-gray-800 dark:bg-gray-800 dark:text-gray-100">
          AES-256-GCM · PBKDF2-SHA256
        </span>
      </div>

      <div className="grid lg:grid-cols-[1fr_0.9fr] gap-4 lg:gap-6">
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm p-5 space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Link2 className="w-4 h-4 text-blue-600" />
              <span>{t("decryptMetadata.source", "Fetch Encrypted Data")}</span>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-700 dark:text-gray-200">
                  {t(
                    "decryptMetadata.baseUrl",
                    "Base URL (combined with CID to form download address)",
                  )}
                </label>
                <div className="relative">
                  <div className="flex items-center h-11 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/30">
                    <input
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      onFocus={() => setShowGatewayList(true)}
                      onBlur={() => setTimeout(() => setShowGatewayList(false), 120)}
                      readOnly={!isDev}
                      className="flex-1 min-w-0 h-full bg-transparent border-none outline-none px-3 text-sm"
                      placeholder="https://ipfs.io/ipfs/"
                    />
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setShowGatewayList((v) => !v)}
                      className="h-full px-3 border-l border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition rounded-r-lg"
                    >
                      <ChevronDown className="w-4 h-4" />
                    </button>
                  </div>
                  {showGatewayList && (
                    <div className="absolute z-30 mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg">
                      {IPFS_GATEWAY_BASE_URLS.map((g) => (
                        <button
                          type="button"
                          key={g}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setBaseUrl(g);
                            setShowGatewayList(false);
                          }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
                        >
                          {g}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {!isDev && (
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">
                    {t(
                      "decryptMetadata.gatewayCspHint",
                      "In preview/production, fetch is restricted by CSP. Choose a gateway from the list, or use file upload / paste for arbitrary sources.",
                    )}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-700 dark:text-gray-200">CID</label>
                <input
                  value={cid}
                  onChange={(e) => setCid(e.target.value)}
                  className="w-full h-11 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
                  placeholder={t("decryptMetadata.cidPlaceholder", "Paste CID")}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleFetch}
                disabled={isFetching || (!isDev && !isBaseUrlAllowlisted)}
                className="inline-flex items-center gap-2 px-4 h-11 rounded-lg bg-blue-600 text-white text-sm font-medium shadow-sm hover:bg-blue-700 transition disabled:opacity-60"
              >
                {isFetching ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CloudDownload className="w-4 h-4" />
                )}
                {t("decryptMetadata.fetch", "Fetch Encrypted Data")}
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-4 h-11 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm font-medium hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <FileDown className="w-4 h-4" />
                {t("decryptMetadata.upload", "Upload Encrypted File")}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-700 dark:text-gray-200 flex items-center gap-1.5">
                <Lock className="w-4 h-4 text-blue-600" />
                {t(
                  "decryptMetadata.password",
                  "Decryption Password (must match encryption password)",
                )}
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  ref={passwordRef}
                  onChange={() => {
                    if (error) setError(null);
                  }}
                  className="w-full h-11 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 pl-3 pr-11 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
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
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-md text-gray-500 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition flex items-center justify-center"
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

          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm p-5 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Shield className="w-4 h-4 text-blue-600" />
              <span>{t("decryptMetadata.payload", "Encrypted Content")}</span>
            </div>
            <textarea
              value={encryptedJson}
              onChange={(e) => setEncryptedJson(e.target.value)}
              className="w-full min-h-[200px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-3 text-sm font-mono focus:border-blue-500 focus:ring-2 focus:ring-blue-500/25"
            />
            {payloadMeta && (
              <div className="grid sm:grid-cols-3 gap-2 text-xs">
                <div className="flex flex-col gap-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950">
                  <span className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 font-semibold">
                    {t("decryptMetadata.payloadMeta.version", "Format Version")}
                  </span>
                  <span className="text-gray-800 dark:text-gray-100 font-medium">
                    {payloadMeta.version || "—"}
                  </span>
                </div>
                <div className="flex flex-col gap-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950">
                  <span className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 font-semibold">
                    Schema
                  </span>
                  <span className="text-gray-800 dark:text-gray-100 font-medium break-words">
                    {payloadMeta.schema || payloadMeta.aad || "—"}
                  </span>
                </div>
                <div className="flex flex-col gap-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950">
                  <span className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 font-semibold">
                    {t("decryptMetadata.payloadMeta.cipher", "Algorithm")}
                  </span>
                  <span className="text-gray-800 dark:text-gray-100 font-medium">
                    {payloadMeta.cipher || "—"}
                  </span>
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-red-800 text-sm flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleDecrypt}
              disabled={isDecrypting}
              className="inline-flex items-center gap-2 px-5 h-11 rounded-lg bg-blue-600 text-white text-sm font-medium shadow-sm hover:bg-blue-700 transition disabled:opacity-60"
            >
              {isDecrypting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
              {t("decryptMetadata.decrypt", "Decrypt and View")}
            </button>
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm p-5 min-h-[260px]">
            <div className="flex items-center gap-2 mb-3 text-sm font-semibold">
              <Eye className="w-4 h-4 text-green-500" />
              <span className="text-gray-900 dark:text-gray-100">
                {t("decryptMetadata.result", "Decryption Result")}
              </span>
            </div>
            {result ? (
              <pre className="text-xs text-gray-800 dark:text-gray-100 bg-gray-50 dark:bg-gray-950 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-words">
                {JSON.stringify(result, null, 2)}
              </pre>
            ) : (
              <p className="text-xs text-gray-600 dark:text-gray-400">
                {t(
                  "decryptMetadata.resultPlaceholder",
                  "Decrypted plaintext metadata will be displayed here",
                )}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
