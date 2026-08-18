import type {
  AddressBookCategory,
  AddressBookEntry,
  AddressBookPage,
  CustodyWallet,
  WalletBalanceSnapshot,
  WalletReceiveContent,
  WalletTokenPage,
} from "@lpbot/api-contract";
import {
  AddressBook,
  BookUser,
  Check,
  Clipboard,
  Coins,
  LoaderCircle,
  Pencil,
  Plus,
  QrCode,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import encodeQR from "qr";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { WalletReadClient, WalletReadRequestError } from "./wallet-read-client";

const chainId = 56;
const categoryLabels: Record<AddressBookCategory, string> = {
  exchange: "交易所",
  other: "其他",
  person: "联系人",
  protocol: "协议",
};

function requestError(error: unknown): string {
  if (!(error instanceof WalletReadRequestError)) return "请求失败";
  const labels: Record<string, string> = {
    ADDRESS_BOOK_DUPLICATE: "该外部地址已在地址簿中",
    ADDRESS_BOOK_REVISION_CONFLICT: "地址簿条目已变化，请刷新后重试",
    ADDRESS_IS_OWN_WALLET: "该地址属于自己的钱包",
    CHAIN_NOT_ALLOWED: "当前账户不可访问该链",
    CHAIN_READ_UNAVAILABLE: "链读取服务暂时不可用",
    DEFAULT_TOKEN_IMMUTABLE: "默认 Token 不可删除",
    INVALID_AMOUNT: "收款数量格式不正确",
    INVALID_CREDENTIALS: "安全密码不正确",
    LOCKED_OUT: "安全密码已暂时锁定",
    TOKEN_ALREADY_EXISTS: "该 Token 已导入",
    TOKEN_METADATA_CONFLICT: "Token metadata 与已存记录冲突",
    TOKEN_METADATA_INVALID: "ERC-20 metadata 响应无效",
    TOKEN_NOT_CONTRACT: "该地址不是合约",
  };
  return labels[error.code] ?? "请求失败";
}

function gifDataUrl(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8_192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8_192));
  }
  return `data:image/gif;base64,${btoa(binary)}`;
}

