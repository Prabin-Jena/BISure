// chat.js — Dedicated Chat Engine for BISure (chat.html)
// Handles RAG conversation state, streaming responses, evidence rendering, error recovery, and URL prompt prefilling.

// --- DOM References (dynamically bound via initChat) ---
let chatForm = null;
let userInput = null;
let sendButton = null;
let messageList = null;
let emptyState = null;
let coldStartBanner = null;
let newChatBtn = null;

// --- Runtime State ---
let abortController = null;
let isWaitingForResponse = false;
let hasActiveError = false;
let lastFailedQuery = null;
let hasReceivedFirstResponse = false;
let coldStartTimer = null;
let isNavigatingAway = false;

// Only stores confirmed turns: [{ role: "user" | "assistant", content: string }]
const conversationHistory = [];

// --- Cold Start UI Management ---
function setColdStartNotice(visible) {
  if (coldStartBanner) {
    coldStartBanner.hidden = !visible;
  }
}

// --- Formatting & Auto-Resize ---
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function formatAnswer(text) {
  if (!text) return "";
  let clean = escapeHtml(text);

  clean = clean.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  clean = clean.replace(/`([^`]+)`/g, "<code>$1</code>");
  clean = clean.replace(/\[(\d+)\]/g, (match, digits) => {
    const idx = parseInt(digits, 10);
    return `<button type="button" class="citation-marker" data-citation-index="${idx}">${match}</button>`;
  });

  const lines = clean.split("\n");
  const output = [];
  let inList = false;
  let inOrderedList = false;

  function closeLists() {
    if (inList) {
      output.push("</ul>");
      inList = false;
    }
    if (inOrderedList) {
      output.push("</ol>");
      inOrderedList = false;
    }
  }

  function parseTableRow(line) {
    const t = line.trim();
    if (!t.startsWith("|") || !t.endsWith("|") || t.length < 2) return null;
    const inner = t.slice(1, -1);
    return inner.split("|").map((cell) => cell.trim());
  }

  function isSeparatorRow(cells) {
    if (!cells || cells.length === 0) return false;
    return cells.every((c) => /^:?-+:?$/.test(c));
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Check for Table block (requires header row and separator row with matching column count)
    const headerCells = parseTableRow(trimmed);
    if (headerCells && headerCells.length >= 1 && i + 1 < lines.length) {
      const sepCells = parseTableRow(lines[i + 1]);
      if (sepCells && isSeparatorRow(sepCells) && sepCells.length === headerCells.length) {
        let j = i + 2;
        const bodyRows = [];
        let isRagged = false;

        while (j < lines.length) {
          const candidate = lines[j].trim();
          if (candidate.startsWith("|") && candidate.endsWith("|") && candidate.length >= 2) {
            const rowCells = parseTableRow(candidate);
            if (rowCells.length !== headerCells.length) {
              isRagged = true;
            }
            bodyRows.push(isRagged ? candidate : rowCells);
            j++;
          } else {
            break;
          }
        }

        if (isRagged) {
          // Defensive fallback: render raw lines inside <p>
          closeLists();
          for (let k = i; k < j; k++) {
            const rawTrimmed = lines[k].trim();
            if (rawTrimmed.length > 0) {
              output.push(`<p>${rawTrimmed}</p>`);
            }
          }
        } else {
          closeLists();
          let tableHtml = '<div class="table-container"><table class="chat-table"><thead><tr>';
          for (const cell of headerCells) {
            tableHtml += `<th>${cell}</th>`;
          }
          tableHtml += '</tr></thead><tbody>';
          for (const row of bodyRows) {
            tableHtml += '<tr>';
            for (const cell of row) {
              tableHtml += `<td>${cell}</td>`;
            }
            tableHtml += '</tr>';
          }
          tableHtml += '</tbody></table></div>';
          output.push(tableHtml);
        }

        i = j - 1;
        continue;
      }
    }

    // Check for Headings (### -> <h4>, #### -> <h5>)
    const h5Match = /^####\s+(.+)$/.exec(trimmed);
    if (h5Match) {
      closeLists();
      output.push(`<h5>${h5Match[1]}</h5>`);
      continue;
    }

    const h4Match = /^###\s+(.+)$/.exec(trimmed);
    if (h4Match) {
      closeLists();
      output.push(`<h4>${h4Match[1]}</h4>`);
      continue;
    }

    // Check for Unordered List
    const isBullet = /^[*-]\s+(.+)/.test(trimmed);
    if (isBullet) {
      if (inOrderedList) {
        output.push("</ol>");
        inOrderedList = false;
      }
      if (!inList) {
        output.push("<ul>");
        inList = true;
      }
      output.push(`<li>${trimmed.replace(/^[*-]\s+/, "")}</li>`);
      continue;
    }

    // Check for Ordered List
    const isOrdered = /^\d+\.\s+(.+)/.test(trimmed);
    if (isOrdered) {
      if (inList) {
        output.push("</ul>");
        inList = false;
      }
      if (!inOrderedList) {
        output.push("<ol>");
        inOrderedList = true;
      }
      output.push(`<li>${trimmed.replace(/^\d+\.\s+/, "")}</li>`);
      continue;
    }

    // Normal non-list line
    closeLists();
    if (trimmed.length > 0) {
      output.push(`<p>${trimmed}</p>`);
    }
  }

  closeLists();
  return output.join("");
}

function autoResizeTextarea(textarea) {
  if (!textarea) return;
  textarea.style.height = "auto";
  const maxHeight = 140;
  const newHeight = Math.min(textarea.scrollHeight, maxHeight);
  textarea.style.height = `${newHeight}px`;
  textarea.style.overflowY =
    textarea.scrollHeight > maxHeight ? "auto" : "hidden";
}

function scrollToBottom() {
  if (!messageList) return;
  messageList.scrollTo({ top: messageList.scrollHeight, behavior: "smooth" });
}

function setBusy(busy) {
  isWaitingForResponse = busy;
  if (sendButton) {
    sendButton.disabled = busy;
    sendButton.setAttribute("aria-busy", busy);
    const sendIcon = sendButton.querySelector(".send-icon");
    const spinnerIcon = sendButton.querySelector(".spinner-icon");
    if (sendIcon && spinnerIcon) {
      sendIcon.hidden = busy;
      spinnerIcon.hidden = !busy;
    }
  }

  if (userInput) {
    userInput.disabled = busy || hasActiveError;
  }

  // Manage Cold-Start indicator banner
  if (busy) {
    if (!hasReceivedFirstResponse) {
      // Show immediately on first question to reassure judges during free-tier cloud spin-up
      setColdStartNotice(true);
    } else {
      // If a subsequent question takes over 3.5 seconds, display the notice
      coldStartTimer = setTimeout(() => {
        setColdStartNotice(true);
      }, 3500);
    }
  } else {
    if (coldStartTimer) {
      clearTimeout(coldStartTimer);
      coldStartTimer = null;
    }
    setColdStartNotice(false);
  }
}

function setErrorLock(locked) {
  hasActiveError = locked;
  if (userInput) userInput.disabled = locked;
  if (sendButton) sendButton.disabled = locked;

  if (locked && userInput) {
    userInput.dataset.originalPlaceholder = userInput.placeholder;
    userInput.placeholder =
      "Connection issue: Retry or Dismiss above before continuing...";
  } else if (userInput) {
    userInput.placeholder =
      userInput.dataset.originalPlaceholder ||
      "Ask about BIS standards, hallmarking rules, or certification...";
  }
}

function commitHistory(query, answer) {
  conversationHistory.push({ role: "user", content: query });
  conversationHistory.push({ role: "assistant", content: answer });

  const maxTurns = (window.APP_CONFIG && window.APP_CONFIG.MAX_HISTORY_TURNS) || 6;
  while (conversationHistory.length > maxTurns) {
    conversationHistory.shift();
  }
}

// --- Render Elements ---
function detectSourceType(title = "", rawType = "") {
  const t = (String(title) + " " + String(rawType)).toLowerCase();
  if (t.includes("gazette") || t.includes("notification") || t.includes("s.o.") || t.includes("g.s.r.")) {
    return "Gazette Notification";
  }
  if (t.includes("qco") || t.includes("quality control") || t.includes("order")) {
    return "Quality Control Order";
  }
  if (t.includes("hallmark") || t.includes("huid") || t.includes("jewell")) {
    return "Hallmarking Directive";
  }
  if (t.includes("guidance") || t.includes("manual") || t.includes("guideline")) {
    return "BIS Guidance Document";
  }
  if (t.includes("crs") || t.includes("compulsory registration")) {
    return "CRS Scheme Regulation";
  }
  if (t.includes("is ") || t.includes("is/") || t.includes("is:") || t.includes("standard")) {
    return "Indian Standard Specification";
  }
  return "Official BIS Record";
}

function renderSources(container, sources) {
  if (!Array.isArray(sources) || sources.length === 0) return;

  const existing = container.querySelector(".assistant-evidence-block");
  if (existing) existing.remove();

  const details = document.createElement("details");
  details.className = "assistant-evidence-block";
  details.open = true;

  const summary = document.createElement("summary");
  summary.className = "evidence-header";
  summary.innerHTML = `
    <div class="evidence-header-left">
      <svg class="evidence-header-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="16" y1="13" x2="8" y2="13"></line>
        <line x1="16" y1="17" x2="8" y2="17"></line>
        <polyline points="10 9 9 9 8 9"></polyline>
      </svg>
      <span class="evidence-header-title">Verified Sources &amp; Citations</span>
    </div>
    <span class="evidence-badge">${sources.length} ${sources.length === 1 ? "Verified Source" : "Verified Sources"}</span>
  `;
  details.appendChild(summary);

  const cardList = document.createElement("div");
  cardList.className = "evidence-cards-list";

  sources.forEach((src, idx) => {
    const card = document.createElement("div");
    card.className = "evidence-card";
    card.dataset.citationIndex = String(idx + 1);

    const cardHeader = document.createElement("div");
    cardHeader.className = "evidence-card-header";

    const numSpan = document.createElement("span");
    numSpan.className = "evidence-num";
    numSpan.textContent = `[${String(idx + 1).padStart(2, "0")}]`;

    const typeBadge = document.createElement("span");
    typeBadge.className = "evidence-type-badge";
    typeBadge.textContent = detectSourceType(src.title, src.type || src.doc_type);

    cardHeader.appendChild(numSpan);
    cardHeader.appendChild(typeBadge);

    const docTitle = document.createElement("div");
    docTitle.className = "evidence-doc-title";
    docTitle.textContent = src.title || "Indian Standard Specification";

    card.appendChild(cardHeader);
    card.appendChild(docTitle);

    if (src.snippet && src.snippet.trim()) {
      const snippet = document.createElement("div");
      snippet.className = "evidence-snippet";
      snippet.textContent = src.snippet.trim();
      card.appendChild(snippet);
    }

    cardList.appendChild(card);
  });

  details.appendChild(cardList);
  container.appendChild(details);
  wireCitationInteractions(container);
}

// --- Citation Marker & Evidence Card Interactive Cross-Referencing ---
const activeCardPulseTimers = new WeakMap();

function isReducedMotionActive() {
  if (window.BISureMotion && window.BISureMotion.prefersReducedMotion) {
    return window.BISureMotion.prefersReducedMotion.matches();
  }
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  return false;
}

function wireCitationInteractions(messageContainer) {
  if (!messageContainer) return;

  const markers = messageContainer.querySelectorAll(".citation-marker");
  if (markers.length === 0) return;

  markers.forEach((marker) => {
    if (marker.dataset.citationBound === "true") return;
    marker.dataset.citationBound = "true";

    const index = marker.dataset.citationIndex;
    const matchingCard = messageContainer.querySelector(
      `.evidence-card[data-citation-index="${index}"]`
    );

    if (!matchingCard) {
      // Graceful no-op for orphaned/unmatched citation marker
      marker.classList.add("is-unmatched");
      marker.setAttribute("aria-disabled", "true");
      marker.setAttribute("title", `Source [${index}] not found in evidence list`);
      marker.tabIndex = -1;
      return;
    }

    // Click / Enter / Space activation (buttons trigger click on Enter/Space natively)
    marker.addEventListener("click", (e) => {
      e.preventDefault();

      // 1. Open evidence details if closed
      const details = messageContainer.querySelector(".assistant-evidence-block");
      if (details && !details.open) {
        details.open = true;
      }

      // 2. Scroll matching card into view respecting prefers-reduced-motion
      const scrollBehavior = isReducedMotionActive() ? "auto" : "smooth";
      matchingCard.scrollIntoView({
        behavior: scrollBehavior,
        block: "nearest"
      });

      // 3. Apply temporary highlight/pulse visual state (~1.8s)
      matchingCard.classList.add("citation-active-pulse");
      if (activeCardPulseTimers.has(matchingCard)) {
        clearTimeout(activeCardPulseTimers.get(matchingCard));
      }
      const timerId = setTimeout(() => {
        matchingCard.classList.remove("citation-active-pulse");
        activeCardPulseTimers.delete(matchingCard);
      }, 1800);
      activeCardPulseTimers.set(matchingCard, timerId);
    });

    // Hover preview: light visual cue, no scroll, no auto-opening
    marker.addEventListener("mouseenter", () => {
      matchingCard.classList.add("citation-hover");
    });
    marker.addEventListener("mouseleave", () => {
      matchingCard.classList.remove("citation-hover");
    });

    // Focus / blur preview for keyboard navigation
    marker.addEventListener("focus", () => {
      matchingCard.classList.add("citation-hover");
    });
    marker.addEventListener("blur", () => {
      matchingCard.classList.remove("citation-hover");
    });
  });
}

// --- Toast Feedback Helper ---
let toastElement = null;
let toastTimeoutId = null;

function showToast(message = "Copied to clipboard") {
  if (!toastElement) {
    toastElement = document.createElement("div");
    toastElement.className = "clipboard-toast";
    toastElement.setAttribute("role", "status");
    toastElement.setAttribute("aria-live", "polite");
    document.body.appendChild(toastElement);
  }

  toastElement.textContent = message;
  toastElement.classList.add("is-visible");

  if (toastTimeoutId) {
    clearTimeout(toastTimeoutId);
    toastTimeoutId = null;
  }

  toastTimeoutId = setTimeout(() => {
    if (toastElement) {
      toastElement.classList.remove("is-visible");
    }
    toastTimeoutId = null;
  }, 2000);
}

function renderMessageActions(container, rawText, role) {
  const actionsGroup = document.createElement("div");
  actionsGroup.className = `message-actions actions-${role}`;

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "action-btn copy-btn";
  copyBtn.setAttribute("aria-label", "Copy text");
  copyBtn.title = "Copy";
  copyBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
    </svg>
  `;
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(rawText);
      copyBtn.classList.add("action-success");
      setTimeout(() => copyBtn.classList.remove("action-success"), 1500);
      showToast("Copied to clipboard");
    } catch (e) {
      console.warn("Clipboard copy failed:", e);
    }
  });
  actionsGroup.appendChild(copyBtn);

  if (role === "user") {
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "action-btn edit-btn";
    editBtn.setAttribute("aria-label", "Edit query");
    editBtn.title = "Edit query";
    editBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
      </svg>
    `;
    editBtn.addEventListener("click", () => {
      if (userInput) {
        userInput.value = rawText;
        autoResizeTextarea(userInput);
        dismissActiveError();
        container.remove();
        userInput.focus();
      }
    });
    actionsGroup.appendChild(editBtn);
  }

  container.appendChild(actionsGroup);
}

function appendMessage(role, textContent, sources = []) {
  if (!messageList) return null;

  const wrapper = document.createElement("article");
  wrapper.className = `message message-${role}`;

  if (role === "user") {
    const roleLabel = document.createElement("div");
    roleLabel.className = "message-role";
    roleLabel.textContent = "You";

    const body = document.createElement("div");
    body.className = "message-body";
    body.textContent = textContent;

    wrapper.appendChild(roleLabel);
    wrapper.appendChild(body);
  } else {
    const roleBar = document.createElement("div");
    roleBar.className = "message-role-bar";

    const roleLabel = document.createElement("span");
    roleLabel.className = "message-role";
    roleLabel.textContent = "BIS Standards Engine";

    const groundedBadge = document.createElement("span");
    groundedBadge.className = "grounded-badge";
    groundedBadge.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
      <span>Grounded Response</span>
    `;

    roleBar.appendChild(roleLabel);
    roleBar.appendChild(groundedBadge);

    const answerBlock = document.createElement("div");
    answerBlock.className = "assistant-answer-block";

    const body = document.createElement("div");
    body.className = "message-body";
    if (textContent) {
      body.innerHTML = formatAnswer(textContent);
    }
    answerBlock.appendChild(body);

    wrapper.appendChild(roleBar);
    wrapper.appendChild(answerBlock);

    if (sources && sources.length > 0) {
      renderSources(wrapper, sources);
    } else {
      wireCitationInteractions(wrapper);
    }
  }

  if (textContent) {
    renderMessageActions(wrapper, textContent, role);
  }

  if (emptyState && !emptyState.hidden) {
    emptyState.hidden = true;
  }

  messageList.appendChild(wrapper);
  scrollToBottom();
  return wrapper;
}

