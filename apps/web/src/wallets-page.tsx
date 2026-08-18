import type { CustodyWallet } from "@lpbot/api-contract";
import * as Dialog from "@radix-ui/react-dialog";
import {
  CircleAlert,
  Download,
  KeyRound,
  LoaderCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
  WalletCards,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { WalletClient, WalletRequestError } from "./wallet-client";

type WalletPageStatus =
  | "duplicate"
  | "empty"
  | "error"
  | "generate-pending"
  | "import-validating"
  | "loading"
  | "reauth-required"
  | "ready"
  | "signer-unavailable";

const scalarOrder = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");

function validPrivateKey(value: string): boolean {
  if (!/^(?:0x)?[0-9a-fA-F]{64}$/u.test(value)) return false;
  const scalar = BigInt(`0x${value.startsWith("0x") ? value.slice(2) : value}`);
  return scalar > 0n && scalar < scalarOrder;
}

function stateForError(error: unknown): WalletPageStatus {
  if (!(error instanceof WalletRequestError)) return "error";
  if (error.code === "WALLET_ADDRESS_EXISTS") return "duplicate";
  if (error.code === "REAUTH_REQUIRED") return "reauth-required";
  if (error.code === "SIGNER_UNAVAILABLE") return "signer-unavailable";
  return "error";
}

const errorLabels: Partial<Record<WalletPageStatus, string>> = {
  duplicate: "该地址已由当前账户托管",
  error: "钱包请求失败",
  "reauth-required": "需要重新验证身份",
  "signer-unavailable": "签名服务暂时不可用",
};

function WalletState({ status }: { status: WalletPageStatus }) {
  const label = errorLabels[status];
  if (!label) return null;
  return (
    <div className="wallet-page-state wallet-page-error" data-state={status} role="alert">
      <CircleAlert aria-hidden="true" size={19} />
      <p>{label}</p>
    </div>
  );
}

function WalletRecord({ wallet }: { wallet: CustodyWallet }) {
  const custodyLabel =
    wallet.lockStatus === "ready" ? "已托管" : wallet.lockStatus === "locked" ? "已锁定" : "已隔离";
  return (
    <li className="wallet-record">
      <div className="wallet-record-icon" aria-hidden="true">
        <WalletCards size={20} />
      </div>
      <div className="wallet-record-identity">
        <strong>{wallet.name}</strong>
        <code>{wallet.address}</code>
      </div>
      <div className="wallet-record-facts">
        <span className="wallet-mode-badge">
          <KeyRound aria-hidden="true" size={13} />
          服务器密钥
        </span>
        <span className="wallet-custody-badge" data-status={wallet.lockStatus}>
          <ShieldCheck aria-hidden="true" size={13} />
          {custodyLabel}
        </span>
      </div>
    </li>
  );
}

function ImportWalletDialog({
  client,
  onCreated,
  onFailure,
  onPending,
  open,
  setOpen,
  trigger,
}: {
  client: WalletClient;
  onCreated(wallet: CustodyWallet): void;
  onFailure(error: unknown): void;
  onPending(): void;
  open: boolean;
  setOpen(open: boolean): void;
  trigger: React.RefObject<HTMLButtonElement | null>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setPrivateKey("");
    setName("");
    setError(null);
    setSubmitting(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const secret = privateKey;
    setPrivateKey("");
    setError(null);
    onPending();
    if (!validPrivateKey(secret)) {
      setError("私钥格式无效");
      setSubmitting(false);
      onFailure(new WalletRequestError("INVALID_PRIVATE_KEY", false, 400));
      return;
    }
    setSubmitting(true);
    try {
      const wallet = await client.importWallet({
        mode: "server-kek",
        name: name.trim() || "Imported wallet",
        privateKey: secret,
      });
      reset();
      setOpen(false);
      onCreated(wallet);
    } catch (requestError) {
      setError(
        requestError instanceof WalletRequestError && requestError.code === "WALLET_ADDRESS_EXISTS"
          ? "该地址已由当前账户托管"
          : requestError instanceof WalletRequestError && requestError.code === "REAUTH_REQUIRED"
            ? "需要重新验证身份"
            : requestError instanceof WalletRequestError &&
                requestError.code === "SIGNER_UNAVAILABLE"
              ? "签名服务暂时不可用"
              : "导入失败",
      );
      setSubmitting(false);
      onFailure(requestError);
    }
  };

  return (
    <Dialog.Root
      onOpenChange={(next) => {
        if (!next) reset();
        setOpen(next);
      }}
      open={open}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          aria-describedby={undefined}
          className="wallet-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          <div className="wallet-dialog-heading">
            <Dialog.Title>导入钱包</Dialog.Title>
            <Dialog.Close asChild>
              <button
                aria-label="关闭导入钱包"
                className="icon-button tooltip-control"
                data-tooltip="关闭"
                type="button"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </Dialog.Close>
          </div>
          <form className="wallet-form" onSubmit={(event) => void submit(event)}>
            <label htmlFor="wallet-import-name">
              <span>钱包名称</span>
              <input
                autoComplete="off"
                id="wallet-import-name"
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                value={name}
              />
            </label>
            <label htmlFor="wallet-import-secret">
              <span>私钥</span>
              <input
                autoCapitalize="none"
                autoComplete="new-password"
                id="wallet-import-secret"
                onChange={(event) => setPrivateKey(event.target.value)}
                spellCheck={false}
                type="password"
                value={privateKey}
              />
            </label>
            {error ? <p role="alert">{error}</p> : null}
            <div className="wallet-dialog-actions">
              <Dialog.Close asChild>
                <button className="secondary-button" disabled={submitting} type="button">
                  取消
                </button>
              </Dialog.Close>
              <button className="primary-button" disabled={submitting} type="submit">
                {submitting ? (
                  <LoaderCircle aria-hidden="true" className="spin-icon" size={16} />
                ) : (
                  <Download aria-hidden="true" size={16} />
                )}
                确认导入
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function GenerateWalletDialog({
  client,
  onCreated,
  onFailure,
  onPending,
  open,
  setOpen,
  trigger,
}: {
  client: WalletClient;
  onCreated(wallet: CustodyWallet): void;
  onFailure(error: unknown): void;
  onPending(): void;
  open: boolean;
  setOpen(open: boolean): void;
  trigger: React.RefObject<HTMLButtonElement | null>;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    onPending();
    try {
      const wallet = await client.generateWallet({
        mode: "server-kek",
        name: name.trim() || "Generated wallet",
      });
      setName("");
      setSubmitting(false);
      setOpen(false);
      onCreated(wallet);
    } catch (requestError) {
      setError(
        requestError instanceof WalletRequestError && requestError.code === "REAUTH_REQUIRED"
          ? "需要重新验证身份"
          : requestError instanceof WalletRequestError && requestError.code === "SIGNER_UNAVAILABLE"
            ? "签名服务暂时不可用"
            : "生成失败",
      );
      setSubmitting(false);
      onFailure(requestError);
    }
  };

  return (
    <Dialog.Root
      onOpenChange={(next) => {
        if (!next) {
          setName("");
          setError(null);
          setSubmitting(false);
        }
        setOpen(next);
      }}
      open={open}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          aria-describedby={undefined}
          className="wallet-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          <div className="wallet-dialog-heading">
            <Dialog.Title>生成钱包</Dialog.Title>
            <Dialog.Close asChild>
              <button
                aria-label="关闭生成钱包"
                className="icon-button tooltip-control"
                data-tooltip="关闭"
                type="button"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </Dialog.Close>
          </div>
          <form className="wallet-form" onSubmit={(event) => void submit(event)}>
            <label htmlFor="wallet-generate-name">
              <span>钱包名称</span>
              <input
                autoComplete="off"
                id="wallet-generate-name"
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                value={name}
              />
            </label>
            <div className="wallet-mode-field">
              <span>加密模式</span>
              <strong>
                <KeyRound aria-hidden="true" size={15} />
                服务器密钥
              </strong>
            </div>
            {error ? <p role="alert">{error}</p> : null}
            <div className="wallet-dialog-actions">
              <Dialog.Close asChild>
                <button className="secondary-button" disabled={submitting} type="button">
                  取消
                </button>
              </Dialog.Close>
              <button className="primary-button" disabled={submitting} type="submit">
                {submitting ? (
                  <LoaderCircle aria-hidden="true" className="spin-icon" size={16} />
                ) : (
                  <Plus aria-hidden="true" size={16} />
                )}
                确认生成
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function WalletsPage() {
  const client = useMemo(() => new WalletClient(), []);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [status, setStatus] = useState<WalletPageStatus>("loading");
  const [wallets, setWallets] = useState<CustodyWallet[]>([]);
  const generateTrigger = useRef<HTMLButtonElement>(null);
  const importTrigger = useRef<HTMLButtonElement>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const page = await client.list(signal);
        setWallets(page.items);
        setStatus(page.items.length === 0 ? "empty" : "ready");
      } catch (error) {
        if (signal?.aborted) return;
        setStatus(stateForError(error));
      }
    },
    [client],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const created = (wallet: CustodyWallet) => {
    setWallets((current) => [
      wallet,
      ...current.filter(({ walletId }) => walletId !== wallet.walletId),
    ]);
    setStatus("ready");
  };

  return (
    <main className="workspace wallets-workspace" data-state={status}>
      <div className="wallets-heading">
        <div>
          <p className="eyebrow">Custody</p>
          <h1>钱包</h1>
        </div>
        <div className="wallets-actions">
          <button
            aria-label="刷新钱包"
            className="icon-button tooltip-control"
            data-tooltip="刷新"
            disabled={status === "loading"}
            onClick={() => {
              setStatus("loading");
              void load();
            }}
            type="button"
          >
            <RefreshCw
              aria-hidden="true"
              className={status === "loading" ? "spin-icon" : undefined}
              size={18}
            />
          </button>
          <button
            className="secondary-button"
            onClick={() => setImportOpen(true)}
            ref={importTrigger}
            type="button"
          >
            <Download aria-hidden="true" size={16} />
            导入钱包
          </button>
          <button
            className="primary-button"
            onClick={() => setGenerateOpen(true)}
            ref={generateTrigger}
            type="button"
          >
            <Plus aria-hidden="true" size={16} />
            生成钱包
          </button>
        </div>
      </div>

      {status === "loading" ? (
        <div aria-label="正在加载钱包" className="wallet-page-state" role="status">
          <span aria-hidden="true" className="spinner spinner-small" />
          <p>正在加载钱包</p>
        </div>
      ) : null}
      {status === "empty" ? (
        <div className="wallet-page-state" role="status">
          <WalletCards aria-hidden="true" size={22} />
          <p>还没有托管钱包</p>
        </div>
      ) : null}
      {!importOpen && !generateOpen ? <WalletState status={status} /> : null}
      {wallets.length > 0 ? (
        <ul aria-label="托管钱包" className="wallet-list">
          {wallets.map((wallet) => (
            <WalletRecord key={wallet.walletId} wallet={wallet} />
          ))}
        </ul>
      ) : null}

      <ImportWalletDialog
        client={client}
        onCreated={created}
        onFailure={(error) => setStatus(stateForError(error))}
        onPending={() => setStatus("import-validating")}
        open={importOpen}
        setOpen={setImportOpen}
        trigger={importTrigger}
      />
      <GenerateWalletDialog
        client={client}
        onCreated={created}
        onFailure={(error) => setStatus(stateForError(error))}
        onPending={() => setStatus("generate-pending")}
        open={generateOpen}
        setOpen={setGenerateOpen}
        trigger={generateTrigger}
      />
    </main>
  );
}
