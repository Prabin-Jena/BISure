// common.js — Shared Engine for BISure (all pages)
// Handles theme persistence, mobile hamburger menu navigation, and backend service health check.

// --- Theme Management ---
function getPersistedTheme() {
  try {
    const params = new URLSearchParams(window.location.search);
    const urlTheme = params.get("theme");
    if (urlTheme === "light" || urlTheme === "dark") return urlTheme;
  } catch (e) {}

  try {
    if (window.name && window.name.indexOf("bisure_theme:") !== -1) {
      const match = window.name.match(/bisure_theme:(light|dark)/);
      if (match) return match[1];
    }
  } catch (e) {}

  try {
    const stored = localStorage.getItem("bisure-theme");
    if (stored === "light" || stored === "dark") return stored;
  } catch (e) {}

  try {
    const cookieMatch = document.cookie.match(/(?:^|;\s*)bisure-theme=(light|dark)/);
    if (cookieMatch) return cookieMatch[1];
  } catch (e) {}

  return "dark";
}

function propagateThemeToLinks(theme) {
  try {
    if (window.history && window.history.replaceState) {
      const url = new URL(window.location.href);
      url.searchParams.set("theme", theme);
      window.history.replaceState(null, "", url.toString());
    }
  } catch (e) {}

  try {
    const links = document.querySelectorAll("a[href]");
    links.forEach((link) => {
      const href = link.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("http://") || href.startsWith("https://") || href.startsWith("mailto:")) {
        return;
      }
      try {
        const targetUrl = new URL(href, window.location.href);
        targetUrl.searchParams.set("theme", theme);
        const newHref = href.split("?")[0].split("#")[0] + targetUrl.search + (targetUrl.hash || "");
        link.setAttribute("href", newHref);
      } catch (err) {}
    });
  } catch (e) {}
}

function setPersistedTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);

  try {
    const baseName = window.name ? window.name.replace(/bisure_theme:(light|dark)/g, "").trim() : "";
    window.name = (baseName ? baseName + " " : "") + "bisure_theme:" + theme;
  } catch (e) {}

  try {
    localStorage.setItem("bisure-theme", theme);
  } catch (e) {}

  try {
    document.cookie = "bisure-theme=" + theme + "; path=/; max-age=31536000; SameSite=Lax";
  } catch (e) {}

  propagateThemeToLinks(theme);
}

function initializeTheme() {
  const theme = getPersistedTheme();
  setPersistedTheme(theme);
}

function initThemeToggle() {
  const themeToggle = document.getElementById("theme-toggle");
  if (!themeToggle) return;

  themeToggle.addEventListener("click", () => {
    const currentTheme = document.documentElement.getAttribute("data-theme") || "dark";
    const nextTheme = currentTheme === "dark" ? "light" : "dark";
    setPersistedTheme(nextTheme);
  });
}

// Global click capture to ensure dynamic or newly clicked navigation links carry theme
document.addEventListener("click", (e) => {
  const anchor = e.target.closest && e.target.closest("a[href]");
  if (!anchor) return;
  const href = anchor.getAttribute("href");
  if (!href || href.startsWith("#") || href.startsWith("http://") || href.startsWith("https://") || href.startsWith("mailto:")) return;

  const currentTheme = document.documentElement.getAttribute("data-theme") || "dark";
  try {
    const targetUrl = new URL(href, window.location.href);
    targetUrl.searchParams.set("theme", currentTheme);
    const newHref = href.split("?")[0].split("#")[0] + targetUrl.search + (targetUrl.hash || "");
    anchor.setAttribute("href", newHref);
  } catch (err) {}
}, true);

// Immediately apply theme
initializeTheme();