function showTypingIndicator() {
  if (!messageList) return;

  const indicator = document.createElement("article");
  indicator.className = "message message-assistant typing-indicator";
  indicator.id = "typing-indicator";
  
  const coldNoteHtml = !hasReceivedFirstResponse
    ? `<div class="typing-cold-note">
         <span class="cold-dot"></span>
         <span>Waking up the assistant, this can take up to a minute on first load...</span>
       </div>`
    : "";

  indicator.innerHTML = `
    <div class="message-role">BIS Standards Engine</div>
    <div class="typing-body">
      <svg class="typing-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <polygon points="12 2 21 7 21 17 12 22 3 17 3 7 12 2"></polygon>
      </svg>
      <span>Searching Gazette &amp; BIS repositories</span>
      <div class="typing-dots" aria-label="Researching standards">
        <span></span><span></span><span></span>
      </div>
    </div>
    ${coldNoteHtml}
  `;
  messageList.appendChild(indicator);
  scrollToBottom();
}

function hideTypingIndicator() {
  const indicator = document.getElementById("typing-indicator");
  if (indicator) indicator.remove();
}

function dismissActiveError() {
  if (!messageList) return;
  const existingNotice = messageList.querySelector(".message-system");
  if (existingNotice) existingNotice.remove();
  hasActiveError = false;
  lastFailedQuery = null;
  setErrorLock(false);
}

