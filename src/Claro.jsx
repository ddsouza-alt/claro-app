import { useState, useEffect, useRef } from "react";

const Q = {
  q1: { label: "Do Now",    sub: "Urgent Â· Important",         accent: "#DC2626", light: "#FEF2F2", border: "#FECACA", tag: "#FEE2E2", tagText: "#991B1B" },
  q2: { label: "Schedule",  sub: "Important Â· Not Urgent",     accent: "#2563EB", light: "#EFF6FF", border: "#BFDBFE", tag: "#DBEAFE", tagText: "#1E40AF" },
  q3: { label: "Delegate",  sub: "Urgent Â· Not Important",     accent: "#D97706", light: "#FFFBEB", border: "#FDE68A", tag: "#FEF3C7", tagText: "#92400E" },
  q4: { label: "Eliminate", sub: "Not Urgent Â· Not Important", accent: "#6B7280", light: "#F9FAFB", border: "#E5E7EB", tag: "#F3F4F6", tagText: "#374151" },
};

// grid order: [top-left=q2, top-right=q1, bottom-left=q4, bottom-right=q3]
const GRID_ORDER = ["q2", "q1", "q4", "q3"];

const SYS = `You are Claro, a warm and friendly AI productivity coach. Help users sort tasks into the Eisenhower matrix through natural conversation.

Quadrants:
- q1 "Do Now": Urgent AND Important
- q2 "Schedule": Important but NOT Urgent
- q3 "Delegate": Urgent but NOT Important
- q4 "Eliminate": NOT Urgent and NOT Important

Personality: Warm, coaching, like a friend. Always acknowledge before asking. One question at a time. Ask as many as needed until genuinely confident. Keep responses short â they are spoken aloud.

For URGENCY ask: deadlines, consequences of delay, someone waiting.
For IMPORTANCE ask: goal alignment, impact if never done, only they can do it.

CRITICAL: always respond with ONLY valid JSON, no markdown, no backticks:
{"message":"string","action":"continue|confirm|place","quadrant":null,"quadrantName":null,"taskName":null}

- "continue": still gathering info
- "confirm": ready to suggest quadrant, ask "Does that feel right?"
- "place": user confirmed yes, finalize

taskName = clean 2-5 word version of task.`;

