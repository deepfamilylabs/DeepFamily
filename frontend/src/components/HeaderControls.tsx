import { useState, useEffect, useRef } from "react";
import WalletConnectButton from "./WalletConnectButton";

interface HeaderControlsProps {
  variant?: "home" | "normal";
}

export default function HeaderControls({ variant = "home" }: HeaderControlsProps) {
  return (
    <div className="flex items-center gap-2 lg:gap-4 min-w-0">
      <WalletConnectButton showBalance={false} variant={variant} />
    </div>
  );
}