function ReceivePanel({
  client,
  tokens,
  wallet,
}: {
  client: WalletReadClient;
  tokens: WalletTokenPage | null;
  wallet: CustodyWallet;
}) {
  const [amount, setAmount] = useState("");
  const [asset, setAsset] = useState("native");
  const [content, setContent] = useState<WalletReceiveContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setContent(
        await client.receive(wallet.walletId, chainId, {
          ...(amount === "" ? {} : { amountDecimal: amount }),
          ...(asset === "native" ? {} : { tokenAddress: asset }),
        }),
      );
    } catch (requestFailure) {
      setError(requestError(requestFailure));
    } finally {
      setLoading(false);
    }
  }, [amount, asset, client, wallet.walletId]);

  useEffect(() => {
    setAmount("");
    setAsset("native");
    setContent(null);
    queueMicrotask(() => void generate());
  }, [wallet.walletId]); // eslint-disable-line react-hooks/exhaustive-deps

  const qrSource = useMemo(() => {
    if (!content) return null;
    return gifDataUrl(encodeQR(content.eip681, "gif", { border: 4, ecc: "medium", scale: 6 }));
  }, [content]);

  return (
    <section aria-labelledby="wallet-receive-title" className="wallet-read-section receive-section">
      <div className="wallet-read-heading">
        <div>
          <QrCode aria-hidden="true" size={18} />
          <h2 id="wallet-receive-title">收款</h2>
        </div>
      </div>
      <div className="receive-layout">
        <form
          className="wallet-read-form receive-form"
          onSubmit={(event) => {
            event.preventDefault();
            void generate();
          }}
        >
          <label>
            <span>资产</span>
            <select aria-label="收款资产" onChange={(event) => setAsset(event.target.value)} value={asset}>
              <option value="native">BNB</option>
              {tokens?.items.map((token) => (
                <option key={token.tokenAddress} value={token.tokenAddress}>
                  {token.symbol}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>数量</span>
            <input
              aria-label="收款数量"
              inputMode="decimal"
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.0"
              value={amount}
            />
          </label>
          <button className="secondary-button" disabled={loading} type="submit">
            {loading ? <LoaderCircle aria-hidden="true" className="spin-icon" size={16} /> : <QrCode aria-hidden="true" size={16} />}
            生成
          </button>
          {error ? <p role="alert">{error}</p> : null}
        </form>
        {content && qrSource ? (
          <div className="receive-result" data-testid="receive-content">
            <img alt={`收款二维码 ${wallet.name}`} height="184" src={qrSource} width="184" />
            <div>
              <strong>{wallet.name}</strong>
              <code>{content.address}</code>
              <code className="eip681-content">{content.eip681}</code>
              <button
                aria-label="复制收款内容"
                className="icon-button tooltip-control"
                data-tooltip={copied ? "已复制" : "复制"}
                onClick={() => {
                  void navigator.clipboard.writeText(content.eip681).then(() => setCopied(true));
                }}
                title="复制收款内容"
                type="button"
              >
                {copied ? <Check aria-hidden="true" size={16} /> : <Clipboard aria-hidden="true" size={16} />}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function AddressBookPanel({ client }: { client: WalletReadClient }) {
  const [page, setPage] = useState<AddressBookPage | null>(null);
  const [address, setAddress] = useState("");
  const [category, setCategory] = useState<AddressBookCategory>("person");
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"error" | "loading" | "ready" | "saving">("loading");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AddressBookEntry | null>(null);

  const load = useCallback(
    async (classify?: string, signal?: AbortSignal) => {
      setStatus("loading");
      setError(null);
      try {
        setPage(await client.addressBook(chainId, classify, signal));
        setStatus("ready");
      } catch (requestFailure) {
        if (signal?.aborted) return;
        setError(requestError(requestFailure));
        setStatus("error");
      }
    },
    [client],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(undefined, controller.signal);
    return () => controller.abort();
  }, [load]);

  const classify = async () => {
    if (!/^0x[0-9a-fA-F]{40}$/u.test(address)) return;
    await load(address);
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setStatus("saving");
    setError(null);
    try {
      await client.createAddressBookEntry({ address, category, chainId, label, note, password });
      setAddress("");
      setLabel("");
      setNote("");
      setPassword("");
      await load();
    } catch (requestFailure) {
      setPassword("");
      setError(requestError(requestFailure));
      setStatus("error");
    }
  };

  const classificationLabel =
    page?.classification?.kind === "own-wallet"
      ? "自己的钱包"
      : page?.classification?.kind === "known-external"
        ? "已知外部地址"
        : page?.classification?.kind === "new-external"
          ? "新外部地址"
          : null;

  return (
    <section aria-labelledby="address-book-title" className="wallet-read-section address-book-section">
      <div className="wallet-read-heading">
        <div>
          <BookUser aria-hidden="true" size={18} />
          <h2 id="address-book-title">地址簿</h2>
        </div>
        <button
          aria-label="刷新地址簿"
          className="icon-button tooltip-control"
          data-tooltip="刷新"
          disabled={status === "loading" || status === "saving"}
          onClick={() => void load()}
          title="刷新地址簿"
          type="button"
        >
          <RefreshCw aria-hidden="true" className={status === "loading" ? "spin-icon" : undefined} size={16} />
        </button>
      </div>
      <form className="wallet-read-form address-book-form" onSubmit={(event) => void create(event)}>
        <label className="address-book-address-field">
          <span>地址</span>
          <input
            aria-label="地址簿地址"
            autoComplete="off"
            onBlur={() => void classify()}
            onChange={(event) => {
              setAddress(event.target.value);
              if (page?.classification) setPage({ ...page, classification: null });
            }}
            placeholder="0x"
            spellCheck={false}
            value={address}
          />
        </label>
        <label>
          <span>名称</span>
          <input aria-label="地址簿名称" maxLength={80} onChange={(event) => setLabel(event.target.value)} value={label} />
        </label>
        <label>
          <span>分类</span>
          <select aria-label="地址簿分类" onChange={(event) => setCategory(event.target.value as AddressBookCategory)} value={category}>
            {Object.entries(categoryLabels).map(([value, text]) => (
              <option key={value} value={value}>{text}</option>
            ))}
          </select>
        </label>
        <label>
          <span>备注</span>
          <input aria-label="地址簿备注" maxLength={280} onChange={(event) => setNote(event.target.value)} value={note} />
        </label>
        <label>
          <span>安全密码</span>
          <input
            aria-label="新增地址安全密码"
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            value={password}
          />
        </label>
        <button
          className="secondary-button"
          disabled={status === "saving" || page?.classification?.kind !== "new-external" || label === "" || password === ""}
          type="submit"
        >
          {status === "saving" ? <LoaderCircle aria-hidden="true" className="spin-icon" size={16} /> : <Plus aria-hidden="true" size={16} />}
          添加
        </button>
        {classificationLabel ? <p className="address-classification" role="status">{classificationLabel}</p> : null}
        {error ? <p role="alert">{error}</p> : null}
      </form>

      <div className="address-directory">
        <div>
          <h3>自己的钱包</h3>
          <ul>
            {page?.ownWallets.map((wallet) => (
              <li key={wallet.walletId}><strong>{wallet.name}</strong><code>{wallet.address}</code></li>
            ))}
          </ul>
        </div>
        <div>
          <h3>外部地址</h3>
          {page?.entries.length === 0 ? <p className="empty-line">暂无外部地址</p> : null}
          <ul>
            {page?.entries.map((entry) => (
              <li key={entry.entryId}>
                {editing?.entryId === entry.entryId ? (
                  <div className="address-entry-editor">
                    <input aria-label="编辑地址簿名称" onChange={(event) => setEditing({ ...editing, label: event.target.value })} value={editing.label} />
                    <select aria-label="编辑地址簿分类" onChange={(event) => setEditing({ ...editing, category: event.target.value as AddressBookCategory })} value={editing.category}>
                      {Object.entries(categoryLabels).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
                    </select>
                    <button
                      aria-label={`保存 ${entry.label}`}
                      className="icon-button"
                      onClick={() => {
                        void client.patchAddressBookEntry(entry.entryId, {
                          changes: { category: editing.category, label: editing.label, note: editing.note },
                          expectedRevision: entry.revision,
                        }).then(() => { setEditing(null); void load(); }, (failure) => setError(requestError(failure)));
                      }}
                      type="button"
                    ><Check aria-hidden="true" size={15} /></button>
                    <button aria-label="取消编辑" className="icon-button" onClick={() => setEditing(null)} type="button"><X aria-hidden="true" size={15} /></button>
                  </div>
                ) : (
                  <>
                    <div><strong>{entry.label}</strong><span>{categoryLabels[entry.category]}</span><code>{entry.address}</code></div>
                    <div className="address-entry-actions">
                      <button aria-label={`编辑 ${entry.label}`} className="icon-button" onClick={() => setEditing(entry)} title="编辑" type="button"><Pencil aria-hidden="true" size={15} /></button>
                      <button
                        aria-label={`删除 ${entry.label}`}
                        className="icon-button danger-button"
                        onClick={() => void client.deleteAddressBookEntry(entry.entryId).then(() => load(), (failure) => setError(requestError(failure)))}
                        title="删除"
                        type="button"
                      ><Trash2 aria-hidden="true" size={15} /></button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export function WalletReadPanels({ wallets }: { wallets: CustodyWallet[] }) {
  const client = useMemo(() => new WalletReadClient(), []);
  const [walletId, setWalletId] = useState(wallets[0]?.walletId ?? "");
  const [balances, setBalances] = useState<WalletBalanceSnapshot | null>(null);
  const [tokens, setTokens] = useState<WalletTokenPage | null>(null);
  const [tokenAddress, setTokenAddress] = useState("");
  const [status, setStatus] = useState<"error" | "loading" | "ready" | "saving">("loading");
  const [error, setError] = useState<string | null>(null);
  const wallet = wallets.find((candidate) => candidate.walletId === walletId) ?? wallets[0]!;

  useEffect(() => {
    if (!wallets.some((candidate) => candidate.walletId === walletId)) {
      setWalletId(wallets[0]?.walletId ?? "");
    }
  }, [walletId, wallets]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!wallet) return;
      setStatus("loading");
      setError(null);
      try {
        const [nextBalances, nextTokens] = await Promise.all([
          client.balances(wallet.walletId, chainId, signal),
          client.tokens(wallet.walletId, chainId, signal),
        ]);
        setBalances(nextBalances);
        setTokens(nextTokens);
        setStatus("ready");
      } catch (requestFailure) {
        if (signal?.aborted) return;
        setError(requestError(requestFailure));
        setStatus("error");
      }
    },
    [client, wallet],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const importToken = async (event: FormEvent) => {
    event.preventDefault();
    setStatus("saving");
    setError(null);
    try {
      await client.importToken(wallet.walletId, chainId, tokenAddress);
      setTokenAddress("");
      await load();
    } catch (requestFailure) {
      setError(requestError(requestFailure));
      setStatus("error");
    }
  };

  return (
    <div className="wallet-read-model">
      <section aria-labelledby="wallet-assets-title" className="wallet-read-section asset-section">
        <div className="wallet-read-heading">
          <div><Coins aria-hidden="true" size={18} /><h2 id="wallet-assets-title">资产</h2></div>
          <div className="wallet-read-controls">
            <select aria-label="资产钱包" onChange={(event) => setWalletId(event.target.value)} value={wallet.walletId}>
              {wallets.map((candidate) => <option key={candidate.walletId} value={candidate.walletId}>{candidate.name}</option>)}
            </select>
            <button aria-label="刷新资产" className="icon-button tooltip-control" data-tooltip="刷新" disabled={status === "loading"} onClick={() => void load()} title="刷新资产" type="button">
              <RefreshCw aria-hidden="true" className={status === "loading" ? "spin-icon" : undefined} size={16} />
            </button>
          </div>
        </div>
        {balances ? (
          <>
            <div className="asset-total"><span>总估值</span><strong>{balances.totalUsdValueDecimal === null ? "价格数据不完整" : `$${balances.totalUsdValueDecimal}`}</strong><small>区块 {balances.blockNumberDecimal}</small></div>
            <div className="asset-table" role="table" aria-label="钱包资产">
              {balances.items.map((asset) => (
                <div className="asset-row" key={asset.tokenAddress ?? "native"} role="row">
                  <div><strong>{asset.symbol}</strong><span>{asset.name}</span></div>
                  <div><strong>{asset.balanceDecimal}</strong><code>{asset.balanceBaseUnit} base units</code></div>
                  <div><strong>{asset.usdValueDecimal === null ? "--" : `$${asset.usdValueDecimal}`}</strong><span data-price-status={asset.priceStatus}>{asset.priceStatus === "current" ? "价格有效" : asset.priceStatus === "stale" ? "价格已过期" : "暂无价格"}</span></div>
                  {asset.assetType === "erc20" && !asset.default ? (
                    <button aria-label={`删除 ${asset.symbol}`} className="icon-button danger-button" onClick={() => void client.deleteToken(wallet.walletId, chainId, asset.tokenAddress!).then(() => load(), (failure) => setError(requestError(failure)))} title="删除自定义 Token" type="button"><Trash2 aria-hidden="true" size={15} /></button>
                  ) : <span aria-hidden="true" className="asset-action-placeholder" />}
                </div>
              ))}
            </div>
          </>
        ) : null}
        <form className="wallet-read-form token-import-form" onSubmit={(event) => void importToken(event)}>
          <label><span>自定义 Token</span><input aria-label="Token 合约地址" onChange={(event) => setTokenAddress(event.target.value)} placeholder="0x" spellCheck={false} value={tokenAddress} /></label>
          <button className="secondary-button" disabled={status === "saving" || tokenAddress === ""} type="submit"><Plus aria-hidden="true" size={16} />导入</button>
        </form>
        {error ? <p className="wallet-read-error" role="alert">{error}</p> : null}
      </section>
      <ReceivePanel client={client} tokens={tokens} wallet={wallet} />
      <AddressBookPanel client={client} />
    </div>
  );
}
