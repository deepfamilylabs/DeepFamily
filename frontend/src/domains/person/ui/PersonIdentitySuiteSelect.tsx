import { DEFAULT_IDENTITY_SUITE_ID, SUPPORTED_IDENTITY_SUITE_IDS } from "@deepfamily/protocol-core";
import { useTranslation } from "react-i18next";
import { shortHash } from "../../../shared/model/personVersionMeta";
import { ThemedSelect } from "../../../shared/ui/ThemedSelect";
import type { PersonIdentityCandidate } from "../../../shared/workers/cryptoWorkerClient";

export type PersonIdentityRole = "person" | "father" | "mother";

type PersonIdentitySuiteSelectProps = {
  role: PersonIdentityRole;
  suite: number;
  candidates?: PersonIdentityCandidate[];
  onChange: (suite: number) => void;
};

export function PersonIdentitySuiteSelect({ role, suite, candidates, onChange }: PersonIdentitySuiteSelectProps) {
  const { t } = useTranslation();
  const hasOldRecord = candidates?.some(
    candidate =>
      candidate.identitySuiteId !== DEFAULT_IDENTITY_SUITE_ID &&
      candidate.history !== "none" &&
      candidate.history !== "unavailable",
  );
  const options = SUPPORTED_IDENTITY_SUITE_IDS.map(value => {
    const candidate = candidates?.find(item => item.identitySuiteId === value);
    const label = t(
      value === DEFAULT_IDENTITY_SUITE_ID ? "addVersion.defaultProtocol" : "addVersion.identityProtocol",
      { suite: value },
    );
    if (!candidate) return { value, label };
    if (candidate.history === "unavailable") return { value, label, meta: shortHash(candidate.personHash) };

    const action = candidate.history === "referenced"
      ? t("addVersion.previouslyReferenced")
      : t(`addVersion.protocolAction.${role}.${candidate.history === "registered" ? "existing" : "new"}`);
    return { value, label, meta: `${action} · ${shortHash(candidate.personHash)}` };
  });
  return (
    <ThemedSelect
      size="inline"
      className="ml-auto"
      value={suite}
      options={options}
      triggerLabel={t(hasOldRecord ? "addVersion.protocolWithHistory" : "addVersion.identityProtocol", { suite })}
      onChange={onChange}
    />
  );
}
