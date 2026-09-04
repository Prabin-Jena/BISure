// common.js — Shared Engine for BISure (all pages)
// Handles theme persistence, mobile hamburger menu navigation, and backend service health check.

// --- Theme Management ---
function initializeTheme() {
  const storedTheme = localStorage.getItem("bisure-theme");
  if (storedTheme === "light" || storedTheme === "dark") {
    document.documentElement.setAttribute("data-theme", storedTheme);
  } else {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.setAttribute(
      "data-theme",
      prefersDark ? "dark" : "light"
    );
  }
}

function initThemeToggle() {
  const themeToggle = document.getElementById("theme-toggle");
  if (!themeToggle) return;

  themeToggle.addEventListener("click", () => {
    const currentTheme = document.documentElement.getAttribute("data-theme") || "light";
    const nextTheme = currentTheme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", nextTheme);
    localStorage.setItem("bisure-theme", nextTheme);
  });
}

// Immediately apply theme to prevent flash of unstyled theme
initializeTheme();

// --- Mobile Hamburger Menu Navigation ---
function initNavToggle() {
  const navToggle = document.getElementById("nav-toggle");
  const navLinks = document.getElementById("primary-nav");
  if (!navToggle || !navLinks) return;

  function openMenu() {
    navToggle.setAttribute("aria-expanded", "true");
    navLinks.classList.add("is-open");
  }

  function closeMenu() {
    navToggle.setAttribute("aria-expanded", "false");
    navLinks.classList.remove("is-open");
  }

  function toggleMenu() {
    const isExpanded = navToggle.getAttribute("aria-expanded") === "true";
    if (isExpanded) {
      closeMenu();
    } else {
      openMenu();
    }
  }

  navToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMenu();
  });

  // Close on link selection
  navLinks.querySelectorAll(".nav-link").forEach((link) => {
    link.addEventListener("click", () => {
      closeMenu();
    });
  });

  // Close on outside click
  document.addEventListener("click", (e) => {
    if (navToggle.getAttribute("aria-expanded") === "true") {
      if (!navLinks.contains(e.target) && !navToggle.contains(e.target)) {
        closeMenu();
      }
    }
  });

  // Keyboard accessibility: Escape closes menu; focus trapped while open
  document.addEventListener("keydown", (e) => {
    const isOpen = navToggle.getAttribute("aria-expanded") === "true";
    if (!isOpen) return;

    if (e.key === "Escape") {
      e.preventDefault();
      closeMenu();
      navToggle.focus();
      return;
    }

    if (e.key === "Tab") {
      const focusableElements = [
        navToggle,
        ...Array.from(navLinks.querySelectorAll("a[href], button:not([disabled])"))
      ];
      if (focusableElements.length === 0) return;

      const firstEl = focusableElements[0];
      const lastEl = focusableElements[focusableElements.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        }
      } else {
        if (document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    }
  });
}

// --- Backend Health Status Indicator ---
function setConnectionStatus(state) {
  const connectionStatus = document.getElementById("connection-status");
  if (!connectionStatus) return;

  const label = connectionStatus.querySelector(".status-label");
  connectionStatus.classList.remove("is-checking", "is-offline");

  if (state === "online") {
    connectionStatus.title = "Local BISure service is available";
    if (label) label.textContent = "Service online";
  } else if (state === "offline") {
    connectionStatus.classList.add("is-offline");
    connectionStatus.title = "Start the local BISure backend to ask questions";
    if (label) label.textContent = "Service offline";
  } else {
    connectionStatus.classList.add("is-checking");
    connectionStatus.title = "Checking the local BISure service";
    if (label) label.textContent = "Checking service";
  }
}

async function checkServiceHealth() {
  if (!window.APP_CONFIG) return;

  const healthUrl =
    window.APP_CONFIG.HEALTH_URL ||
    (window.APP_CONFIG.API_URL ? window.APP_CONFIG.API_URL.replace(/\/chat\/?$/, "/health") : null);

  if (!healthUrl) return;

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

// --- Smooth scrolling for on-page hash links ---
function initSmoothScrolling() {
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener("click", function (e) {
      const targetId = this.getAttribute("href");
      if (targetId === "#" || !targetId) return;

      const targetEl = document.querySelector(targetId);
      if (targetEl) {
        e.preventDefault();
        targetEl.scrollIntoView({ behavior: "smooth" });
      }
    });
  });
}

// --- DOM Ready Bootstrap ---
document.addEventListener("DOMContentLoaded", () => {
  initThemeToggle();
  initNavToggle();
  initSmoothScrolling();
  checkServiceHealth();
});