function appendRetryableError(errorMessage) {
  if (!messageList) return;

  dismissActiveError();
  setErrorLock(true);

  const wrapper = document.createElement("article");
  wrapper.className = "message message-system";
  wrapper.setAttribute("role", "alert");

  wrapper.innerHTML = `
    <div class="system-header">
      <svg class="system-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>
      <span class="system-title">Network Alert</span>
    </div>
    <div class="system-content">
      <p class="system-text">${escapeHtml(errorMessage)}</p>
      <div class="system-actions">
        <button type="button" class="dismiss-button" id="dismiss-btn">Dismiss</button>
        <button type="button" class="retry-button" id="retry-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <polyline points="1 4 1 10 7 10"></polyline>
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
          </svg>
          Retry
        </button>
      </div>
    </div>
  `;

  messageList.appendChild(wrapper);
  scrollToBottom();

  const retryBtn = wrapper.querySelector("#retry-btn");
  const dismissBtn = wrapper.querySelector("#dismiss-btn");

  if (retryBtn) {
    retryBtn.addEventListener("click", () => {
      if (isWaitingForResponse) return;
      retryBtn.disabled = true;
      const queryToRetry = lastFailedQuery;
      dismissActiveError();
      if (queryToRetry) {
        executeTurn(queryToRetry, false);
      }
    });
  }

  if (dismissBtn) {
    dismissBtn.addEventListener("click", () => {
      dismissActiveError();
      if (userInput) userInput.focus();
    });
  }
}

