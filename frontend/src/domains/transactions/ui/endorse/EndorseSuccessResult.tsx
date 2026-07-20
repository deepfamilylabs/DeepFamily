import { Check, ChevronRight } from "lucide-react";
import { ResultDataRow } from "../shared/ResultDataRow";

type EndorseSuccessResultProps = {
  t: (key: string, fallback: string) => string;
  successResult: {
    personHash: string;
    versionIndex: number;
    transactionHash: string;
    blockNumber: number;
    events: { PersonVersionEndorsed: any };
  };
  deepTokenDecimals: number;
  deepTokenSymbol: string;
};

export function EndorseSuccessResult({
  t,
  successResult,
  deepTokenDecimals,
  deepTokenSymbol,
}: EndorseSuccessResultProps) {
  const event = successResult.events.PersonVersionEndorsed;
  if (!event) return null;

  const formatToken = (value: unknown) =>
    `${(Number(value) / Math.pow(10, deepTokenDecimals)).toLocaleString()} ${deepTokenSymbol}`;

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center gap-4 p-5 bg-linear-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-2xl border border-green-100 dark:border-green-800">
        <div className="w-12 h-12 rounded-full bg-green-500 shadow-lg shadow-green-500/20 flex items-center justify-center shrink-0">
          <Check className="w-6 h-6 text-white stroke-3" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-green-900 dark:text-green-100">
            {t("endorse.successTitle", "Endorsement Successful")}
          </h3>
          <p className="text-sm font-medium text-green-700 dark:text-green-300">
            {t("endorse.successDesc", "Version has been successfully endorsed")}
          </p>
        </div>
      </div>

      <details
        className="group bg-green-50/50 dark:bg-green-900/10 rounded-2xl border border-green-100 dark:border-green-800 overflow-hidden"
        open
      >
        <summary className="flex items-center justify-between p-4 cursor-pointer hover:bg-green-100/50 dark:hover:bg-green-900/20 transition-colors select-none">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 bg-green-500 rounded-full shadow-xs shadow-green-500/50"></div>
            <span className="text-sm font-bold text-green-900 dark:text-green-100">
              {t("endorse.endorsementDetails", "Endorsement Details")}
            </span>
            <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-800/50 px-2 py-0.5 rounded-full border border-green-200 dark:border-green-700/50">
              {formatToken(event.endorsementFee)}
            </span>
          </div>
          <ChevronRight className="w-5 h-5 text-green-500 group-open:rotate-90 transition-transform" />
        </summary>
        <div className="px-4 pb-4 space-y-4">
          <div className="space-y-2 p-3 bg-white/50 dark:bg-gray-900/50 rounded-xl border border-green-100/50 dark:border-green-800/30">
            <ResultDataRow
              label={t("endorse.personHash", "Person Hash")}
              value={successResult.personHash}
              colorClass="green"
            />
            <ResultDataRow
              label={t("endorse.versionIndex", "Version Index")}
              value={successResult.versionIndex.toString()}
              colorClass="green"
            />
            <ResultDataRow
              label={t("endorse.endorser", "Endorser")}
              value={event.endorser}
              colorClass="green"
            />
          </div>

          <div className="pt-2 border-t border-green-200/50 dark:border-green-700/50">
            <p className="text-xs font-bold text-green-800 dark:text-green-200 mb-3 uppercase tracking-wider opacity-80">
              {t("endorse.feeDistribution", "Fee Distribution")}
            </p>
            <div className="space-y-2">
              <ResultDataRow
                label={t("endorse.totalFee", "Total Fee")}
                value={formatToken(event.endorsementFee)}
                colorClass="green"
                isPlainText
              />
              {event.recipient && (
                <>
                  <ResultDataRow
                    label={t("endorse.recipient", "Recipient")}
                    value={event.recipient}
                    colorClass="green"
                  />
                  <ResultDataRow
                    label={t("endorse.recipientShare", "Recipient Share")}
                    value={formatToken(event.recipientShare)}
                    colorClass="green"
                    isPlainText
                  />
                </>
              )}
              {event.protocolRecipient && (
                <>
                  <ResultDataRow
                    label={t("endorse.protocolRecipient", "Protocol Recipient")}
                    value={event.protocolRecipient}
                    colorClass="green"
                  />
                  <ResultDataRow
                    label={t("endorse.protocolShare", "Protocol Share")}
                    value={formatToken(event.protocolShare)}
                    colorClass="green"
                    isPlainText
                  />
                </>
              )}
            </div>
          </div>

          <div className="pt-2 border-t border-green-200/50 dark:border-green-700/50">
            <p className="text-xs font-bold text-green-800 dark:text-green-200 mb-3 uppercase tracking-wider opacity-80">
              {t("endorse.transactionInfo", "Transaction Info")}
            </p>
            <div className="space-y-2">
              <ResultDataRow
                label={t("endorse.transactionHash", "Transaction Hash")}
                value={successResult.transactionHash}
                colorClass="green"
              />
              <ResultDataRow
                label={t("endorse.blockNumber", "Block Number")}
                value={successResult.blockNumber.toString()}
                colorClass="green"
              />
              <ResultDataRow
                label={t("endorse.timestamp", "Timestamp")}
                value={new Date(Number(event.timestamp) * 1000).toLocaleString()}
                colorClass="green"
                isPlainText
              />
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}