// --- Mobile Hamburger Menu Navigation ---
function initNavToggle() {
  const navToggle = document.getElementById("nav-toggle");
  const navLinks = document.getElementById("primary-nav");
  if (!navToggle || !navLinks) return;

  let backdrop = document.querySelector(".nav-backdrop");
  if (!backdrop) {
    backdrop = document.createElement("div");
    backdrop.className = "nav-backdrop";
    backdrop.setAttribute("aria-hidden", "true");
    document.body.appendChild(backdrop);
  }

  let savedBodyOverflow = "";

  function openMenu() {
    savedBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    navToggle.setAttribute("aria-expanded", "true");
    navLinks.classList.add("is-open");
    backdrop.classList.add("is-active");
  }

  function closeMenu() {
    if (savedBodyOverflow) {
      document.body.style.overflow = savedBodyOverflow;
    } else {
      document.body.style.removeProperty("overflow");
    }
    navToggle.setAttribute("aria-expanded", "false");
    navLinks.classList.remove("is-open");
    backdrop.classList.remove("is-active");
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

  // Close when backdrop is clicked
  backdrop.addEventListener("click", () => {
    closeMenu();
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
  const heroPrimaryBtn = document.querySelector(".btn-hero-primary");
  if (!connectionStatus) return;

  const label = connectionStatus.querySelector(".status-label");
  connectionStatus.classList.remove("is-checking", "is-offline");

  if (state === "online") {
    connectionStatus.title = "Local BISure service is available";
    if (label) label.textContent = "Service online";
    document.body.classList.add("service-is-online");
    document.body.classList.remove("service-is-offline");
    if (heroPrimaryBtn) {
      heroPrimaryBtn.removeAttribute("title");
      heroPrimaryBtn.removeAttribute("aria-describedby");
    }
  } else if (state === "offline") {
    connectionStatus.classList.add("is-offline");
    connectionStatus.title = "Start the local BISure backend to ask questions";
    if (label) label.textContent = "Service offline";
    document.body.classList.add("service-is-offline");
    document.body.classList.remove("service-is-online");
    if (heroPrimaryBtn) {
      heroPrimaryBtn.setAttribute("title", "Local service offline — start backend at localhost:8000 to query live assistant");
      heroPrimaryBtn.setAttribute("aria-describedby", "connection-status");
    }
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

// --- Active Navigation State Management ---
const NAMESPACE_HREF_MAP = {
  home: "index.html",
  features: "features.html",
  "how-it-works": "how-it-works.html",
  about: "about.html",
  chat: "chat.html"
};

function updateActiveNav(namespace) {
  const navLinks = document.getElementById("primary-nav");
  if (!navLinks) return;

  const targetHref = NAMESPACE_HREF_MAP[namespace];
  navLinks.querySelectorAll(".nav-link").forEach((link) => {
    const rawHref = link.getAttribute("href") || "";
    const cleanHref = rawHref.split("?")[0].split("#")[0];
    // Match either the full href or ending filename
    const isMatch = targetHref && (cleanHref === targetHref || cleanHref.endsWith("/" + targetHref));
    if (isMatch) {
      link.classList.add("nav-active");
      link.setAttribute("aria-current", "page");
    } else {
      link.classList.remove("nav-active");
      link.removeAttribute("aria-current");
    }
  });
}

function closeMobileNav() {
  const navToggle = document.getElementById("nav-toggle");
  const navLinks = document.getElementById("primary-nav");
  const backdrop = document.querySelector(".nav-backdrop");
  if (navToggle && navLinks) {
    navToggle.setAttribute("aria-expanded", "false");
    navLinks.classList.remove("is-open");
  }
  if (backdrop) {
    backdrop.classList.remove("is-active");
  }
  document.body.style.removeProperty("overflow");
}

// --- Smooth scrolling for on-page hash links ---
function initSmoothScrolling(scope) {
  const root = scope || document;
  root.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    // Avoid double-binding
    if (anchor.dataset.smoothScrollBound) return;
    anchor.dataset.smoothScrollBound = "true";

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

// Expose shared utilities on global window.BISureCommon
window.BISureCommon = {
  updateActiveNav,
  closeMobileNav,
  initSmoothScrolling,
  checkServiceHealth
};
