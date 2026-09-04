import { Check, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRpcNetworkMenu } from "./hooks/useRpcNetworkMenu";
import { CustomNetworkForm } from "./sections";
import type { NetworkOption } from "../model";

export interface RpcNetworkListProps {
  /** Run once a network has actually been picked, so the host can close itself. */
  onPicked?: () => void;
}

const ROW_BASE =
  "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary";

/**
 * The networks the app can read from, as one selectable list.
 *
 * Two hosts render it: the desktop status bar, under the chip that reports the
 * RPC's liveness, and the mobile sidebar drawer, where the status bar does not
 * exist. Neither owns the semantics — the config domain does — so this holds
 * the rows and the custom-network form, and the host supplies only its chrome.
 *
 * Whether the reader and the root exist on the chain in use is the status bar
 * chip's to report; a list of networks is for picking one.
 */
export default function RpcNetworkList({ onPicked }: RpcNetworkListProps) {
  const { t } = useTranslation();
  const { presets, custom, selected, chainId, rpcUrl, select, addForm } = useRpcNetworkMenu();

  const handleSelect = (id: number) => {
    select(id);
    onPicked?.();
  };

  const renderRow = (network: NetworkOption, key: string) => {
    const active = selected === network.chainId;
    return (
      <button
        key={key}
        type="button"
        role="radio"
        aria-checked={active}
        onClick={() => handleSelect(network.chainId)}
        className={`${ROW_BASE} ${
          active ? "bg-primary/10 text-ink" : "text-ink-muted hover:bg-surface-muted hover:text-ink"
        }`}
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={`truncate text-xs ${active ? "font-semibold" : "font-medium"}`}>
              {network.name}
            </span>
            <span className="shrink-0 font-mono text-[10px] text-ink-subtle">
              {network.chainId}
            </span>
          </span>
          <span className="mt-0.5 block truncate font-mono text-[10px] text-ink-subtle">
            {network.rpcUrl}
          </span>
        </span>
        {active ? (
          <Check className="h-3.5 w-3.5 shrink-0 text-orange-700 dark:text-orange-300" />
        ) : null}
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-1">
      <div role="radiogroup" aria-label={t("statusBar.rpcNetwork", "RPC network")}>
        {/* A saved RPC matching nothing in the lists — an environment default,
            usually — still has to say what the app is talking to. */}
        {selected === "custom" ? (
          <div className={`${ROW_BASE} bg-primary/10 text-ink`}>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className="truncate text-xs font-semibold">
                  {t("familyTree.config.customNetwork", "Custom network")}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-ink-subtle">
                  {chainId || t("common.na", "N/A")}
                </span>
              </span>
              <span className="mt-0.5 block truncate font-mono text-[10px] text-ink-subtle">
                {rpcUrl}
              </span>
            </span>
            <Check className="h-3.5 w-3.5 shrink-0 text-orange-700 dark:text-orange-300" />
          </div>
        ) : null}

        {presets.map((network) => renderRow(network, String(network.chainId)))}

        {custom.length > 0 ? (
          <>
            <div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">
              {t("familyTree.config.customNetworks", "Custom")}
            </div>
            {custom.map((network) => renderRow(network, `custom-${network.chainId}`))}
          </>
        ) : null}
      </div>

      <div className="my-1 h-px bg-hairline" aria-hidden />

      <button
        type="button"
        onClick={addForm.toggle}
        aria-expanded={addForm.isOpen}
        className={`${ROW_BASE} text-ink-muted hover:bg-surface-muted hover:text-ink`}
      >
        <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="text-xs font-medium">
          {t("familyTree.config.customNetwork", "Custom network")}
        </span>
      </button>

      {addForm.isOpen ? (
        <CustomNetworkForm
          name={addForm.name}
          chainId={addForm.chainId}
          rpc={addForm.rpc}
          reader={addForm.reader}
          error={addForm.error}
          showCspHint={addForm.showCspHint}
          setName={addForm.setName}
          setChainId={addForm.setChainId}
          setRpc={addForm.setRpc}
          setReader={addForm.setReader}
          submit={addForm.submit}
        />
      ) : null}
    </div>
  );
}
