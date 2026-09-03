// BISure Assistant — Frontend Engine
// Vanilla JS with theme management, streaming handling, atomic history, and error recovery.

// --- DOM References ---
const chatForm = document.getElementById("chat-form");
const userInput = document.getElementById("user-input");
const sendButton = document.getElementById("send-button");
const messageList = document.getElementById("message-list");
const emptyState = document.getElementById("empty-state");
const themeToggle = document.getElementById("theme-toggle");
const connectionStatus = document.getElementById("connection-status");

// --- Runtime State ---
let abortController = null;
let isWaitingForResponse = false;
let hasActiveError = false;
let lastFailedQuery = null;

// Only stores confirmed turns: [{ role: "user" | "assistant", content: string }]
const conversationHistory = [];

// --- Theme Management ---
function initializeTheme() {
  const storedTheme = localStorage.getItem("bisure-theme");
  if (storedTheme === "light" || storedTheme === "dark") {
    document.documentElement.setAttribute("data-theme", storedTheme);
  } else {
    // Rely on prefers-color-scheme media query initially
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches;
    document.documentElement.setAttribute(
      "data-theme",
      prefersDark ? "dark" : "light",
    );
  }
}

themeToggle.addEventListener("click", () => {
  const currentTheme =
    document.documentElement.getAttribute("data-theme") || "light";
  const nextTheme = currentTheme === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", nextTheme);
  localStorage.setItem("bisure-theme", nextTheme);
});

initializeTheme();

function setConnectionStatus(state) {
  if (!connectionStatus) return;

  const label = connectionStatus.querySelector(".status-label");
  connectionStatus.classList.remove("is-checking", "is-offline");

  if (state === "online") {
    connectionStatus.title = "Local BISure service is available";
    label.textContent = "Service online";
  } else if (state === "offline") {
    connectionStatus.classList.add("is-offline");
    connectionStatus.title = "Start the local BISure backend to ask questions";
    label.textContent = "Service offline";
  } else {
    connectionStatus.classList.add("is-checking");
    connectionStatus.title = "Checking the local BISure service";
    label.textContent = "Checking service";
  }
}

async function checkServiceHealth() {
  const healthUrl =
    window.APP_CONFIG.HEALTH_URL ||
    window.APP_CONFIG.API_URL.replace(/\/chat\/?$/, "/health");

  setConnectionStatus("checking");
  const healthController = new AbortController();
  const timeoutId = setTimeout(() => healthController.abort(), 3500);

  try {
    const response = await fetch(healthUrl, {
      cache: "no-store",
      signal: healthController.signal,
    });
    setConnectionStatus(response.ok ? "online" : "offline");
  } catch {
    setConnectionStatus("offline");
  } finally {
    clearTimeout(timeoutId);
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

  const lines = clean.split("\n");
  const output = [];
  let inList = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const isBullet = /^[*-]\s+(.+)/.test(trimmed);

    if (isBullet) {
      if (!inList) {
        output.push("<ul>");
        inList = true;
      }
      output.push(`<li>${trimmed.replace(/^[*-]\s+/, "")}</li>`);
    } else {
      if (inList) {
        output.push("</ul>");
        inList = false;
      }
      if (trimmed.length > 0) {
        output.push(`<p>${trimmed}</p>`);
      }
    }
  }

  if (inList) output.push("</ul>");
  return output.join("");
}

function autoResizeTextarea(textarea) {
  textarea.style.height = "auto";
  const maxHeight = 140;
  const newHeight = Math.min(textarea.scrollHeight, maxHeight);
  textarea.style.height = `${newHeight}px`;
  textarea.style.overflowY =
    textarea.scrollHeight > maxHeight ? "auto" : "hidden";
}

function scrollToBottom() {
  messageList.scrollTo({ top: messageList.scrollHeight, behavior: "smooth" });
}

