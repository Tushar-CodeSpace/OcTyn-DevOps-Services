import { FormEvent, useEffect, useRef, useState } from "react";
import { FileText, Loader2, Save, X } from "lucide-react";
import { useParams } from "react-router-dom";
import { apiFetch } from "@/lib/api";
import { getSocket } from "@/lib/socket";
import { useAuth } from "@/lib/auth";
import { formatTime } from "@/lib/utils";
import type { Server, Site } from "@/lib/types";

type TerminalOutput = {
    server_id: string;
    command_id: string;
    command: string;
    output: string;
    exit_code: number | null;
    timed_out: boolean;
    complete: boolean;
    cancelled: boolean;
    finished_at: string;
};

type NanoState = {
    filepath: string;
    content: string;
} | null;

const HISTORY_MAX = 50;

const STATUS_COLOR: Record<Server["status"], string> = {
    online: "bg-emerald-400",
    warning: "bg-amber-400",
    offline: "bg-red-400",
    unknown: "bg-slate-500",
};

function StatusDot({ status }: { status: Server["status"] | undefined }) {
    const key = status ?? "unknown";
    return <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_COLOR[key]}`} />;
}

const COMMON_COMMANDS = [
    "cd", "ls", "pwd", "ping", "cat", "mkdir", "rm", "cp", "mv",
    "touch", "nano", "vim", "systemctl", "docker", "docker-compose",
    "python3", "pip", "uv", "node", "npm", "git", "curl", "wget",
    "grep", "find", "tail", "head", "chmod", "chown", "ps", "top",
    "htop", "df", "du", "free", "uptime", "whoami", "uname", "clear", "exit"
];

const COMMON_PATHS = [
    "/mnt/d/octyn_watcher",
    "/mnt/d/octyn_watcher/agent",
    "/mnt/d/octyn_watcher/backend",
    "/mnt/d/octyn_watcher/frontend",
    "/home",
    "/var/log",
    "/etc",
    "/tmp",
    "/usr",
    "/root",
    "/opt"
];

function getLongestCommonPrefix(strings: string[]): string {
    if (strings.length === 0) return "";
    let prefix = strings[0];
    for (let i = 1; i < strings.length; i++) {
        while (!strings[i].startsWith(prefix)) {
            prefix = prefix.slice(0, -1);
            if (prefix === "") return "";
        }
    }
    return prefix;
}

function getCompletions(currentInput: string, historyList: string[]) {
    if (!currentInput) return { matches: [], isArg: false, target: "", prefix: "" };

    const parts = currentInput.split(" ");
    if (parts.length === 1) {
        const target = parts[0];
        const historyCmds = historyList.map((h) => h.split(" ")[0]).filter(Boolean);
        const pool = Array.from(new Set([...COMMON_COMMANDS, ...historyCmds]));
        const matches = pool.filter((c) => c.startsWith(target));
        return { matches, isArg: false, target, prefix: "" };
    } else {
        const target = parts[parts.length - 1];
        const prefix = parts.slice(0, -1).join(" ") + " ";
        const historyArgs = historyList.flatMap((h) => h.split(" ").slice(1)).filter(Boolean);
        const pool = Array.from(new Set([...COMMON_PATHS, ...historyArgs]));
        const matches = pool.filter((a) => a.startsWith(target));
        return { matches, isArg: true, target, prefix };
    }
}

export default function TerminalPage() {
    const { id } = useParams<{ id: string }>();
    const { isSuperAdmin } = useAuth();
    const [input, setInput] = useState("");
    const [output, setOutput] = useState("Connected to remote server.\n");
    const [running, setRunning] = useState(false);
    const [currentCommandId, setCurrentCommandId] = useState<string | null>(null);
    const [history, setHistory] = useState<string[]>([]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const [server, setServer] = useState<Server | null>(null);
    const [site, setSite] = useState<Site | null>(null);

    // Nano Web Editor Modal state
    const [nanoState, setNanoState] = useState<NanoState>(null);
    const [savingNano, setSavingNano] = useState(false);

    const inputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const followRef = useRef(true);

    const promptHost = server?.hostname ?? (id ? id.slice(0, 8) : "unknown");

    function handleTabCompletion() {
        if (running) return;
        if (!input.trim()) {
            const topCmds = COMMON_COMMANDS.slice(0, 12).join("  ");
            setOutput((prev) => prev + `root@${promptHost} $ \n${topCmds}\n`);
            return;
        }

        const { matches, isArg, target, prefix } = getCompletions(input, history);

        if (matches.length === 0) {
            return;
        }

        if (matches.length === 1) {
            const match = matches[0];
            const completed = prefix + match + (isArg ? "" : " ");
            setInput(completed);
        } else {
            const commonPrefix = getLongestCommonPrefix(matches);
            if (commonPrefix && commonPrefix.length > target.length) {
                setInput(prefix + commonPrefix);
            }
            const suggestionText = matches.slice(0, 16).join("  ");
            setOutput((prev) => prev + `root@${promptHost} $ ${input}\n${suggestionText}${matches.length > 16 ? " ..." : ""}\n`);
        }
    }

    useEffect(() => {
        if (followRef.current) {
            const el = containerRef.current;
            if (el) el.scrollTop = el.scrollHeight;
        }
    }, [output, running]);

    useEffect(() => {
        if (!running && !nanoState) inputRef.current?.focus();
    }, [running, nanoState]);

    useEffect(() => {
        if (!id || !isSuperAdmin) return;
        const socket = getSocket();
        const join = () => socket.emit("join", id);
        const onOutput = (event: TerminalOutput) => {
            if (event.server_id !== id) return;
            
            // Check for OCTYN_NANO_EDIT payload
            if (event.output && event.output.includes("OCTYN_NANO_EDIT:")) {
                try {
                    const jsonStr = event.output.split("OCTYN_NANO_EDIT:")[1].trim();
                    const data = JSON.parse(jsonStr);
                    setNanoState({ filepath: data.filepath, content: data.content });
                    setRunning(false);
                    return;
                } catch (e) {
                    console.error("Failed to parse NANO payload", e);
                }
            }

            setOutput((prev) => {
                let next = prev;
                if (event.output) next += event.output;
                if (event.complete) {
                    if (event.cancelled) {
                        next += "[Aborted]\n";
                    } else {
                        const status = event.timed_out
                            ? "timed out"
                            : `exit ${event.exit_code ?? "unknown"}`;
                        next += `[${status}]\n`;
                    }
                }
                return next;
            });
            if (event.complete) setRunning(false);
        };
        join();
        socket.on("connect", join);
        socket.on("terminal_output", onOutput);
        return () => {
            socket.emit("leave", id);
            socket.off("connect", join);
            socket.off("terminal_output", onOutput);
        };
    }, [id, isSuperAdmin]);

    async function handleSaveNano() {
        if (!nanoState || !id || savingNano) return;
        setSavingNano(true);
        const delim = "OCTYN_NANO_EOF_" + Math.random().toString(36).slice(2, 8);
        const saveCmd = `cat << '${delim}' > ${nanoState.filepath}\n${nanoState.content}\n${delim}`;

        setOutput((prev) => prev + `[Saving ${nanoState.filepath} to site server...]\n`);
        try {
            await apiFetch(`/terminal/${id}/commands`, {
                method: "POST",
                body: JSON.stringify({ command: saveCmd, timeout_seconds: 30 }),
            });
            setOutput((prev) => prev + `[Saved ${nanoState.filepath} (${nanoState.content.length} bytes) successfully]\n`);
            setNanoState(null);
        } catch (err: any) {
            setOutput((prev) => prev + `[Save failed: ${err.message || "error"}]\n`);
        } finally {
            setSavingNano(false);
        }
    }

    useEffect(() => {
        if (!id) return;
        Promise.all([
            apiFetch<Server>(`/servers/${id}`).catch(() => null),
            apiFetch<Site[]>("/sites").catch(() => []),
        ]).then(([s, sites]) => {
            setServer(s);
            if (s) setSite(sites?.find((x) => x.id === s.site_id) ?? null);
        });
    }, [id]);

    function handleScroll() {
        const el = containerRef.current;
        if (!el) return;
        followRef.current = el.scrollHeight - el.scrollTop <= el.clientHeight + 24;
    }

    function navigateHistory(up: boolean) {
        if (running || history.length === 0) return;
        const nextIndex = up
            ? Math.min(historyIndex + 1, history.length - 1)
            : Math.max(historyIndex - 1, -1);
        setHistoryIndex(nextIndex);
        setInput(nextIndex < 0 ? "" : history[history.length - 1 - nextIndex]);
    }

    useEffect(() => {
        const onKeyDown = (event: globalThis.KeyboardEvent) => {
            if (nanoState) return;

            if (!event.ctrlKey) {
                if ((event.key === "ArrowUp" || event.key === "ArrowDown") && !running) {
                    event.preventDefault();
                    navigateHistory(event.key === "ArrowUp");
                }
                if (event.key === "Tab" && !running) {
                    event.preventDefault();
                    handleTabCompletion();
                }
                return;
            }
            switch (event.key) {
                case "c": {
                    const selected = window.getSelection()?.toString().trim();
                    if (selected) {
                        return;
                    }
                    event.preventDefault();
                    const cid = currentCommandId;
                    if (running && cid) {
                        setRunning(false);
                        setCurrentCommandId(null);
                        apiFetch(`/terminal/${id}/commands/${cid}/cancel`, {
                            method: "POST",
                        }).catch(() => {});
                    } else if (!running) {
                        setOutput((prev) => prev + "^C\n");
                    }
                    return;
                }
                case "l":
                    event.preventDefault();
                    setOutput("");
                    return;
                case "u":
                    event.preventDefault();
                    setInput("");
                    return;
                case "a":
                    event.preventDefault();
                    inputRef.current?.focus();
                    requestAnimationFrame(() => {
                        const el = inputRef.current;
                        if (el) el.setSelectionRange(0, 0);
                    });
                    return;
                case "e":
                    event.preventDefault();
                    inputRef.current?.focus();
                    requestAnimationFrame(() => {
                        const el = inputRef.current;
                        if (el) el.setSelectionRange(el.value.length, el.value.length);
                    });
                    return;
                case "k": {
                    event.preventDefault();
                    const el = inputRef.current;
                    if (!el || running) return;
                    const s = el.selectionStart ?? el.value.length;
                    setInput(el.value.slice(0, s));
                    requestAnimationFrame(() => {
                        const e2 = inputRef.current;
                        if (e2) e2.setSelectionRange(s, s);
                    });
                    return;
                }
                case "w": {
                    event.preventDefault();
                    const el = inputRef.current;
                    if (!el || running) return;
                    const val = el.value;
                    let start = el.selectionStart ?? val.length;
                    const end = el.selectionEnd ?? val.length;
                    while (start > 0 && /\s/.test(val[start - 1])) start--;
                    while (start > 0 && !/\s/.test(val[start - 1])) start--;
                    setInput(val.slice(0, start) + val.slice(end));
                    requestAnimationFrame(() => {
                        const e2 = inputRef.current;
                        if (e2) e2.setSelectionRange(start, start);
                    });
                    return;
                }
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [id, running, currentCommandId, history, input, promptHost, nanoState]);

    async function submit(event: FormEvent) {
        event.preventDefault();
        const text = input.trim();
        if (!id || !text || running) return;
        setRunning(true);
        setOutput((prev) => prev + `root@${promptHost} $ ${text}\n`);
        setHistory((prev) =>
            prev.includes(text) ? prev : [...prev, text].slice(-HISTORY_MAX)
        );
        setHistoryIndex(-1);
        setInput("");
        try {
            const resp = await apiFetch<{ command_id: string }>(`/terminal/${id}/commands`, {
                method: "POST",
                body: JSON.stringify({ command: text }),
            });
            setCurrentCommandId(resp.command_id);
        } catch (error) {
            setRunning(false);
            setOutput(
                (prev) =>
                    prev +
                    (error instanceof Error ? error.message : "Failed to queue command") +
                    "\n"
            );
        }
    }

    if (!isSuperAdmin) {
        return <div className="p-8 text-sm text-red-400">Super admin access required.</div>;
    }

    const serverLabel = server?.name ?? (id ? `servers/${id}` : "unknown");
    const serverIp = server?.ip_address ?? "no IP";
    const siteLabel = site ? `${site.client} / ${site.location}` : "";
    const lastSeen = formatTime(server?.last_seen_at);

    function renderFormattedOutput(text: string) {
        const lines = text.split("\n");
        return lines.map((line, idx) => {
            const promptMatch = line.match(/^(root@[^\s$]+ \$ )(.*)$/);
            const isLast = idx === lines.length - 1;
            if (promptMatch) {
                return (
                    <span key={idx}>
                        <span className="text-emerald-400">{promptMatch[1]}</span>
                        <span>{promptMatch[2]}</span>
                        {!isLast && "\n"}
                    </span>
                );
            }
            return (
                <span key={idx}>
                    {line}
                    {!isLast && "\n"}
                </span>
            );
        });
    }

    return (
        <div className="flex h-screen min-h-screen flex-col bg-black font-mono text-[13px] text-emerald-300">
            <header className="flex h-14 shrink-0 items-center justify-between border-b border-emerald-900/40 bg-emerald-950/50 px-3 text-xs text-emerald-400/70">
                <div className="flex min-w-0 flex-col gap-0.5 leading-tight">
                    <div className="flex items-center gap-2 truncate">
                        <span className="text-emerald-400">root@{promptHost}</span>
                        <span className="text-emerald-700">~</span>
                        <span className="truncate font-medium text-emerald-200">{serverLabel}</span>
                        <StatusDot status={server?.status} />
                    </div>
                    <div className="flex items-center gap-1.5 overflow-hidden text-ellipsis whitespace-nowrap opacity-60">
                        <span className="truncate" title={serverIp}>
                            {serverIp}
                        </span>
                        {site && <span className="text-emerald-700/50">·</span>}
                        {site && (
                            <span className="truncate" title={siteLabel}>
                                {siteLabel}
                            </span>
                        )}
                        <span className="text-emerald-700/50">·</span>
                        <span>last seen {lastSeen}</span>
                    </div>
                </div>
                <button
                    type="button"
                    title="Close terminal"
                    onClick={() => window.close()}
                    className="flex h-6 w-6 items-center justify-center text-emerald-400/60 transition-colors hover:text-emerald-300"
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            </header>

            <main
                ref={containerRef}
                onScroll={handleScroll}
                onClick={(event) => {
                    if (!running && !(event.target as HTMLElement).closest("pre")) {
                        inputRef.current?.focus();
                    }
                }}
                className="relative flex-1 overflow-y-auto p-3"
            >
                <pre className="whitespace-pre-wrap break-all leading-5 text-white">
                    {renderFormattedOutput(output)}
                </pre>

                <div className="flex items-center">
                    <span className="whitespace-pre text-emerald-400">root@{promptHost}&nbsp;$&nbsp;</span>
                    <form onSubmit={submit} className="flex-1">
                        <input
                            id="terminal-input"
                            ref={inputRef}
                            value={input}
                            onChange={(event) => setInput(event.target.value)}
                            disabled={running}
                            autoComplete="off"
                            autoFocus
                            spellCheck={false}
                            aria-label="Terminal command"
                            className="w-full border-0 border-transparent bg-transparent text-white outline-none ring-0 ring-offset-0 caret-emerald-400 placeholder:text-emerald-900/40 disabled:cursor-wait disabled:opacity-60 focus:border-transparent focus:outline-none focus:ring-0 focus:ring-offset-0 focus:shadow-none"
                            style={{ background: "transparent", border: "none", boxShadow: "none", outline: "none", caretColor: "#22c55e" }}
                        />
                    </form>
                </div>

                {nanoState && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm animate-in fade-in duration-200">
                        <div className="flex h-[88vh] w-full max-w-5xl flex-col rounded-lg border border-emerald-800/80 bg-zinc-950 shadow-2xl shadow-emerald-950/50">
                            {/* Nano Header */}
                            <div className="flex h-10 shrink-0 items-center justify-between border-b border-emerald-900/60 bg-emerald-950 px-4 text-xs font-semibold text-emerald-300">
                                <div className="flex items-center gap-2">
                                    <FileText className="h-4 w-4 text-emerald-400" />
                                    <span>GNU nano 7.2</span>
                                    <span className="text-emerald-700">|</span>
                                    <span className="text-emerald-100">{nanoState.filepath}</span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="text-[11px] font-normal text-emerald-500">
                                        {nanoState.content.split("\n").length} lines · {nanoState.content.length} chars
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => setNanoState(null)}
                                        className="rounded p-1 text-emerald-400/60 hover:bg-emerald-900/50 hover:text-emerald-200"
                                    >
                                        <X className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>

                            {/* Nano Editor Area */}
                            <div className="relative flex flex-1 overflow-hidden bg-black">
                                <textarea
                                    value={nanoState.content}
                                    onChange={(e) => setNanoState({ ...nanoState, content: e.target.value })}
                                    onKeyDown={(e) => {
                                        if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
                                            e.preventDefault();
                                            handleSaveNano();
                                        } else if (e.key === "Escape") {
                                            e.preventDefault();
                                            setNanoState(null);
                                        }
                                    }}
                                    autoFocus
                                    spellCheck={false}
                                    className="h-full w-full border-0 bg-transparent p-4 font-mono text-sm leading-relaxed text-emerald-300 outline-none ring-0 caret-emerald-400 focus:outline-none focus:ring-0"
                                    placeholder="Enter file contents..."
                                />
                            </div>

                            {/* Nano Footer Toolbar */}
                            <div className="flex h-12 shrink-0 items-center justify-between border-t border-emerald-900/60 bg-emerald-950/80 px-4 text-xs">
                                <div className="flex items-center gap-3">
                                    <button
                                        type="button"
                                        onClick={handleSaveNano}
                                        disabled={savingNano}
                                        className="flex items-center gap-1.5 rounded bg-emerald-600 px-3 py-1.5 font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
                                    >
                                        {savingNano ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                                        <span>^S Save & Apply to Server</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setNanoState(null)}
                                        disabled={savingNano}
                                        className="flex items-center gap-1.5 rounded border border-slate-700 bg-slate-900 px-3 py-1.5 font-medium text-slate-300 transition hover:bg-slate-800"
                                    >
                                        <X className="h-3.5 w-3.5" />
                                        <span>^X Close (Esc)</span>
                                    </button>
                                </div>
                                <span className="text-[11px] text-emerald-400/60">
                                    Press <kbd className="rounded border border-emerald-800 bg-emerald-900/50 px-1 py-0.5 text-emerald-200">Ctrl+S</kbd> to save directly to server
                                </span>
                            </div>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