// --- Session ID Management (DESIGN_TREE.md Contract) ---
const SESSION_STORAGE_KEY = "bisure_session_id";

function getOrCreateSessionId() {
  try {
    let sessionId = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (sessionId && typeof sessionId === "string" && sessionId.trim()) {
      return sessionId;
    }

    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      sessionId = crypto.randomUUID();
    } else {
      sessionId = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    }

    sessionStorage.setItem(SESSION_STORAGE_KEY, sessionId);
    return sessionId;
  } catch {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return "session-" + Date.now() + "-" + Math.random().toString(36).substring(2, 9);
  }
}

// --- Transports ---
async function requestBatch(query) {
  abortController = new AbortController();
  const timeoutMs = (window.APP_CONFIG && window.APP_CONFIG.REQUEST_TIMEOUT_MS) || 30000;
  const timeoutId = setTimeout(
    () => abortController.abort(),
    timeoutMs,
  );

  const payload = {
    query,
    history: conversationHistory,
    session_id: getOrCreateSessionId(),
  };

  let response;
  try {
    response = await fetch(window.APP_CONFIG.API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: abortController.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(`Endpoint returned HTTP ${response.status}`);
  }

  const data = await response.json();
  const answer = typeof data.answer === "string" ? data.answer : "";
  const sources = Array.isArray(data.sources) ? data.sources : [];

  if (!answer.trim()) {
    throw new Error("The service returned an empty answer. Please retry.");
  }

  hasReceivedFirstResponse = true;
  hideTypingIndicator();
  commitHistory(query, answer);
  appendMessage("assistant", answer, sources);
}

async function requestStream(query) {
  abortController = new AbortController();
  const timeoutMs = (window.APP_CONFIG && window.APP_CONFIG.REQUEST_TIMEOUT_MS) || 30000;
  const timeoutId = setTimeout(
    () => abortController.abort(),
    timeoutMs,
  );

  const payload = {
    query,
    history: conversationHistory,
    session_id: getOrCreateSessionId(),
  };

  const response = await fetch(window.APP_CONFIG.STREAM_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: abortController.signal,
  });

  clearTimeout(timeoutId);

  if (
    response.status === 404 ||
    response.status === 405 ||
    response.status === 501
  ) {
    console.warn(
      `Streaming endpoint unavailable (${response.status}). Falling back to batch.`,
    );
    return await requestBatch(query);
  }

  if (!response.ok) {
    throw new Error(`Stream returned HTTP ${response.status}`);
  }

  hasReceivedFirstResponse = true;
  hideTypingIndicator();

  const assistantBubble = appendMessage("assistant", "");
  const bodyEl = assistantBubble ? assistantBubble.querySelector(".message-body") : null;

  let streamBuffer = "";

  try {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      streamBuffer += decoder.decode(value, { stream: true });

      // While streaming, render only the text before __SOURCES__:
      const liveAnswer = streamBuffer.split("__SOURCES__:")[0];
      if (bodyEl) {
        bodyEl.innerHTML = formatAnswer(liveAnswer);
      }
      scrollToBottom();
    }

    // Flush any remaining stream bytes
    streamBuffer += decoder.decode();

    let finalAnswer = streamBuffer;
    let extractedSources = [];

    if (streamBuffer.includes("__SOURCES__:")) {
      const parts = streamBuffer.split("__SOURCES__:");
      finalAnswer = parts[0].trim();
      const rawSources = parts.slice(1).join("__SOURCES__:").trim();
      try {
        extractedSources = JSON.parse(rawSources);
      } catch (e) {
        console.warn("Failed to parse sources JSON payload:", e);
      }
    } else {
      finalAnswer = finalAnswer.trim();
    }

    if (bodyEl) {
      bodyEl.innerHTML = formatAnswer(finalAnswer);
    }
    commitHistory(query, finalAnswer);

    if (extractedSources.length > 0 && assistantBubble) {
      renderSources(assistantBubble, extractedSources);
    } else if (assistantBubble) {
      wireCitationInteractions(assistantBubble);
    }
    if (assistantBubble) {
      renderMessageActions(assistantBubble, finalAnswer, "assistant");
    }
    scrollToBottom();
  } catch (streamErr) {
    if (assistantBubble) assistantBubble.remove();
    throw streamErr;
  }
}