function setBusy(busy) {
  isWaitingForResponse = busy;
  sendButton.disabled = busy;
  userInput.disabled = busy || hasActiveError;
  sendButton.setAttribute("aria-busy", busy);

  const sendIcon = sendButton.querySelector(".send-icon");
  const spinnerIcon = sendButton.querySelector(".spinner-icon");

  if (sendIcon && spinnerIcon) {
    sendIcon.hidden = busy;
    spinnerIcon.hidden = !busy;
  }
}

function setErrorLock(locked) {
  hasActiveError = locked;
  userInput.disabled = locked;
  sendButton.disabled = locked;

  if (locked) {
    userInput.dataset.originalPlaceholder = userInput.placeholder;
    userInput.placeholder =
      "Connection issue: Retry or Dismiss above before continuing...";
  } else {
    userInput.placeholder =
      userInput.dataset.originalPlaceholder ||
      "Ask about BIS standards, hallmarking rules, or certification...";
  }
}

function commitHistory(query, answer) {
  conversationHistory.push({ role: "user", content: query });
  conversationHistory.push({ role: "assistant", content: answer });

  while (conversationHistory.length > window.APP_CONFIG.MAX_HISTORY_TURNS) {
    conversationHistory.shift();
  }
}

// --- Render Elements ---
function renderSources(container, sources) {
  if (!Array.isArray(sources) || sources.length === 0) return;

  const details = document.createElement("details");
  details.className = "message-sources";

  const summary = document.createElement("summary");
  summary.className = "sources-summary";
  summary.innerHTML = `<span class="sources-badge">${sources.length}</span> Reference Standards`;
  details.appendChild(summary);

  const list = document.createElement("ul");
  list.className = "sources-list";
  sources.forEach((src) => {
    const item = document.createElement("li");
    item.className = "source-item";

    const title = document.createElement("span");
    title.className = "source-title";
    title.textContent = src.title || "Indian Standard Specification";

    if (src.snippet) {
      const snippet = document.createElement("span");
      snippet.className = "source-snippet";
      snippet.textContent = src.snippet;
      item.appendChild(title);
      item.appendChild(snippet);
    } else {
      item.appendChild(title);
    }

    list.appendChild(item);
  });

  details.appendChild(list);
  container.appendChild(details);
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
      userInput.value = rawText;
      autoResizeTextarea(userInput);
      dismissActiveError();
      container.remove();
      userInput.focus();
    });
    actionsGroup.appendChild(editBtn);
  }

  container.appendChild(actionsGroup);
}

function appendMessage(role, textContent, sources = []) {
  const wrapper = document.createElement("article");
  wrapper.className = `message message-${role}`;

  const roleLabel = document.createElement("div");
  roleLabel.className = "message-role";
  roleLabel.textContent = role === "user" ? "You" : "BIS Standards Engine";

  const body = document.createElement("div");
  body.className = "message-body";

  if (role === "user") {
    body.textContent = textContent;
  } else {
    body.innerHTML = formatAnswer(textContent);
  }

  wrapper.appendChild(roleLabel);
  wrapper.appendChild(body);

  if (role === "assistant") {
    renderSources(wrapper, sources);
  }

  renderMessageActions(wrapper, textContent, role);

  if (emptyState && !emptyState.hidden) {
    emptyState.hidden = true;
  }

  messageList.appendChild(wrapper);
  scrollToBottom();
  return wrapper;
}

