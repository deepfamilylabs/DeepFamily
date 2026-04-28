import React from "react";
import { ConfigProvider } from "../domains/config";
import { ToastProvider } from "../shared/ui";
import { TreeViewProvider, VizOptionsProvider } from "../domains/tree";
import { WalletProvider, NetworkSelectionLayer, WalletSelectionLayer } from "../domains/wallet";
import { ActivePathProvider, SidebarProvider } from "./context";
import { ErrorBoundary } from "./error-boundary";

/**
 * Top-level provider stack.
 *
 * Assembled once at the application root; individual pages and domains
 * consume these via hooks rather than adding their own providers.
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <ConfigProvider>
        <ToastProvider>
          <WalletProvider>
            <SidebarProvider>
              <WalletSelectionLayer />
              <NetworkSelectionLayer />
              <VizOptionsProvider>
                <TreeViewProvider>{children}</TreeViewProvider>
              </VizOptionsProvider>
            </SidebarProvider>
          </WalletProvider>
        </ToastProvider>
      </ConfigProvider>
    </ErrorBoundary>
  );
}
