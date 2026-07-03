import { Icon } from "@iconify/react";
import { QRCodeSVG } from "qrcode.react";

import { getAccountDetailLine, getAccountPrimaryLabel, getAccountStatusDetail, isPendingAccountId } from "../domain/accounts";
import type { WhatsAppAccount } from "../domain/models";
import { EmptyState, IconButton } from "./shared";

export function NumberChooserPanel({
  accounts,
  allAccountCount,
  connectedAccounts,
  onClose,
  onOpenAccount,
  search,
  selectedAccountId,
  setSearch,
}: {
  accounts: WhatsAppAccount[];
  allAccountCount: number;
  connectedAccounts: number;
  onClose: () => void;
  onOpenAccount: (accountId: string) => void;
  search: string;
  selectedAccountId: string;
  setSearch: (value: string) => void;
}) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="number-panel" role="dialog" aria-modal="true" aria-labelledby="number-panel-title">
        <div className="dialog-header">
          <div>
            <span className="panel-kicker">Numbers</span>
            <h3 id="number-panel-title">Open a managed number</h3>
            <p className="dialog-subtitle">{connectedAccounts}/{allAccountCount} online</p>
          </div>
          <IconButton icon="mdi:close" label="Close numbers panel" variant="text" onClick={onClose} />
        </div>

        <div className="number-panel-body">
          <label className="field number-panel-search">
            <span className="visually-hidden">Search</span>
            <Icon icon="mdi:magnify" aria-hidden="true" />
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Find number"
            />
          </label>

          <div className="number-choice-list">
            {accounts.length === 0 ? (
              <EmptyState
                title={allAccountCount === 0 ? "No numbers" : "No matches"}
                description={allAccountCount === 0 ? "Use Link to pair a WhatsApp number." : "Adjust the search."}
              />
            ) : (
              accounts.map((account) => (
                <button
                  key={account.accountId}
                  className={`number-choice${account.accountId === selectedAccountId ? " number-choice-active" : ""}`}
                  onClick={() => onOpenAccount(account.accountId)}
                  title={getAccountStatusDetail(account)}
                >
                  <span className={`status-dot status-dot-${account.status}`} />
                  <span>
                    <strong>{getAccountPrimaryLabel(account)}</strong>
                    <small>{getAccountDetailLine(account)}</small>
                  </span>
                  <span className={`badge badge-${account.status}`}>{account.status}</span>
                </button>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

export function LinkAccountDialog({
  account,
  isBusy,
  onClose,
}: {
  account: WhatsAppAccount | null;
  isBusy: boolean;
  onClose: () => void;
}) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="link-dialog" role="dialog" aria-modal="true" aria-labelledby="link-dialog-title">
        <div className="dialog-header">
          <div>
            <span className="panel-kicker">Link account</span>
            <h3 id="link-dialog-title">{account?.qrCode ? "Scan QR code" : "Preparing link"}</h3>
            {account && !isPendingAccountId(account.accountId) ? (
              <p className="dialog-subtitle">{account.accountId}</p>
            ) : null}
          </div>
          <IconButton icon="mdi:close" label="Close link dialog" variant="text" onClick={onClose} />
        </div>

        <div className="dialog-body">
          {account?.qrCode ? (
            <div className="dialog-qr-only">
              <div className="qr-panel qr-panel-large" aria-label="WhatsApp pairing QR">
                <QRCodeSVG value={account.qrCode} size={264} marginSize={2} />
              </div>
              <p>Scan from WhatsApp linked devices.</p>
            </div>
          ) : (
            <div className="dialog-qr-only">
              <EmptyState
                title={isBusy ? "Requesting QR" : "Waiting for QR"}
                description="The pairing code will appear here when WhatsApp returns it."
              />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