function showTypingIndicator() {
  const indicator = document.createElement("article");
  indicator.className = "message message-assistant typing-indicator";
  indicator.id = "typing-indicator";
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
  `;
  messageList.appendChild(indicator);
  scrollToBottom();
}

function hideTypingIndicator() {
  const indicator = document.getElementById("typing-indicator");
  if (indicator) indicator.remove();
}

function dismissActiveError() {
  const existingNotice = messageList.querySelector(".message-system");
  if (existingNotice) existingNotice.remove();
  hasActiveError = false;
  lastFailedQuery = null;
  setErrorLock(false);
}

function appendRetryableError(errorMessage) {
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

  retryBtn.addEventListener("click", () => {
    if (isWaitingForResponse) return;
    retryBtn.disabled = true;
    const queryToRetry = lastFailedQuery;
    dismissActiveError();
    if (queryToRetry) {
      executeTurn(queryToRetry, false);
    }
  });

  dismissBtn.addEventListener("click", () => {
    dismissActiveError();
    userInput.focus();
  });
}

// --- Transports ---
async function requestBatch(query) {
  abortController = new AbortController();
  const timeoutId = setTimeout(
    () => abortController.abort(),
    window.APP_CONFIG.REQUEST_TIMEOUT_MS,
  );

  const payload = {
    query,
    history: conversationHistory,
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

  hideTypingIndicator();
  commitHistory(query, answer);
  appendMessage("assistant", answer, sources);
}

async function requestStream(query) {
  abortController = new AbortController();
  const timeoutId = setTimeout(
    () => abortController.abort(),
    window.APP_CONFIG.REQUEST_TIMEOUT_MS,
  );

  const payload = {
    query,
    history: conversationHistory,
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

  hideTypingIndicator();

  const assistantBubble = appendMessage("assistant", "");
  const bodyEl = assistantBubble.querySelector(".message-body");

  let accumulatedText = "";
  let extractedSources = [];

  try {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });

      if (chunk.includes("__SOURCES__:")) {
        const parts = chunk.split("__SOURCES__:");
        accumulatedText += parts[0];
        try {
          extractedSources = JSON.parse(parts[1]);
        } catch (e) {
          console.warn("Failed to parse sources frame:", e);
        }
      } else {
        accumulatedText += chunk;
      }

      bodyEl.innerHTML = formatAnswer(accumulatedText);
      scrollToBottom();
    }

    commitHistory(query, accumulatedText);
    renderMessageActions(assistantBubble, accumulatedText, "assistant");

    if (extractedSources.length > 0) {
      renderSources(assistantBubble, extractedSources);
    }
  } catch (streamErr) {
    assistantBubble.remove();
    throw streamErr;
  }
}

// --- Execution Coordinator ---
async function executeTurn(query, isNewInput = true) {
  if (isWaitingForResponse || hasActiveError || !query) return;

  if (isNewInput) {
    appendMessage("user", query);
    userInput.value = "";
    autoResizeTextarea(userInput);
  }

  lastFailedQuery = query;
  setBusy(true);
  showTypingIndicator();

  try {
    if (window.APP_CONFIG.ENABLE_STREAMING) {
      await requestStream(query);
    } else {
      await requestBatch(query);
    }
    setConnectionStatus("online");
    lastFailedQuery = null;
  } catch (err) {
    hideTypingIndicator();
    let msg = err.message;
    if (err.name === "AbortError") {
      msg = `Request timed out after ${Math.round(window.APP_CONFIG.REQUEST_TIMEOUT_MS / 1000)} seconds. Please retry.`;
    } else if (err.message === "Failed to fetch") {
      msg = `Unable to reach ${window.APP_CONFIG.API_URL}. Check if backend is active.`;
    }
    setConnectionStatus("offline");
    appendRetryableError(msg);
    console.error("Interaction failed:", err);
  } finally {
    setBusy(false);
    if (!hasActiveError) {
      userInput.focus();
    }
  }
}

// --- Listeners ---
chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (hasActiveError) return;
  const query = userInput.value.trim();
  executeTurn(query, true);
});

emptyState.addEventListener("click", (event) => {
  if (isWaitingForResponse || hasActiveError) return;
  const card = event.target.closest(".category-card");
  if (!card) return;
  const prompt = card.getAttribute("data-prompt");
  if (prompt) {
    userInput.value = prompt;
    autoResizeTextarea(userInput);
    executeTurn(prompt, true);
  }
});

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

autoResizeTextarea(userInput);
checkServiceHealth();