// --- Execution Coordinator ---
async function executeTurn(query, isNewInput = true) {
  if (isWaitingForResponse || hasActiveError || !query) return;

  if (isNewInput && userInput) {
    appendMessage("user", query);
    userInput.value = "";
    autoResizeTextarea(userInput);
  }

  lastFailedQuery = query;
  setBusy(true);
  showTypingIndicator();

  try {
    if (window.APP_CONFIG && window.APP_CONFIG.ENABLE_STREAMING) {
      await requestStream(query);
    } else {
      await requestBatch(query);
    }
    if (typeof setConnectionStatus === "function") {
      setConnectionStatus("online");
    }
    lastFailedQuery = null;
  } catch (err) {
    if (isNavigatingAway) {
      // Clean unload: user navigated away while request was in-flight. No exception or banner needed.
      return;
    }
    hideTypingIndicator();
    let msg = err.message;
    const timeoutSeconds = window.APP_CONFIG ? Math.round(window.APP_CONFIG.REQUEST_TIMEOUT_MS / 1000) : 30;
    if (err.name === "AbortError") {
      msg = `Request timed out after ${timeoutSeconds} seconds. Please retry.`;
    } else if (err.message === "Failed to fetch") {
      const apiUrl = window.APP_CONFIG ? window.APP_CONFIG.API_URL : "endpoint";
      msg = `Unable to reach ${apiUrl}. Check if backend is active.`;
    }
    if (typeof setConnectionStatus === "function") {
      setConnectionStatus("offline");
    }
    appendRetryableError(msg);
    console.error("Interaction failed:", err);
  } finally {
    setBusy(false);
    if (!hasActiveError && userInput) {
      userInput.focus();
    }
  }
}

