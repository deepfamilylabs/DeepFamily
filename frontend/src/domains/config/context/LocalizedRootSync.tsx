import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { getLocalizedDefaultRoot, shouldAutoSwitchLocalizedRoot } from "../services";
import { useConfig } from "./ConfigContext";

function sameHash(a: string, b: string): boolean {
  return String(a || "").toLowerCase() === String(b || "").toLowerCase();
}

export function LocalizedRootSync() {
  const { i18n } = useTranslation();
  const { rootHash, rootVersionIndex, chainId, defaults, update } = useConfig();
  const lastAppliedRef = useRef<string | null>(null);

  const localizedRoot = useMemo(
    () =>
      getLocalizedDefaultRoot(i18n.language, {
        rootHash: defaults.rootHash,
        rootVersionIndex: defaults.rootVersionIndex,
      }),
    [i18n.language, defaults.rootHash, defaults.rootVersionIndex],
  );

  useEffect(() => {
    if (!localizedRoot.hash) return;
    // These roots name records on the chain the env's RPC points at, and only
    // there. Switching networks clears the root precisely because a person hash
    // does not travel between chains, so on any other chain an empty root is
    // waiting for the user to pick one — not a slot to refill from the build.
    if (defaults.chainId && chainId && chainId !== defaults.chainId) return;
    if (
      !shouldAutoSwitchLocalizedRoot({
        currentRootHash: rootHash,
        defaults: {
          rootHash: defaults.rootHash,
          rootVersionIndex: defaults.rootVersionIndex,
        },
      })
    ) {
      return;
    }

    const hashChanged = !sameHash(localizedRoot.hash, rootHash);
    const versionChanged = Number(localizedRoot.version) !== Number(rootVersionIndex);
    if (!hashChanged && !versionChanged) return;

    const applyKey = `${i18n.language}:${localizedRoot.hash.toLowerCase()}:${localizedRoot.version}`;
    if (lastAppliedRef.current === applyKey) return;
    lastAppliedRef.current = applyKey;

    update({
      rootHash: localizedRoot.hash,
      rootVersionIndex: localizedRoot.version,
    });
  }, [
    i18n.language,
    localizedRoot.hash,
    localizedRoot.version,
    rootHash,
    rootVersionIndex,
    chainId,
    defaults.chainId,
    defaults.rootHash,
    defaults.rootVersionIndex,
    update,
  ]);

  return null;
}
