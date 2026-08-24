import { ethers } from "ethers";
import { AlertTriangle, Check, ChevronRight } from "lucide-react";
import { ResultDataRow } from "../shared/ResultDataRow";

type AddVersionSuccessResultProps = {
  t: (key: string, fallback: string) => string;
  successResult: {
    events: {
      PersonHashZKVerified?: any;
      PersonVersionAdded?: any;
      TokenRewardDistributed?: any;
    };
  };
};

export function AddVersionSuccessResult({ t, successResult }: AddVersionSuccessResultProps) {
  const zkEvent = successResult.events.PersonHashZKVerified;
  const versionEvent = successResult.events.PersonVersionAdded;
  const rewardEvent = successResult.events.TokenRewardDistributed;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 p-4 bg-linear-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-lg border border-green-200 dark:border-green-700">
        <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center shrink-0">
          <Check className="w-6 h-6 text-white" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-green-900 dark:text-green-100">
            {t("addVersion.successTitle", "Version Added Successfully")}
          </h3>
          <p className="text-sm text-green-700 dark:text-green-300">
            {t("addVersion.successDesc", "The person version has been added to the blockchain")}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {zkEvent && (
          <details className="group bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-700 overflow-hidden">
            <summary className="flex items-center justify-between p-3 cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-blue-600 rounded-full"></div>
                <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
                  {t("addVersion.zkProofVerified", "ZK Proof Verified")}
                </span>
              </div>
              <ChevronRight className="w-4 h-4 text-blue-600 group-open:rotate-90 transition-transform" />
            </summary>
            <div className="px-3 pb-3 space-y-2">
              <p className="text-xs text-blue-700 dark:text-blue-300 mb-2">
                {t(
                  "addVersion.zkProofVerifiedDesc",
                  "Zero-knowledge proof was successfully verified on-chain",
                )}
              </p>
              <ResultDataRow
                label={t("addVersion.hashPrefix", "Hash")}
                value={zkEvent.personHash}
                colorClass="blue"
              />
              <ResultDataRow
                label={t("addVersion.prover", "Prover")}
                value={zkEvent.prover}
                colorClass="blue"
              />
            </div>
          </details>
        )}

        {versionEvent && (
          <details
            className="group bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-700 overflow-hidden"
            open
          >
            <summary className="flex items-center justify-between p-3 cursor-pointer hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-green-600 rounded-full"></div>
                <span className="text-sm font-medium text-green-900 dark:text-green-100">
                  {t("addVersion.versionAdded", "Person Version Added")}
                </span>
              </div>
              <ChevronRight className="w-4 h-4 text-green-600 group-open:rotate-90 transition-transform" />
            </summary>
            <div className="px-3 pb-3 space-y-2">
              <p className="text-xs text-green-700 dark:text-green-300 mb-2">
                {t(
                  "addVersion.versionAddedDesc",
                  "Person version was successfully added to the family tree",
                )}
              </p>
              <ResultDataRow
                label={t("addVersion.hashPrefix", "Hash")}
                value={versionEvent.personHash}
                colorClass="green"
              />
              <ResultDataRow
                label={t("addVersion.versionIndex", "Version Index")}
                value={versionEvent.versionIndex.toString()}
                colorClass="green"
              />
              <ResultDataRow
                label={t("addVersion.addedBy", "Added By")}
                value={versionEvent.addedBy}
                colorClass="green"
              />
              <ResultDataRow
                label={t("addVersion.timestamp", "Timestamp")}
                value={new Date(versionEvent.timestamp * 1000).toLocaleString()}
                colorClass="green"
                isPlainText
              />

              {versionEvent.fatherHash && versionEvent.fatherHash !== ethers.ZeroHash && (
                <>
                  <ResultDataRow
                    label={t("addVersion.fatherHash", "Father Hash")}
                    value={versionEvent.fatherHash}
                    colorClass="green"
                  />
                  <ResultDataRow
                    label={t("addVersion.fatherVersionIndex", "Father Version")}
                    value={versionEvent.fatherVersionIndex.toString()}
                    colorClass="green"
                  />
                </>
              )}

              {versionEvent.motherHash && versionEvent.motherHash !== ethers.ZeroHash && (
                <>
                  <ResultDataRow
                    label={t("addVersion.motherHash", "Mother Hash")}
                    value={versionEvent.motherHash}
                    colorClass="green"
                  />
                  <ResultDataRow
                    label={t("addVersion.motherVersionIndex", "Mother Version")}
                    value={versionEvent.motherVersionIndex.toString()}
                    colorClass="green"
                  />
                </>
              )}
            </div>
          </details>
        )}

        {rewardEvent ? (
          <details className="group bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-700 overflow-hidden">
            <summary className="flex items-center justify-between p-3 cursor-pointer hover:bg-yellow-100 dark:hover:bg-yellow-900/30 transition-colors">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-yellow-600 rounded-full"></div>
                <span className="text-sm font-medium text-yellow-900 dark:text-yellow-100">
                  {t("addVersion.tokenReward", "Token Reward Distributed")}
                </span>
                <span className="ml-2 text-xs font-semibold text-yellow-700 dark:text-yellow-300 bg-yellow-100 dark:bg-yellow-800 px-2 py-0.5 rounded-full">
                  {(Number(rewardEvent.reward) / Math.pow(10, 18)).toLocaleString()} DEEP
                </span>
              </div>
              <ChevronRight className="w-4 h-4 text-yellow-600 group-open:rotate-90 transition-transform" />
            </summary>
            <div className="px-3 pb-3 space-y-2">
              <p className="text-xs text-yellow-700 dark:text-yellow-300 mb-2">
                {t(
                  "addVersion.familyComplete",
                  "First complete two-parent commitment submitted for this person hash — utility points distributed",
                )}
              </p>
              <ResultDataRow
                label={t("addVersion.miner", "Miner")}
                value={rewardEvent.miner}
                colorClass="yellow"
              />
              <ResultDataRow
                label={t("addVersion.hashPrefix", "Hash")}
                value={rewardEvent.personHash}
                colorClass="yellow"
              />
              <ResultDataRow
                label={t("addVersion.versionIndex", "Version Index")}
                value={rewardEvent.versionIndex.toString()}
                colorClass="yellow"
              />
              <ResultDataRow
                label={t("addVersion.rewardAmount", "Reward Amount")}
                value={`${(Number(rewardEvent.reward) / Math.pow(10, 18)).toLocaleString()} DEEP`}
                colorClass="yellow"
                isPlainText
              />
            </div>
          </details>
        ) : (
          <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-gray-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t("addVersion.noTokenReward", "No Token Reward")}
                </p>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  {t(
                    "addVersion.tokenRewardCondition",
                    "No utility points were distributed. Possible reasons include missing a parent commitment, a reward already claimed for this person hash, or unavailable issuance capacity. Parents do not need to exist on-chain first.",
                  )}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