// --- New Conversation / Reset ---
function resetConversation() {
  if (abortController) {
    try {
      abortController.abort();
    } catch (e) {}
    abortController = null;
  }
  isWaitingForResponse = false;
  setBusy(false);
  hideTypingIndicator();
  dismissActiveError();

  conversationHistory.length = 0;

  if (messageList) {
    const messages = messageList.querySelectorAll(".message, .error-banner, .retry-banner");
    messages.forEach((msg) => msg.remove());
  }

  if (emptyState) {
    emptyState.hidden = false;
  }

  if (userInput) {
    userInput.value = "";
    autoResizeTextarea(userInput);
    userInput.focus();
  }
}

// --- Prompt Parameter Prefill Handling ---
function handleUrlPromptParam() {
  if (!userInput) return;
  const params = new URLSearchParams(window.location.search);
  const promptParam = params.get("prompt");
  if (promptParam && promptParam.trim()) {
    userInput.value = promptParam.trim();
    autoResizeTextarea(userInput);
    // Focus without auto-submitting as required
    setTimeout(() => {
      userInput.focus();
      userInput.selectionStart = userInput.selectionEnd = userInput.value.length;
    }, 100);
  }
}

// --- Lifecycle Management for Barba.js & Direct Page Load ---
function initChat(container) {
  const root = container || document;

  chatForm = root.querySelector("#chat-form") || document.getElementById("chat-form");
  userInput = root.querySelector("#user-input") || document.getElementById("user-input");
  sendButton = root.querySelector("#send-button") || document.getElementById("send-button");
  messageList = root.querySelector("#message-list") || document.getElementById("message-list");
  emptyState = root.querySelector("#empty-state") || document.getElementById("empty-state");
  coldStartBanner = root.querySelector("#cold-start-banner") || document.getElementById("cold-start-banner");
  newChatBtn = root.querySelector("#new-chat-btn") || document.getElementById("new-chat-btn");

  if (!chatForm && !userInput) return;

  if (chatForm && !chatForm.dataset.chatBound) {
    chatForm.dataset.chatBound = "true";
    chatForm.addEventListener("submit", (event) => {
      event.preventDefault();
      if (hasActiveError || !userInput) return;
      const query = userInput.value.trim();
      executeTurn(query, true);
    });
  }

  if (emptyState && !emptyState.dataset.chatBound) {
    emptyState.dataset.chatBound = "true";
    emptyState.addEventListener("click", (event) => {
      if (isWaitingForResponse || hasActiveError || !userInput) return;
      const card = event.target.closest(".category-card");
      if (!card) return;
      const prompt = card.getAttribute("data-prompt");
      if (prompt) {
        userInput.value = prompt;
        autoResizeTextarea(userInput);
        executeTurn(prompt, true);
      }
    });
  }

  if (newChatBtn && !newChatBtn.dataset.chatBound) {
    newChatBtn.dataset.chatBound = "true";
    newChatBtn.addEventListener("click", resetConversation);
  }

  if (userInput && !userInput.dataset.chatBound) {
    userInput.dataset.chatBound = "true";
    userInput.addEventListener("input", () => autoResizeTextarea(userInput));

    userInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (!isWaitingForResponse && !hasActiveError) {
          const query = userInput.value.trim();
          executeTurn(query, true);
        }
      }
    });
  }

  if (userInput) {
    autoResizeTextarea(userInput);
    handleUrlPromptParam();
  }
}

function destroyChat() {
  isNavigatingAway = true;
  if (abortController) {
    try {
      abortController.abort();
    } catch (_) {}
    abortController = null;
  }
  if (coldStartTimer) {
    clearTimeout(coldStartTimer);
    coldStartTimer = null;
  }
  isWaitingForResponse = false;
  hasActiveError = false;
  setBusy(false);
}

// Auto-bootstrap on chat.html
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      if (document.getElementById("chat-form")) initChat();
    });
  } else {
    if (document.getElementById("chat-form")) initChat();
  }
  // Safely clean up in-flight requests and timers on document unload
  window.addEventListener("pagehide", destroyChat);
}

// Global interface
window.BISureChat = {
  initChat,
  destroyChat,
  getOrCreateSessionId,
  showToast,
  wireCitationInteractions
};
