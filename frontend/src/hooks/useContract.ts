import { useMemo, useCallback } from "react";
import { ethers } from "ethers";
import { useWallet } from "../context/WalletContext";
import { useConfig } from "../context/ConfigContext";
import { useToast } from "../components/ToastProvider";
import { useTranslation } from "react-i18next";
import DeepFamily from "../abi/DeepFamily.json";
import {
  extractRevertReason,
  formatErrorSummaryForDev,
  getFriendlyError,
  sanitizeErrorForLogging,
} from "../lib/errors";
import { wrapIdentityCommitmentAsPersonHash } from "../lib/zk";
import type { ProofEnvelope } from "../lib/zk";

export type AddPersonVersionResult = {
  hash: string;
  index: number;
  rewardAmount: number;
  transactionHash: string;
  blockNumber: number;
  events: {
    PersonHashZKVerified: {
      personHash: string;
      prover: string;
    } | null;
    PersonVersionAdded: {
      personHash: string;
      versionIndex: number;
      addedBy: string;
      timestamp: number;
      fatherHash: string;
      fatherVersionIndex: number;
      motherHash: string;
      motherVersionIndex: number;
      tag: string;
    } | null;
    TokenRewardDistributed: {
      miner: string;
      personHash: string;
      versionIndex: number;
      reward: string;
    } | null;
  };
};

export type PersonProofPublicSignals = {
  identityCommitment: bigint;
  fatherIdentityCommitment: bigint;
  motherIdentityCommitment: bigint;
  submitter: bigint;
  schemaVersion: number;
  cryptoSuiteVersion: number;
  hashAlgoId: number;
};

export type DisclosureBindingPublicSignals = {
  identityCommitment: bigint;
  disclosureBinding: bigint;
  minter: bigint;
  schemaVersion: number;
  cryptoSuiteVersion: number;
  hashAlgoId: number;
};

