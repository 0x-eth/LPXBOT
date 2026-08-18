import { CheckCircle2, LoaderCircle, Server, Trash2, WifiOff } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

import {
  BrowserReadonlyRpcClient,
  BrowserRpcError,
  browserCustomRpcSession,
  redactBrowserRpcUrl,
  type BrowserRpcState,
} from "./browser-readonly-rpc";

const chainNames: Record<number, string> = {
  1: "Ethereum",
  56: "BNB Smart Chain",
  8453: "Base",
};

const stateLabels: Record<BrowserRpcState, string> = {
  "chain-mismatch": "链不匹配",
  "invalid-response": "响应无效",
  "network-error": "网络错误",
  "rate-limited": "请求过快",
  ready: "可用",
  testing: "测试中",
  timeout: "请求超时",
  unconfigured: "未配置",
};

export function BrowserCustomRpcSettings({ allowedChainIds }: { allowedChainIds: number[] }) {
  const chains = useMemo(
    () => allowedChainIds.filter((chainId) => Object.hasOwn(chainNames, chainId)),
    [allowedChainIds],
  );
  const [chainId, setChainId] = useState(chains[0] ?? 56);
  const [rawUrl, setRawUrl] = useState("");
  const [editing, setEditing] = useState(true);
  const [state, setState] = useState<BrowserRpcState>("unconfigured");
  const [blockNumber, setBlockNumber] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const redacted = useMemo(() => {
    if (rawUrl === "") return "";
    try {
      return redactBrowserRpcUrl(rawUrl, import.meta.env.DEV);
    } catch {
      return "<invalid>";
    }
  }, [rawUrl]);

  const test = async (event: FormEvent) => {
    event.preventDefault();
    setState("testing");
    setBlockNumber(null);
    setErrorCode(null);
    try {
      const client: BrowserReadonlyRpcClient = browserCustomRpcSession.configure({
        development: import.meta.env.DEV,
        url: rawUrl,
      });
      const result = await client.testConnection(chainId);
      setBlockNumber(result.blockNumber);
      setEditing(false);
      setState("ready");
    } catch (error) {
      browserCustomRpcSession.clear();
      const rpcError = error instanceof BrowserRpcError ? error : null;
      setErrorCode(rpcError?.code ?? "CLIENT_RPC_NETWORK_ERROR");
      setState(rpcError?.state ?? "network-error");
    }
  };

  const clear = () => {
    browserCustomRpcSession.clear();
    setRawUrl("");
    setEditing(true);
    setState("unconfigured");
    setBlockNumber(null);
    setErrorCode(null);
  };

  return (
    <section aria-labelledby="custom-rpc-title" className="custom-rpc-settings">
      <div className="interface-section-heading">
        <div>
          <Server aria-hidden="true" size={18} />
          <h2 id="custom-rpc-title">自定义只读 RPC</h2>
        </div>
        <span className="rpc-state" data-state={state} role="status">
          {state === "testing" ? (
            <LoaderCircle aria-hidden="true" className="spin-icon" size={15} />
          ) : state === "ready" ? (
            <CheckCircle2 aria-hidden="true" size={15} />
          ) : (
            <WifiOff aria-hidden="true" size={15} />
          )}
          {stateLabels[state]}
        </span>
      </div>
      <form className="custom-rpc-panel" onSubmit={(event) => void test(event)}>
        <label>
          <span>链</span>
          <select
            aria-label="自定义 RPC 链"
            onChange={(event) => setChainId(Number(event.target.value))}
            value={chainId}
          >
            {chains.map((value) => (
              <option key={value} value={value}>
                {chainNames[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="rpc-url-field">
          <span>RPC URL</span>
          <input
            aria-label="自定义 RPC URL"
            autoCapitalize="off"
            autoComplete="off"
            onBlur={() => {
              if (rawUrl !== "" && redacted !== "<invalid>") setEditing(false);
            }}
            onChange={(event) => {
              setRawUrl(event.target.value);
              setState("unconfigured");
            }}
            onFocus={() => setEditing(true)}
            spellCheck={false}
            type={editing ? "password" : "text"}
            value={editing ? rawUrl : redacted}
          />
        </label>
        <div className="custom-rpc-actions">
          <button
            className="secondary-button"
            disabled={state === "testing" || rawUrl === ""}
            type="submit"
          >
            {state === "testing" ? (
              <LoaderCircle aria-hidden="true" className="spin-icon" size={16} />
            ) : (
              <Server aria-hidden="true" size={16} />
            )}
            测试
          </button>
          <button
            aria-label="清除自定义 RPC"
            className="icon-button danger-button"
            disabled={rawUrl === ""}
            onClick={clear}
            title="清除"
            type="button"
          >
            <Trash2 aria-hidden="true" size={16} />
          </button>
        </div>
        {blockNumber ? <p className="rpc-block-number">区块 {blockNumber}</p> : null}
        {errorCode ? (
          <p className="custom-rpc-error" role="alert">
            {errorCode}
          </p>
        ) : null}
      </form>
    </section>
  );
}
