// frontend/console.js
// Prosta debug console dla Danaid Chat
//
// Funkcje:
// - przechwytuje console.log / warn / error i wyświetla je w overlayu
// - przycisk toggle otwiera/zamyka konsolę
// - przycisk clear czyści logi

(function () {
  const MAX_LOG_ENTRIES = 500;

  let debugConsoleEl = null;
  let logContainerEl = null;
  let toggleBtnEl = null;
  let closeBtnEl = null;
  let clearBtnEl = null;

  let isInitialized = false;

  // Zachowujemy oryginalne console.*
  const originalConsole = {
    log: window.console.log,
    warn: window.console.warn,
    error: window.console.error,
  };

  function initDebugConsole() {
    if (isInitialized) return;
    isInitialized = true;

    debugConsoleEl = document.getElementById("debug-console");
    logContainerEl = document.getElementById("debug-console-log");
    toggleBtnEl = document.getElementById("debug-console-toggle");
    closeBtnEl = document.getElementById("debug-console-close");
    clearBtnEl = document.getElementById("debug-console-clear");

    if (!debugConsoleEl || !logContainerEl) {
      originalConsole.warn(
        "[DEBUG-CONSOLE] Brak elementów #debug-console lub #debug-console-log. Debug console nieaktywna."
      );
      return;
    }

    if (toggleBtnEl) {
      toggleBtnEl.addEventListener("click", () => {
        debugConsoleEl.classList.toggle("hidden");
      });
    }

    if (closeBtnEl) {
      closeBtnEl.addEventListener("click", () => {
        debugConsoleEl.classList.add("hidden");
      });
    }

    if (clearBtnEl) {
      clearBtnEl.addEventListener("click", () => {
        clearLog();
      });
    }

    hookConsole();
    originalConsole.log("[DEBUG-CONSOLE] Zainicjalizowano debug console.");
  }

  function hookConsole() {
    window.console.log = function (...args) {
      appendLog("log", args);
      originalConsole.log.apply(window.console, args);
    };

    window.console.warn = function (...args) {
      appendLog("warn", args);
      originalConsole.warn.apply(window.console, args);
    };

    window.console.error = function (...args) {
      appendLog("error", args);
      originalConsole.error.apply(window.console, args);
    };
  }

  function appendLog(level, args) {
    if (!logContainerEl) return;

    const entry = document.createElement("div");
    entry.className = "debug-log-entry debug-log-" + level;

    const timeSpan = document.createElement("span");
    timeSpan.className = "debug-log-time";
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    timeSpan.textContent = `[${hh}:${mm}:${ss}] `;

    const msgSpan = document.createElement("span");
    msgSpan.className = "debug-log-text";

    const text = args
      .map((arg) => {
        if (typeof arg === "string") return arg;
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      })
      .join(" ");

    msgSpan.textContent = text;

    entry.appendChild(timeSpan);
    entry.appendChild(msgSpan);

    logContainerEl.appendChild(entry);

    // limit
    if (logContainerEl.childNodes.length > MAX_LOG_ENTRIES) {
      logContainerEl.removeChild(logContainerEl.firstChild);
    }

    logContainerEl.scrollTop = logContainerEl.scrollHeight;
  }

  function clearLog() {
    if (!logContainerEl) return;
    logContainerEl.innerHTML = "";
  }

  document.addEventListener("DOMContentLoaded", () => {
    initDebugConsole();
  });
})();