async function callClaroAPI(messages, extra = "") {
  const r = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system: SYS + (extra ? "\n\n" + extra : ""),
      messages,
    }),
  });
  const d = await r.json();
  const raw = d.content?.find(b => b.type === "text")?.text || "{}";
  try {
    return JSON.parse(raw.replace(/```json[\s\S]*?```|```/g, "").trim());
  } catch {
    return { message: raw || "Let me think...", action: "continue", quadrant: null, taskName: null };
  }
}

function speak(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 1.05; utter.pitch = 1.0; utter.volume = 1.0;
  function pickVoice() {
    const voices = window.speechSynthesis.getVoices();
    const preferred = ["Samantha","Karen","Moira","Tessa","Google UK English Female","Google US English","Microsoft Aria","Microsoft Jenny"];
    for (const name of preferred) {
      const v = voices.find(v => v.name.includes(name));
      if (v) { utter.voice = v; break; }
    }
    if (!utter.voice) {
      const en = voices.find(v => v.lang === "en-US" && !v.name.toLowerCase().includes("male"));
      if (en) utter.voice = en;
    }
  }
  if (window.speechSynthesis.getVoices().length > 0) { pickVoice(); window.speechSynthesis.speak(utter); }
  else { window.speechSynthesis.onvoiceschanged = () => { pickVoice(); window.speechSynthesis.speak(utter); }; }
}
function stopSpeaking() { window.speechSynthesis?.cancel(); }

let uid = 1;
const nextId = () => uid++;

// localStorage helpers (replaces window.storage from artifacts)
function loadTasks() {
  try {
    const saved = localStorage.getItem("claro-tasks");
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (_) {}
  return null;
}
function saveTasks(tasks) {
  try { localStorage.setItem("claro-tasks", JSON.stringify(tasks)); } catch (_) {}
}

export default function Claro() {
  const [tasks,       setTasks]       = useState([]);
  const [apiMsgs,     setApiMsgs]     = useState([]);
  const [chat,        setChat]        = useState([]);
  const [thinking,    setThinking]    = useState(false);
  const [listening,   setListening]   = useState(false);
  const [isSpeaking,  setIsSpeaking]  = useState(false);
  const [panelOpen,   setPanelOpen]   = useState(false);
  const [expandedQ,   setExpandedQ]   = useState(null);
  const [input,       setInput]       = useState("");
  const [pending,     setPending]     = useState(null);
  const [editTask,    setEditTask]    = useState(null);
  const [justPlaced,  setJustPlaced]  = useState(null);
  const [loaded,      setLoaded]      = useState(false);
  const [micError,    setMicError]    = useState("");

  const bottomRef = useRef(null);
  const recRef    = useRef(null);
  const isNew     = useRef(true);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chat, thinking]);

  useEffect(() => {
    const iv = setInterval(() => setIsSpeaking(window.speechSynthesis?.speaking || false), 200);
    return () => clearInterval(iv);
  }, []);

  // Boot â load from localStorage
  useEffect(() => {
    const saved = loadTasks();
    if (saved) { setTasks(saved); isNew.current = false; }
    setLoaded(true);
  }, []);

  // Save tasks to localStorage whenever they change
  useEffect(() => {
    if (!loaded) return;
    saveTasks(tasks);
  }, [tasks, loaded]);

  function addChatAndSpeak(role, text) {
    setChat(p => [...p, { role, text, cid: nextId() }]);
    if (role === "claro") speak(text);
  }
  function addChat(role, text) { setChat(p => [...p, { role, text, cid: nextId() }]); }

  async function send(text) {
    if (!text.trim() || thinking) return;
    stopSpeaking();
    addChat("user", text);
    setInput("");
    setThinking(true);
    setPending(null);
    const next = [...apiMsgs, { role: "user", content: text }];
    setApiMsgs(next);
    const extra = editTask ? `User is re-evaluating "${editTask.text}" in ${Q[editTask.quadrant].label}.` : "";
    const r = await callClaroAPI(next, extra);
    setThinking(false);
    if (r.message) {
      addChatAndSpeak("claro", r.message);
      setApiMsgs(p => [...p, { role: "assistant", content: JSON.stringify(r) }]);
    }
    if (r.action === "confirm" && r.quadrant) {
      setPending({ quadrant: r.quadrant, quadrantName: r.quadrantName || Q[r.quadrant]?.label, taskName: r.taskName });
    } else if (r.action === "place" && r.quadrant) {
      placeIt(r.taskName || text, r.quadrant);
    }
  }

  function placeIt(name, quadrant) {
    if (editTask) {
      setTasks(p => p.map(t => t.id === editTask.id ? { ...t, quadrant } : t));
    } else {
      const t = { id: nextId(), text: name, quadrant };
      setTasks(p => [...p, t]);
      setJustPlaced(t.id);
      setTimeout(() => setJustPlaced(null), 1800);
    }
    setPending(null);
    setEditTask(null);
    setTimeout(() => { setApiMsgs([]); setChat([]); setPanelOpen(false); }, 1300);
  }

  function confirm(yes) {
    stopSpeaking();
    if (yes) send("Yes, that feels right.");
    else { setPending(null); send("Not quite, let's reconsider."); }
  }

  function openMic() {
    stopSpeaking();
    setPanelOpen(true);
    setEditTask(null);
    if (chat.length === 0) {
      setThinking(true);
      const init = [{ role: "user", content: "Hello" }];
      setApiMsgs(init);
      const hint = !isNew.current
        ? "Returning user. Short warm welcome back, under 20 words. Ask what is on their mind."
        : "First time user. Introduce yourself warmly as Claro. Explain the 4 Eisenhower quadrants simply. Ask what is on their mind. Under 70 words. Speak naturally.";
      callClaroAPI(init, hint).then(r => {
        setThinking(false);
        const msg = r.message || "Hi! I'm Claro. What's on your mind?";
        addChatAndSpeak("claro", msg);
        setApiMsgs(p => [...p, { role: "assistant", content: JSON.stringify(r) }]);
        isNew.current = false;
      });
    }
  }

  function toggleMic() {
    if (listening) { recRef.current?.stop(); return; }
    setMicError("");
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setMicError("Try Chrome â voice not supported here."); return; }
    stopSpeaking();
    const r = new SR();
    r.lang = "en-US"; r.continuous = false; r.interimResults = false;
    r.onstart  = () => { setListening(true); setMicError(""); };
    r.onend    = () => setListening(false);
    r.onerror  = (e) => {
      setListening(false);
      if (e.error === "not-allowed") setMicError("Allow mic access in your browser settings.");
      else if (e.error === "no-speech") setMicError("Didn't catch that â try again.");
      else setMicError("Mic error. Try typing instead.");
    };
    r.onresult = (e) => {
      const t = e.results[0][0].transcript;
      if (t.trim()) send(t);
    };
    recRef.current = r;
    r.start();
  }

  function openEdit(task) {
    stopSpeaking();
    setEditTask(task);
    setApiMsgs([]); setChat([]);
    setPanelOpen(true); setThinking(true);
    const init = [{ role: "user", content: `Re-evaluate: "${task.text}"` }];
    setApiMsgs(init);
    callClaroAPI(init, `User tapped "${task.text}" in ${Q[task.quadrant].label}. Warmly say you will re-evaluate it. Ask fresh questions. Keep it short â spoken aloud.`).then(r => {
      setThinking(false);
      if (r.message) { addChatAndSpeak("claro", r.message); setApiMsgs(p => [...p, { role: "assistant", content: JSON.stringify(r) }]); }
    });
  }

  function removeTask(tid, e) { e.stopPropagation(); setTasks(p => p.filter(t => t.id !== tid)); }
  const inQ = (q) => tasks.filter(t => t.quadrant === q);

  const MIC_SIZE = 52;

  return (
    <div style={{ fontFamily: "'DM Sans','Segoe UI',sans-serif", background: "#F3F4F6", height: "100vh", color: "#111", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@400;500;600&display=swap');
        @keyframes pulse{0%,100%{transform:translate(-50%,-50%) scale(1)}50%{transform:translate(-50%,-50%) scale(1.1)}}
        @keyframes pulseBtn{0%,100%{transform:scale(1)}50%{transform:scale(1.1)}}
        @keyframes ripple{0%{transform:translate(-50%,-50%) scale(1);opacity:.5}100%{transform:translate(-50%,-50%) scale(2.4);opacity:0}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes slideIn{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:scale(1)}}
        @keyframes blink{0%,80%,100%{transform:scale(0);opacity:.2}40%{transform:scale(1);opacity:1}}
        @keyframes pop{0%{transform:scale(.8);opacity:0}60%{transform:scale(1.04)}100%{transform:scale(1);opacity:1}}
        @keyframes wave{0%,100%{transform:scaleY(.3)}50%{transform:scaleY(1)}}
        .qcell:hover{filter:brightness(.97);cursor:pointer}
        .qcell{transition:filter .15s ease}
        .tc:hover{opacity:.8;transform:translateY(-1px);cursor:pointer}
        .tc{transition:all .15s ease}
        .del{opacity:0;transition:opacity .12s}
        .tc:hover .del{opacity:1}
        input:focus,button:focus{outline:none}
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-thumb{background:#D1D5DB;border-radius:4px}
      `}</style>

      {/* Header */}
      <div style={{ background: "#fff", borderBottom: "1px solid #E5E7EB", padding: "11px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, zIndex: 10 }}>
        <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 19, letterSpacing: 3, color: "#4F46E5" }}>CLARO</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {tasks.length > 0 && (
            <span style={{ background: "#EEF2FF", color: "#4F46E5", fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 20 }}>
              {tasks.length} task{tasks.length !== 1 ? "s" : ""}
            </span>
          )}
          {loaded && (
            <span style={{ fontSize: 10, color: "#10B981", fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10B981", display: "inline-block" }} />
              saved
            </span>
          )}
        </div>
      </div>

      {/* Expanded Quadrant View */}
      {expandedQ && (
        <div style={{
          flex: 1, background: Q[expandedQ].light,
          display: "flex", flexDirection: "column",
          animation: "slideIn .2s ease",
          overflow: "hidden",
          paddingBottom: panelOpen ? "50vh" : 0,
          transition: "padding-bottom .3s ease",
        }}>
          <div style={{ padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${Q[expandedQ].border}`, background: "#fff" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                onClick={() => { setExpandedQ(null); stopSpeaking(); setPanelOpen(false); }}
                style={{ background: "#F3F4F6", border: "1px solid #E5E7EB", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 13, color: "#374151", fontFamily: "'DM Sans',sans-serif", fontWeight: 500 }}
              >
                &larr; Back
              </button>
              <span style={{ background: Q[expandedQ].tag, color: Q[expandedQ].tagText, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, padding: "4px 12px", borderRadius: 7, fontFamily: "'Syne',sans-serif" }}>
                {Q[expandedQ].label.toUpperCase()}
              </span>
              <span style={{ fontSize: 11, color: "#9CA3AF" }}>{Q[expandedQ].sub}</span>
            </div>
            <button
              onClick={() => { openMic(); }}
              style={{ background: "#4F46E5", border: "none", borderRadius: 10, padding: "8px 14px", cursor: "pointer", fontSize: 12, color: "#fff", fontFamily: "'DM Sans',sans-serif", fontWeight: 600 }}
            >
              + Add task
            </button>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
            {inQ(expandedQ).length === 0 ? (
              <div style={{ textAlign: "center", paddingTop: 40 }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>ð</div>
                <div style={{ fontSize: 15, color: "#9CA3AF", fontWeight: 500 }}>No tasks here yet</div>
                <div style={{ fontSize: 13, color: "#C4C8D0", marginTop: 6 }}>Tap the mic or "Add task" to get started</div>
              </div>
            ) : (
              inQ(expandedQ).map(task => (
                <div key={task.id} className="tc" onClick={() => openEdit(task)} style={{
                  background: "#fff",
                  border: `1px solid ${Q[expandedQ].border}`,
                  borderLeft: `4px solid ${Q[expandedQ].accent}`,
                  borderRadius: 10,
                  padding: "12px 14px",
                  fontSize: 14,
                  lineHeight: 1.5,
                  color: "#1F2937",
                  animation: task.id === justPlaced ? "pop .35s ease" : "fadeUp .2s ease",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  boxShadow: "0 1px 4px rgba(0,0,0,.06)",
                }}>
                  <span style={{ flex: 1 }}>{task.text}</span>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                    <button className="del" onClick={e => removeTask(task.id, e)} style={{ background: "none", border: "none", color: "#D1D5DB", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0 }}>&times;</button>
                    <span style={{ fontSize: 10, color: Q[expandedQ].accent, opacity: .6 }}>tap to edit</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Matrix View */}
      {!expandedQ && (
        <div style={{ flex: 1, position: "relative", display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", overflow: "hidden" }}>

          {GRID_ORDER.map((qid, idx) => {
            const cfg      = Q[qid];
            const qt       = inQ(qid);
            const isRight  = idx % 2 === 1;
            const isBottom = idx >= 2;
            return (
              <div
                key={qid}
                className="qcell"
                onClick={() => setExpandedQ(qid)}
                style={{
                  background: cfg.light,
                  padding: "14px 14px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  overflow: "hidden",
                  borderRight:  !isRight  ? "1px solid #E5E7EB" : "none",
                  borderBottom: !isBottom ? "1px solid #E5E7EB" : "none",
                  paddingBottom: isBottom ? 14 : 32,
                  paddingTop:    isBottom ? 32 : 14,
                  paddingRight:  isRight  ? 14 : 32,
                  paddingLeft:   isRight  ? 32 : 14,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ background: cfg.tag, color: cfg.tagText, fontSize: 10, fontWeight: 700, letterSpacing: 1, padding: "3px 9px", borderRadius: 6, fontFamily: "'Syne',sans-serif" }}>
                    {cfg.label.toUpperCase()}
                  </span>
                  {qt.length > 0 && (
                    <span style={{ fontSize: 10, color: cfg.accent, fontWeight: 600, background: cfg.border, borderRadius: 10, padding: "1px 7px" }}>
                      {qt.length}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 9, color: "#9CA3AF", letterSpacing: .3 }}>{cfg.sub}</div>

                {qt.slice(0, 3).map((task) => (
                  <div key={task.id} style={{
                    background: "#fff",
                    border: `1px solid ${cfg.border}`,
                    borderLeft: `2.5px solid ${cfg.accent}`,
                    borderRadius: 7,
                    padding: "5px 8px",
                    fontSize: 11,
                    lineHeight: 1.35,
                    color: "#374151",
                    animation: task.id === justPlaced ? "pop .35s ease" : "none",
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                    boxShadow: "0 1px 2px rgba(0,0,0,.04)",
                  }}>
                    {task.text}
                  </div>
                ))}
                {qt.length > 3 && (
                  <div style={{ fontSize: 10, color: cfg.accent, fontWeight: 600 }}>+{qt.length - 3} more</div>
                )}
                {qt.length === 0 && (
                  <div style={{ fontSize: 10, color: "#D1D5DB", fontStyle: "italic", marginTop: 2 }}>Empty</div>
                )}
              </div>
            );
          })}

          {/* Center Mic Button */}
          <div style={{ position: "absolute", top: "50%", left: "50%", zIndex: 20, pointerEvents: "none" }}>
            {isSpeaking && (
              <div style={{
                position: "absolute", top: "50%", left: "50%",
                width: MIC_SIZE, height: MIC_SIZE, borderRadius: "50%",
                border: "2px solid #4F46E5",
                animation: "ripple 1.3s infinite",
                pointerEvents: "none",
              }} />
            )}
            {listening && (
              <div style={{
                position: "absolute", top: "50%", left: "50%",
                width: MIC_SIZE + 16, height: MIC_SIZE + 16, borderRadius: "50%",
                transform: "translate(-50%,-50%)",
                border: "2px solid #DC2626",
                animation: "ripple .8s infinite",
                pointerEvents: "none",
              }} />
            )}
            <button
              onClick={openMic}
              style={{
                position: "absolute", top: "50%", left: "50%",
                width: MIC_SIZE, height: MIC_SIZE, borderRadius: "50%",
                background: listening ? "#DC2626" : "#4F46E5",
                border: "3px solid #fff",
                cursor: "pointer", fontSize: 20,
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 2px 16px rgba(79,70,229,.35), 0 0 0 4px rgba(79,70,229,.1)",
                animation: (listening || isSpeaking) ? "none" : "pulse 2.8s infinite",
                pointerEvents: "all",
                transition: "background .2s ease",
              }}
            >
              {listening ? "â¹" : isSpeaking ? "ð" : "ð"}
            </button>
          </div>
        </div>
      )}

      {/* Conversation Panel */}
      {panelOpen && (
        <div style={{
          position: "fixed", bottom: 0, left: 0, right: 0,
          height: "50vh",
          background: "#fff",
          borderTop: "1px solid #E5E7EB",
          borderRadius: "16px 16px 0 0",
          display: "flex",
          flexDirection: "column",
          zIndex: 300,
          boxShadow: "0 -4px 24px rgba(0,0,0,.1)",
        }}>
          <div style={{ padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #F3F4F6", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {isSpeaking ? (
                <div style={{ display: "flex", alignItems: "center", gap: 2, height: 14 }}>
                  {[0,.1,.2,.1,.05].map((d, i) => (
                    <div key={i} style={{ width: 3, height: 14, background: "#4F46E5", borderRadius: 2, animation: `wave .8s ${d}s infinite ease-in-out` }} />
                  ))}
                </div>
              ) : (
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: thinking ? "#4F46E5" : listening ? "#DC2626" : "#10B981", animation: (thinking || listening) ? "pulseBtn .7s infinite" : "none" }} />
              )}
              <span style={{ fontSize: 10.5, fontWeight: 600, color: "#6B7280", letterSpacing: 1 }}>
                {listening ? "LISTENING..." : isSpeaking ? "CLARO IS SPEAKING" : thinking ? "THINKING..." : editTask ? "RE-EVALUATING" : "CLARO Â· COACH"}
              </span>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {isSpeaking && (
                <button onClick={stopSpeaking} style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#DC2626", borderRadius: 7, padding: "3px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>
                  Stop
                </button>
              )}
              <button onClick={() => { setPanelOpen(false); setEditTask(null); stopSpeaking(); }} style={{ background: "none", border: "none", color: "#9CA3AF", cursor: "pointer", fontSize: 22, lineHeight: 1, padding: 0 }}>&times;</button>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 9 }}>
            {chat.map(msg => (
              <div key={msg.cid} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start", animation: "fadeUp .2s ease" }}>
                <div style={{
                  maxWidth: "82%",
                  background: msg.role === "user" ? "#4F46E5" : "#F3F4F6",
                  borderRadius: msg.role === "user" ? "14px 14px 3px 14px" : "14px 14px 14px 3px",
                  padding: "10px 13px", fontSize: 13.5, lineHeight: 1.55,
                  color: msg.role === "user" ? "#fff" : "#1F2937",
                }}>
                  {msg.text}
                </div>
              </div>
            ))}
            {thinking && (
              <div style={{ display: "flex", gap: 5, padding: "4px 4px", animation: "fadeUp .2s ease" }}>
                {[0,.15,.3].map((d, i) => (
                  <div key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: "#C7D2FE", animation: `blink 1.2s ${d}s infinite ease-in-out` }} />
                ))}
              </div>
            )}
            {pending && !thinking && (
              <div style={{ display: "flex", gap: 8, animation: "fadeUp .2s ease" }}>
                <button onClick={() => confirm(true)} style={{
                  flex: 1, padding: "11px 14px", borderRadius: 10,
                  background: Q[pending.quadrant].tag, border: `1.5px solid ${Q[pending.quadrant].border}`,
                  color: Q[pending.quadrant].tagText, cursor: "pointer", fontSize: 13, fontWeight: 600,
                  fontFamily: "'DM Sans',sans-serif",
                }}>
                  Yes &mdash; place in {pending.quadrantName}
                </button>
                <button onClick={() => confirm(false)} style={{
                  padding: "11px 16px", borderRadius: 10,
                  background: "#F9FAFB", border: "1.5px solid #E5E7EB",
                  color: "#6B7280", cursor: "pointer", fontSize: 13, fontFamily: "'DM Sans',sans-serif",
                }}>Not quite</button>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {micError && (
            <div style={{ margin: "0 12px 4px", padding: "7px 12px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, fontSize: 12, color: "#991B1B" }}>
              {micError}
            </div>
          )}

          <div style={{ padding: "8px 12px 16px", display: "flex", gap: 8, flexShrink: 0, borderTop: "1px solid #F3F4F6" }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !thinking && send(input)}
              placeholder={listening ? "Listening â speak now..." : "Type here or tap mic..."}
              style={{
                flex: 1, background: "#F9FAFB",
                border: `1.5px solid ${listening ? "#FECACA" : "#E5E7EB"}`,
                borderRadius: 10, padding: "10px 14px", color: "#111", fontSize: 13.5,
                fontFamily: "'DM Sans',sans-serif", transition: "border-color .15s",
              }}
            />
            <button
              onClick={toggleMic}
              style={{
                width: 44, height: 44, borderRadius: 10, flexShrink: 0,
                background: listening ? "#FEE2E2" : "#EEF2FF",
                border: `1.5px solid ${listening ? "#FECACA" : "#C7D2FE"}`,
                cursor: "pointer", fontSize: 18,
                display: "flex", alignItems: "center", justifyContent: "center",
                animation: listening ? "pulseBtn .6s infinite" : "none",
              }}
            >{listening ? "â¹" : "ð"}</button>
            <button
              onClick={() => !thinking && input.trim() && send(input)}
              style={{
                width: 44, height: 44, borderRadius: 10, flexShrink: 0,
                background: input.trim() && !thinking ? "#4F46E5" : "#F3F4F6",
                border: "none",
                cursor: input.trim() && !thinking ? "pointer" : "default",
                fontSize: 16, color: input.trim() && !thinking ? "#fff" : "#D1D5DB",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all .15s ease",
              }}
            >&rarr;</button>
          </div>
        </div>
      )}
    </div>
  );
}