export function useContract() {
  const isDev = import.meta.env.DEV;
  const { signer, provider } = useWallet();
  const { contractAddress } = useConfig();
  const toast = useToast();
  const { t } = useTranslation();

  const contract = useMemo(() => {
    if (!contractAddress) return null;

    if (signer) {
      return new ethers.Contract(contractAddress, DeepFamily.abi, signer);
    } else if (provider) {
      return new ethers.Contract(contractAddress, DeepFamily.abi, provider);
    }

    return null;
  }, [contractAddress, signer, provider]);
  const abiCoder = useMemo(() => ethers.AbiCoder.defaultAbiCoder(), []);
  const eventInterface = useMemo(() => new ethers.Interface(DeepFamily.abi), []);

  const executeTransaction = useCallback(
    async (
      contractMethod: () => Promise<any>,
      options: {
        onSuccess?: (result: any) => void;
        onError?: (error: any) => void;
        successMessage?: string;
        errorMessage?: string;
        suppressSubmittedToast?: boolean;
        suppressSuccessToast?: boolean;
        suppressErrorToast?: boolean;
      } = {},
    ) => {
      if (!contract || !signer) {
        toast.show(t("wallet.notConnected", "Please connect your wallet"));
        return null;
      }

      try {
        if (signer && signer.provider) {
          try {
            await signer.provider.getNetwork();
          } catch (walletStateError) {
            console.warn("Failed to get wallet state:", sanitizeErrorForLogging(walletStateError));
            if (isDev) {
              console.debug(
                `[useContract] wallet state error detail\n${formatErrorSummaryForDev(walletStateError)}`,
              );
            }
          }
        }

        await new Promise((resolve) => setTimeout(resolve, 100));

        const tx = await contractMethod();

        if (!options.suppressSubmittedToast) {
          toast.show(t("transaction.submitted", "Transaction submitted..."));
        }

        const receipt = await tx.wait();

        const successMsg =
          options.successMessage || t("transaction.success", "Transaction successful");
        if (!options.suppressSuccessToast) {
          toast.show(successMsg);
        }

        options.onSuccess?.(receipt);
        return receipt;
      } catch (error: any) {
        console.error("Transaction failed:", sanitizeErrorForLogging(error));
        if (isDev) {
          console.debug(
            `[useContract] executeTransaction error detail\n${formatErrorSummaryForDev(error)}`,
          );
        }

        const friendly = getFriendlyError(error, t);
        const errorMsg = options.errorMessage
          ? `${options.errorMessage}: ${friendly.message}`
          : friendly.message;

        if (!options.suppressErrorToast) {
          toast.show(errorMsg);
        }

        const enhancedError = {
          ...error,
          parsedMessage: errorMsg,
          customError: friendly.type,
          errorName: friendly.type,
          type: friendly.type,
          details: friendly.details,
          reason: friendly.reason,
          humanMessage: friendly.message,
        };

        options.onError?.(enhancedError);
        throw enhancedError;
      }
    },
    [contract, signer, toast, t, isDev],
  );

  /**
   * Add a person version using ZK proof (ProofEnvelope + struct-based parameters)
   */
  const addPersonVersion = useCallback(
    async (
      proof: ProofEnvelope,
      publicSignals: PersonProofPublicSignals,
      fatherVersionIndex: number,
      motherVersionIndex: number,
      tag: string,
      metadataCID: string,
    ): Promise<AddPersonVersionResult | null> => {
      if (!contract || !signer) {
        toast.show(t("wallet.notConnected", "Please connect your wallet"));
        return null;
      }

      const addPersonArgs = [
        proof,
        publicSignals,
        fatherVersionIndex,
        motherVersionIndex,
        tag,
        metadataCID,
      ] as const;

      try {
        const expectedPersonHash = wrapIdentityCommitmentAsPersonHash(publicSignals.identityCommitment);
        const expectedFatherHash =
          publicSignals.fatherIdentityCommitment === 0n
            ? ethers.ZeroHash
            : wrapIdentityCommitmentAsPersonHash(publicSignals.fatherIdentityCommitment);
        const expectedMotherHash =
          publicSignals.motherIdentityCommitment === 0n
            ? ethers.ZeroHash
            : wrapIdentityCommitmentAsPersonHash(publicSignals.motherIdentityCommitment);
        const versionHash = ethers.keccak256(
          abiCoder.encode(
            ["bytes32", "bytes32", "bytes32", "uint256", "uint256", "string"],
            [
              expectedPersonHash,
              expectedFatherHash,
              expectedMotherHash,
              fatherVersionIndex,
              motherVersionIndex,
              tag,
            ],
          ),
        );

        try {
          const versionExistsFn = (contract as any).versionExists;
          if (typeof versionExistsFn === "function") {
            const exists = await versionExistsFn(expectedPersonHash, versionHash);
            if (exists) {
              const duplicateError = new Error("DuplicateVersion");
              (duplicateError as any).reason = "DuplicateVersion";
              (duplicateError as any).__dfDecodedReason = "DuplicateVersion";
              throw duplicateError;
            }
          }
        } catch (preflightError: any) {
          if ((preflightError as any)?.reason === "DuplicateVersion") {
            throw preflightError;
          }
          if (isDev) {
            console.debug(
              `[useContract] addPersonVersion duplicate preflight error detail\n${formatErrorSummaryForDev(
                preflightError,
              )}`,
            );
          }
        }

        let gasLimit: bigint | undefined;

        try {
          const gasEstimate = await contract.addPersonVersion.estimateGas(...addPersonArgs);
          gasLimit = (gasEstimate * 120n) / 100n;
        } catch (estimateError: any) {
          console.warn(
            "Gas estimation failed, attempting static call and fallback gas limit.",
            sanitizeErrorForLogging(estimateError),
          );
          if (isDev) {
            console.debug(
              `[useContract] addPersonVersion estimateGas error detail\n${formatErrorSummaryForDev(
                estimateError,
              )}`,
            );
          }
          const decodedReason = extractRevertReason(contract, estimateError);
          if (decodedReason) {
            (estimateError as any).__dfDecodedReason = decodedReason;
          }
          if (isDev) {
            console.debug(
              `[useContract] addPersonVersion estimateGas decodedReason: ${decodedReason ?? "null"}`,
            );
          }

          try {
            await contract.addPersonVersion.staticCall(...addPersonArgs);
            gasLimit = 6_500_000n;
          } catch (staticError: any) {
            if (isDev) {
              console.debug(
                `[useContract] addPersonVersion staticCall error detail\n${formatErrorSummaryForDev(
                  staticError,
                )}`,
              );
            }
            const staticReason = extractRevertReason(contract, staticError);
            if (staticReason) {
              (staticError as any).__dfDecodedReason = staticReason;
            }
            if (isDev) {
              console.debug(
                `[useContract] addPersonVersion staticCall decodedReason: ${staticReason ?? "null"}`,
              );
            }
            throw staticError;
          }
        }

        const tx = await contract.addPersonVersion(...addPersonArgs, gasLimit ? { gasLimit } : {});

        toast.show(t("transaction.submitted", "Transaction submitted..."));

        const receipt = await tx.wait();

        const events: AddPersonVersionResult["events"] = {
          PersonHashZKVerified: null,
          PersonVersionAdded: null,
          TokenRewardDistributed: null,
        };

        let personHash = "unknown";
        let versionIndex = 0;
        let rewardAmount = 0;

        const normalizedContractAddress = contractAddress?.toLowerCase();
        const parseReceiptLog = (log: any) => {
          if (!log || !Array.isArray(log.topics)) return null;
          if (
            normalizedContractAddress &&
            log.address &&
            log.address.toLowerCase() !== normalizedContractAddress
          )
            return null;
          if (log.fragment?.name && log.args) {
            return { name: log.fragment.name, args: log.args };
          }
          try {
            return eventInterface.parseLog(log);
          } catch {
            return null;
          }
        };

        for (const log of receipt.logs) {
          const parsedEvent = parseReceiptLog(log);
          if (!parsedEvent) continue;

          switch (parsedEvent.name) {
            case "PersonHashZKVerified":
              events.PersonHashZKVerified = {
                personHash: parsedEvent.args.personHash,
                prover: parsedEvent.args.prover,
              };
              break;

            case "PersonVersionAdded":
              personHash = parsedEvent.args.personHash;
              versionIndex = Number(parsedEvent.args.versionIndex);
              events.PersonVersionAdded = {
                personHash,
                versionIndex,
                addedBy: parsedEvent.args.addedBy,
                timestamp: Number(parsedEvent.args.timestamp),
                fatherHash: parsedEvent.args.fatherHash,
                fatherVersionIndex: Number(parsedEvent.args.fatherVersionIndex),
                motherHash: parsedEvent.args.motherHash,
                motherVersionIndex: Number(parsedEvent.args.motherVersionIndex),
                tag: parsedEvent.args.tag,
              };
              break;

            case "TokenRewardDistributed":
              events.TokenRewardDistributed = {
                miner: parsedEvent.args.miner,
                personHash: parsedEvent.args.personHash,
                versionIndex: Number(parsedEvent.args.versionIndex),
                reward: parsedEvent.args.reward.toString(),
              };
              rewardAmount = Number(parsedEvent.args.reward) / Math.pow(10, 18);
              break;
          }
        }

        toast.show(t("contract.addVersionSuccess", "Person version added successfully"));

        return {
          hash: personHash,
          index: versionIndex,
          rewardAmount,
          transactionHash: tx.hash,
          blockNumber: receipt.blockNumber,
          events,
        };
      } catch (contractError: any) {
        console.error("Contract call failed:", sanitizeErrorForLogging(contractError));
        if (isDev) {
          console.debug(
            `[useContract] addPersonVersion contract error detail\n${formatErrorSummaryForDev(
              contractError,
            )}`,
          );
        }

        const friendly = getFriendlyError(contractError, t);
        if (isDev) {
          console.debug(
            `[useContract] addPersonVersion friendly error: ${JSON.stringify(
              {
                type: friendly.type,
                reason: friendly.reason ?? null,
                message: friendly.message,
                details: friendly.details,
              },
              null,
              2,
            )}`,
          );
        }

        toast.show(
          t("contract.addVersionFailed", "Failed to add person version") + ": " + friendly.message,
        );

        const enhancedError = new Error(friendly.message);
        (enhancedError as any).type = friendly.type;
        (enhancedError as any).details = friendly.details;
        (enhancedError as any).reason = friendly.reason;
        (enhancedError as any).humanMessage = friendly.message;

        throw enhancedError;
      }
    },
    [contract, signer, toast, t, contractAddress, eventInterface, isDev, abiCoder],
  );

  /**
   * Mint NFT using ZK proof
   */
  const mintPersonVersionNFT = useCallback(
    async (
      proof: ProofEnvelope,
      publicSignals: DisclosureBindingPublicSignals,
      versionIndex: number,
      tokenURI: string,
      coreInfo: {
        basicInfo: {
          identityCommitment: string;
          isBirthBC: boolean;
          birthYear: number;
          birthMonth: number;
          birthDay: number;
          gender: number;
        };
        supplementInfo: {
          fullName: string;
          birthPlace: string;
          isDeathBC: boolean;
          deathYear: number;
          deathMonth: number;
          deathDay: number;
          deathPlace: string;
          story: string;
        };
      },
      options?: {
        onSuccess?: (result: any) => void;
        onError?: (error: any) => void;
      },
    ) => {
      return executeTransaction(
        () =>
          contract!.mintPersonVersionNFT(
            proof,
            publicSignals,
            versionIndex,
            tokenURI,
            coreInfo,
          ),
        {
          successMessage: t("contract.mintSuccess", "NFT minted successfully"),
          errorMessage: t("contract.mintFailed", "Failed to mint NFT"),
          onSuccess: options?.onSuccess,
          onError: options?.onError,
        },
      );
    },
    [executeTransaction, t, contract],
  );

  const endorseVersion = useCallback(
    async (
      personHash: string,
      versionIndex: number,
      overrides?: any,
      txOptions?: { suppressToasts?: boolean },
    ) => {
      return executeTransaction(
        async () => {
          try {
            await contract!.DEEP_FAMILY_TOKEN_CONTRACT();
          } catch (connectivityError) {
            console.error(
              "Contract connectivity test failed:",
              sanitizeErrorForLogging(connectivityError),
            );
            throw new Error(
              `Contract connectivity issue: ${(connectivityError as any)?.message || connectivityError}`,
            );
          }

          if (overrides && Object.keys(overrides).length > 0) {
            try {
              await contract!.endorseVersion.estimateGas(personHash, versionIndex, overrides);
            } catch (gasError) {
              console.error("Gas estimation failed:", sanitizeErrorForLogging(gasError));
            }

            return await contract!.endorseVersion(personHash, versionIndex, overrides);
          } else {
            return await contract!.endorseVersion(personHash, versionIndex);
          }
        },
        {
          successMessage: t("contract.endorseSuccess", "Endorsement submitted successfully"),
          errorMessage: t("contract.endorseFailed", "Failed to endorse version"),
          suppressSubmittedToast: txOptions?.suppressToasts,
          suppressSuccessToast: txOptions?.suppressToasts,
          suppressErrorToast: txOptions?.suppressToasts,
        },
      );
    },
    [executeTransaction, t, contract],
  );

  const listPersonVersions = useCallback(
    async (personHash: string, offset: number, pageSize: number) => {
      if (!contract) return null;

      try {
        return await contract.listPersonVersions(personHash, offset, pageSize);
      } catch (error) {
        console.error("Failed to list person versions:", sanitizeErrorForLogging(error));
        return null;
      }
    },
    [contract, toast, t],
  );

  const getVersionDetails = useCallback(
    async (personHash: string, versionIndex: number) => {
      if (!contract) return null;

      try {
        return await contract.getVersionDetails(personHash, versionIndex);
      } catch (error) {
        console.error("Failed to get version details:", sanitizeErrorForLogging(error));
        return null;
      }
    },
    [contract, toast, t],
  );

  const getNFTDetails = useCallback(
    async (tokenId: number) => {
      if (!contract) return null;

      try {
        return await contract.getNFTDetails(tokenId);
      } catch (error) {
        console.error("Failed to get NFT details:", sanitizeErrorForLogging(error));
        return null;
      }
    },
    [contract, toast, t],
  );

  return {
    contract,
    isContractReady: !!contract && !!signer,
    executeTransaction,

    addPersonVersion,
    mintPersonVersionNFT,
    endorseVersion,

    listPersonVersions,
    getVersionDetails,
    getNFTDetails,
  };
}
