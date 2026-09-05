/**
 * motion.js — BISure Reusable Animation Infrastructure (Phase 3)
 * 
 * Strict Vanilla Architecture:
 * - Pure Web APIs (IntersectionObserver, requestAnimationFrame, Web Animations API, MatchMedia)
 * - Zero external animation libraries (No GSAP, Framer Motion, Lenis, etc.)
 * - Animates only transform and opacity (GPU accelerated, avoids layout thrashing)
 * - Accessible: Fully honors prefers-reduced-motion in both JS logic and CSS
 * 
 * Exports to global `window.BISureMotion`:
 *   - prefersReducedMotion: Live detector and subscriber for OS motion preferences
 *   - createSectionObserver: Optimized IntersectionObserver for enter/exit reveal states
 *   - createScrollProgress: Single rAF-throttled scroll manager with geometry caching
 */

(function (root, factory) {
  if (typeof define === "function" && define.amd) {
    define([], factory);
  } else if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.BISureMotion = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ==========================================================================
  // 1. PREFERS-REDUCED-MOTION DETECTOR
  // ==========================================================================
  const reducedMotionQuery = typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;

  let isReducedMotion = reducedMotionQuery ? reducedMotionQuery.matches : false;
  const motionListeners = new Set();

  function notifyMotionListeners(reduced) {
    motionListeners.forEach(function (callback) {
      try {
        callback(reduced);
      } catch (err) {
        console.warn("[BISureMotion] Error in reduced-motion listener:", err);
      }
    });
  }

  if (reducedMotionQuery) {
    if (typeof reducedMotionQuery.addEventListener === "function") {
      reducedMotionQuery.addEventListener("change", function (e) {
        isReducedMotion = Boolean(e.matches);
        notifyMotionListeners(isReducedMotion);
      });
    } else if (typeof reducedMotionQuery.addListener === "function") {
      reducedMotionQuery.addListener(function (e) {
        isReducedMotion = Boolean(e.matches);
        notifyMotionListeners(isReducedMotion);
      });
    }
  }

  const prefersReducedMotion = {
    /**
     * Current boolean state of prefers-reduced-motion.
     * @returns {boolean}
     */
    matches: function () {
      return isReducedMotion;
    },

    get value() {
      return isReducedMotion;
    },

    /**
     * Subscribe to changes in user motion preference.
     * @param {function(boolean): void} callback 
     * @returns {function(): void} Unsubscribe function
     */
    subscribe: function (callback) {
      if (typeof callback !== "function") return function () {};
      motionListeners.add(callback);
      // Immediately invoke with current state
      callback(isReducedMotion);
      return function () {
        motionListeners.delete(callback);
      };
    }
  };

  // ==========================================================================
  // 2. INTERSECTION OBSERVER UTILITY (Section Enter / Reveal States)
  // ==========================================================================
  /**
   * Creates an IntersectionObserver tailored for section and element reveals.
   * Adds active class to elements when they scroll into view.
   * 
   * @param {Object} options
   * @param {string|Element|null} [options.root=null] - Viewport root
   * @param {string} [options.rootMargin="0px 0px -10% 0px"] - Margin around root
   * @param {number|number[]} [options.threshold=0.15] - Threshold for intersection
   * @param {string} [options.activeClass="reveal--active"] - Class added when in view
   * @param {string} [options.inviewClass="is-inview"] - Secondary alias class
   * @param {boolean} [options.once=true] - If true, unobserves after first trigger
   * @param {function(IntersectionObserverEntry, Element, IntersectionObserver): void} [options.onEnter]
   * @param {function(IntersectionObserverEntry, Element, IntersectionObserver): void} [options.onExit]
   * @returns {Object} { observe, unobserve, disconnect, isSupported }
   */
  const activeSectionObservers = new Set();

  function createSectionObserver(options) {
    options = options || {};
    const rootMargin = options.rootMargin || "0px 0px -5% 0px";
    const threshold = options.threshold !== undefined ? options.threshold : 0.15;
    const activeClass = options.activeClass || "reveal--active";
    const inviewClass = options.inviewClass || "is-inview";
    const once = options.once !== undefined ? options.once : true;
    const onEnter = typeof options.onEnter === "function" ? options.onEnter : null;
    const onExit = typeof options.onExit === "function" ? options.onExit : null;

    const hasObserver = typeof window !== "undefined" && "IntersectionObserver" in window;

    // Direct helper to activate an element immediately
    function activateElement(el, entry) {
      el.classList.add(activeClass);
      if (inviewClass) el.classList.add(inviewClass);
      if (onEnter) onEnter(entry || null, el, observerInstance);
    }

    function deactivateElement(el, entry) {
      if (!once) {
        el.classList.remove(activeClass);
        if (inviewClass) el.classList.remove(inviewClass);
        if (onExit) onExit(entry || null, el, observerInstance);
      }
    }

    let observerInstance = null;

    if (hasObserver) {
      observerInstance = new IntersectionObserver(function (entries, obs) {
        entries.forEach(function (entry) {
          const el = entry.target;
          if (entry.isIntersecting) {
            activateElement(el, entry);
            if (once) {
              obs.unobserve(el);
            }
          } else {
            deactivateElement(el, entry);
          }
        });
      }, {
        root: options.root || null,
        rootMargin: rootMargin,
        threshold: threshold
      });
    }

    function resolveTargets(target) {
      if (!target) return [];
      if (typeof target === "string") {
        return Array.from(document.querySelectorAll(target));
      }
      if (target instanceof Element) {
        return [target];
      }
      if (target instanceof NodeList || Array.isArray(target)) {
        return Array.from(target).filter(function (n) {
          return n instanceof Element;
        });
      }
      return [];
    }

    const observerHandle = {
      isSupported: hasObserver,

      /**
       * Observe one or more elements.
       * @param {string|Element|NodeList|Element[]} target
       */
      observe: function (target) {
        const elements = resolveTargets(target);
        elements.forEach(function (el) {
          // If reduced motion is active or IntersectionObserver is not supported,
          // activate immediately with no delay or jump.
          if (prefersReducedMotion.matches() || !hasObserver) {
            activateElement(el, null);
            return;
          }
          if (observerInstance) {
            observerInstance.observe(el);
          }
        });
      },

      /**
       * Unobserve one or more elements.
       * @param {string|Element|NodeList|Element[]} target
       */
      unobserve: function (target) {
        if (!observerInstance) return;
        const elements = resolveTargets(target);
        elements.forEach(function (el) {
          observerInstance.unobserve(el);
        });
      },

      /**
       * Disconnect the observer completely.
       */
      disconnect: function () {
        activeSectionObservers.delete(observerHandle);
        if (observerInstance) {
          observerInstance.disconnect();
        }
      }
    };

    activeSectionObservers.add(observerHandle);
    return observerHandle;
  }

  // ==========================================================================
  // 3. OPTIMIZED rAF SCROLL PROGRESS ENGINE
  // ==========================================================================
  /**
   * A single, shared, high-efficiency requestAnimationFrame scroll-progress utility.
   * Avoids attaching expensive calculations to raw scroll events.
   * Caches element geometry upon resize and updates progress once per frame only when dirty.
   */
  function createScrollManager() {
    const trackedItems = new Map();
    const globalSubscribers = new Set();
    let isListening = false;
    let isTicking = false;
    let cachedViewportHeight = typeof window !== "undefined" ? window.innerHeight : 800;
    let cachedScrollY = typeof window !== "undefined" ? window.scrollY || window.pageYOffset || 0 : 0;
    let cachedDocHeight = 1000;

    function measureViewport() {
      if (typeof window === "undefined") return;
      cachedViewportHeight = window.innerHeight || document.documentElement.clientHeight;
      cachedDocHeight = Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
        document.body.offsetHeight,
        document.documentElement.offsetHeight,
        document.documentElement.clientHeight
      );
    }

    function measureItem(item) {
      if (!item.element || !item.element.isConnected) return false;
      const rect = item.element.getBoundingClientRect();
      const scrollY = window.scrollY || window.pageYOffset || 0;
      item.top = rect.top + scrollY;
      item.height = item.element.offsetHeight || rect.height;
      return true;
    }

    function refreshAllGeometry() {
      measureViewport();
      trackedItems.forEach(function (item, element) {
        if (!measureItem(item)) {
          trackedItems.delete(element);
        }
      });
      requestTick();
    }

    function onScrollPassive() {
      cachedScrollY = window.scrollY || window.pageYOffset || 0;
      requestTick();
    }

    let resizeDebounceTimer = null;
    function onResizePassive() {
      clearTimeout(resizeDebounceTimer);
      resizeDebounceTimer = setTimeout(function () {
        refreshAllGeometry();
      }, 100);
    }

    function requestTick() {
      if (!isTicking) {
        isTicking = true;
        if (typeof window !== "undefined" && window.requestAnimationFrame) {
          window.requestAnimationFrame(updateProgress);
        } else {
          setTimeout(updateProgress, 16);
        }
      }
    }

    function clamp01(val) {
      return Math.max(0, Math.min(1, val));
    }

    function updateProgress() {
      isTicking = false;
      const scrollY = cachedScrollY;
      const vh = cachedViewportHeight;
      const maxScroll = Math.max(1, cachedDocHeight - vh);
      const globalProgress = clamp01(scrollY / maxScroll);

      // If user prefers reduced motion, push terminal progress and avoid churn
      const reduced = prefersReducedMotion.matches();

      // 1. Notify global scroll progress subscribers
      globalSubscribers.forEach(function (cb) {
        try {
          cb({
            scrollY: scrollY,
            maxScroll: maxScroll,
            progress: reduced ? 1.0 : globalProgress
          });
        } catch (err) {
          console.warn("[BISureMotion] Error in global scroll subscriber:", err);
        }
      });

      // 2. Compute progress for tracked element targets
      trackedItems.forEach(function (item) {
        if (reduced) {
          if (item.lastProgress !== 1.0) {
            item.lastProgress = 1.0;
            item.callback({
              progress: 1.0,
              rawProgress: 1.0,
              inView: true,
              scrollY: scrollY,
              element: item.element
            });
          }
          return;
        }

        const top = item.top;
        const height = item.height;
        const range = item.options.range || "enter-to-exit";

        let startY = 0;
        let endY = 1;

        if (range === "enter-to-exit") {
          // 0.0 when top of element enters bottom of viewport
          // 1.0 when bottom of element leaves top of viewport
          startY = top - vh;
          endY = top + height;
        } else if (range === "enter-to-center") {
          // 0.0 when top enters bottom
          // 1.0 when element is centered in viewport
          startY = top - vh;
          endY = top + (height / 2) - (vh / 2);
        } else if (range === "center-to-exit") {
          // 0.0 when element is centered
          // 1.0 when bottom leaves top
          startY = top + (height / 2) - (vh / 2);
          endY = top + height;
        } else if (range === "top-to-top") {
          // 0.0 when top of element reaches top of viewport
          // 1.0 when bottom of element reaches top of viewport
          startY = top;
          endY = top + height;
        }

        const distance = Math.max(1, endY - startY);
        const rawProgress = (scrollY - startY) / distance;
        const progress = clamp01(rawProgress);
        const inView = rawProgress >= 0 && rawProgress <= 1;

        // Dispatch callback only if progress changed noticeably (>= 0.0005) or inView toggled
        const delta = Math.abs(progress - (item.lastProgress !== null ? item.lastProgress : -1));
        if (delta >= 0.0005 || inView !== item.lastInView) {
          item.lastProgress = progress;
          item.lastInView = inView;
          try {
            item.callback({
              progress: progress,
              rawProgress: rawProgress,
              inView: inView,
              scrollY: scrollY,
              element: item.element
            });
          } catch (err) {
            console.warn("[BISureMotion] Error in tracked element callback:", err);
          }
        }
      });
    }

    function ensureListeners() {
      if (isListening || typeof window === "undefined") return;
      isListening = true;
      measureViewport();
      window.addEventListener("scroll", onScrollPassive, { passive: true });
      window.addEventListener("resize", onResizePassive, { passive: true });
    }

    function removeListenersIfIdle() {
      if (!isListening) return;
      if (trackedItems.size === 0 && globalSubscribers.size === 0) {
        window.removeEventListener("scroll", onScrollPassive);
        window.removeEventListener("resize", onResizePassive);
        isListening = false;
      }
    }

    return {
      /**
       * Track scroll progress for a specific DOM element.
       * @param {Element|string} elementOrSelector
       * @param {function(Object): void} callback
       * @param {Object} [options]
       * @param {"enter-to-exit"|"enter-to-center"|"center-to-exit"|"top-to-top"} [options.range="enter-to-exit"]
       * @returns {function(): void} Untrack function
       */
      track: function (elementOrSelector, callback, options) {
        if (typeof window === "undefined") return function () {};
        const el = typeof elementOrSelector === "string"
          ? document.querySelector(elementOrSelector)
          : elementOrSelector;

        if (!el || !(el instanceof Element) || typeof callback !== "function") {
          return function () {};
        }

        ensureListeners();

        const item = {
          element: el,
          callback: callback,
          options: options || {},
          top: 0,
          height: 0,
          lastProgress: null,
          lastInView: null
        };

        measureItem(item);
        trackedItems.set(el, item);

        // Immediate tick to evaluate initial state
        requestTick();

        return function () {
          trackedItems.delete(el);
          removeListenersIfIdle();
        };
      },

      /**
       * Subscribe to continuous global document scroll progress.
       * @param {function(Object): void} callback
       * @returns {function(): void} Unsubscribe function
       */
      subscribe: function (callback) {
        if (typeof callback !== "function") return function () {};
        ensureListeners();
        globalSubscribers.add(callback);
        requestTick();

        return function () {
          globalSubscribers.delete(callback);
          removeListenersIfIdle();
        };
      },

      /**
       * Manually trigger a recalculation of all cached element bounds (e.g. after DOM mutation).
       */
      refresh: function () {
        refreshAllGeometry();
      },

      /**
       * Destroy all listeners and cleanup.
       */
      destroy: function () {
        if (typeof window === "undefined") return;
        window.removeEventListener("scroll", onScrollPassive);
        window.removeEventListener("resize", onResizePassive);
        trackedItems.clear();
        globalSubscribers.clear();
        isListening = false;
        isTicking = false;
      }
    };
  }

  // Singleton instance of the scroll manager for performance efficiency
  let sharedScrollManager = null;
  function getScrollManager() {
    if (!sharedScrollManager) {
      sharedScrollManager = createScrollManager();
    }
    return sharedScrollManager;
  }

  // ==========================================================================
  // 4. NARRATIVE PROGRESSION CONTROLLER (Phase 4)
  // Gated by IntersectionObserver. Pauses when offscreen.
  // Strictly excludes Chapter 4 evidence-graph hover interactions (Phase 5).
  // ==========================================================================
  function initNarrativeAnimations(container) {
    if (typeof document === "undefined") return;

    const root = container || document;
    const reduced = prefersReducedMotion.matches();

    // ------------------------------------------------------------------------
    // Chapter 1: Hero Pipeline Sequence
    // ------------------------------------------------------------------------
    const heroSection = root.querySelector ? root.querySelector("#hero") : document.getElementById("hero");
    const pipelinePreview = root.querySelector ? root.querySelector(".hero-pipeline-preview") : document.querySelector(".hero-pipeline-preview");
    const pipelineSteps = root.querySelectorAll ? root.querySelectorAll(".hero-pipeline-preview .pipeline-step") : document.querySelectorAll(".hero-pipeline-preview .pipeline-step");

    if (heroSection && pipelineSteps.length > 0) {
      if (reduced) {
        if (pipelinePreview) pipelinePreview.classList.add("pipeline-settled");
        pipelineSteps.forEach(function (s) {
          s.classList.add("step-active");
        });
      } else {
        let heroTimer = null;
        let currentStepIndex = 0;
        let isHeroRunning = false;

        function runHeroStep() {
          if (!isHeroRunning) return;
          if (currentStepIndex < pipelineSteps.length) {
            pipelineSteps[currentStepIndex].classList.add("step-active");
            currentStepIndex++;
            heroTimer = setTimeout(runHeroStep, 420);
          } else {
            // Sequence completed: settle into stable rest mode
            if (pipelinePreview) pipelinePreview.classList.add("pipeline-settled");
          }
        }

        function startHeroSequence() {
          if (isHeroRunning) return;
          isHeroRunning = true;
          currentStepIndex = 0;
          if (pipelinePreview) pipelinePreview.classList.remove("pipeline-settled");
          pipelineSteps.forEach(function (s) {
            s.classList.remove("step-active");
          });
          heroTimer = setTimeout(runHeroStep, 180);
        }

        function stopHeroSequence() {
          isHeroRunning = false;
          clearTimeout(heroTimer);
        }

        const heroObserver = createSectionObserver({
          rootMargin: "0px 0px -5% 0px",
          threshold: 0.2,
          once: false,
          onEnter: function () {
            startHeroSequence();
          },
          onExit: function () {
            stopHeroSequence();
          }
        });
        heroObserver.observe(heroSection);
      }
    }

    // ------------------------------------------------------------------------
    // Chapter 2: The Problem (Progressive reveal of information nodes)
    // ------------------------------------------------------------------------
    const problemSection = document.getElementById("problem");
    if (problemSection) {
      const problemObserver = createSectionObserver({
        threshold: 0.15,
        once: true
      });
      problemObserver.observe(problemSection);
    }

    // ------------------------------------------------------------------------
    // Chapter 3: Retrieval (Chaos-to-Structure Transition)
    // ------------------------------------------------------------------------
    const retrievalSection = document.getElementById("retrieval");
    if (retrievalSection) {
      const retrievalObserver = createSectionObserver({
        threshold: 0.15,
        once: true
      });
      retrievalObserver.observe(retrievalSection);
    }

    // ------------------------------------------------------------------------
    // Chapter 5: Grounded Response (Evidence Tethering)
    // ------------------------------------------------------------------------
    const responseSection = document.getElementById("grounded-response");
    if (responseSection) {
      const citationRefs = responseSection.querySelectorAll(".citation-ref");
      const drawerItems = responseSection.querySelectorAll(".drawer-item");

      function parseRefNumber(el) {
        const text = el.textContent || "";
        const m = text.match(/\[(\d+)\]/);
        return m ? m[1] : null;
      }

      function toggleCitationTether(numStr, isActive) {
        citationRefs.forEach(function (ref) {
          if (parseRefNumber(ref) === numStr) {
            ref.classList.toggle("is-tethered", isActive);
          }
        });
        drawerItems.forEach(function (item) {
          const itemRef = item.querySelector(".citation-ref");
          if (itemRef && parseRefNumber(itemRef) === numStr) {
            item.classList.toggle("is-tethered", isActive);
          }
        });
      }

      const responseObserver = createSectionObserver({
        threshold: 0.15,
        once: true,
        onEnter: function () {
          if (!reduced) {
            // Introductory visual demonstration pulse across citations
            setTimeout(function () { toggleCitationTether("01", true); }, 650);
            setTimeout(function () { toggleCitationTether("01", false); }, 1300);
            setTimeout(function () { toggleCitationTether("02", true); }, 1450);
            setTimeout(function () { toggleCitationTether("02", false); }, 2100);
          }
        }
      });
      responseObserver.observe(responseSection);

      // Interactive hover & focus tethering
      citationRefs.forEach(function (ref) {
        const num = parseRefNumber(ref);
        if (!num) return;
        ref.addEventListener("mouseenter", function () { toggleCitationTether(num, true); });
        ref.addEventListener("mouseleave", function () { toggleCitationTether(num, false); });
        ref.addEventListener("focus", function () { toggleCitationTether(num, true); });
        ref.addEventListener("blur", function () { toggleCitationTether(num, false); });
        ref.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            const isCurrentlyTethered = ref.classList.contains("is-tethered");
            toggleCitationTether(num, !isCurrentlyTethered);
          }
        });
      });

      drawerItems.forEach(function (item) {
        const itemRef = item.querySelector(".citation-ref");
        const num = itemRef ? parseRefNumber(itemRef) : null;
        if (!num) return;
        item.addEventListener("mouseenter", function () { toggleCitationTether(num, true); });
        item.addEventListener("mouseleave", function () { toggleCitationTether(num, false); });
      });
    }

    // ------------------------------------------------------------------------
    // Chapter 4: Evidence Connection Graph & Interactive Hover/Focus (Phase 5)
    // ------------------------------------------------------------------------
    const evidenceSection = document.getElementById("evidence");
    if (evidenceSection) {
      const claimHub = evidenceSection.querySelector(".evidence-claim-hub");
      const branchCards = evidenceSection.querySelectorAll(".evidence-branch-card");
      const svgPaths = evidenceSection.querySelectorAll(".evidence-svg-canvas path");

      let pinnedBranch = null;

      // Initialize path stroke dasharrays
      svgPaths.forEach(function (p) {
        let len = 320;
        try {
          if (typeof p.getTotalLength === "function") {
            len = Math.ceil(p.getTotalLength());
          }
        } catch (e) {
          len = 320;
        }
        if (reduced) {
          p.style.strokeDasharray = "none";
          p.style.strokeDashoffset = "0";
        } else {
          p.style.strokeDasharray = len;
          p.style.strokeDashoffset = len;
        }
      });

      // Gated Section Entrance: Animate paths drawing from claim hub to branches
      const evidenceObserver = createSectionObserver({
        threshold: 0.15,
        once: true,
        onEnter: function () {
          if (!reduced) {
            svgPaths.forEach(function (p, idx) {
              p.style.transition = "stroke-dashoffset 850ms cubic-bezier(0.16, 1, 0.3, 1) " + (idx * 120) + "ms, stroke 250ms, stroke-width 250ms, opacity 250ms, filter 250ms";
              p.style.strokeDashoffset = "0";
            });
          }
        }
      });
      evidenceObserver.observe(evidenceSection);

      function highlightBranch(branchId) {
        if (!branchId) {
          resetGraph();
          return;
        }
        // Highlight active branch card, dim others
        branchCards.forEach(function (card) {
          const id = card.getAttribute("data-branch");
          if (id === branchId) {
            card.classList.add("is-active");
            card.classList.remove("is-dimmed");
            card.setAttribute("aria-pressed", "true");
          } else {
            card.classList.remove("is-active");
            card.classList.add("is-dimmed");
            card.setAttribute("aria-pressed", "false");
          }
        });

        // Brighten corresponding SVG path, dim others
        svgPaths.forEach(function (path) {
          const id = path.getAttribute("data-branch");
          if (id === branchId) {
            path.classList.add("is-active");
            path.classList.remove("is-dimmed");
          } else {
            path.classList.remove("is-active");
            path.classList.add("is-dimmed");
          }
        });

        if (claimHub) {
          claimHub.classList.add("is-active-branch");
        }
      }

      function highlightAllBranches() {
        branchCards.forEach(function (card) {
          card.classList.add("is-active");
          card.classList.remove("is-dimmed");
        });
        svgPaths.forEach(function (path) {
          path.classList.add("is-active");
          path.classList.remove("is-dimmed");
        });
        if (claimHub) {
          claimHub.classList.add("is-all-active");
        }
      }

      function resetGraph() {
        if (pinnedBranch) {
          highlightBranch(pinnedBranch);
          return;
        }
        branchCards.forEach(function (card) {
          card.classList.remove("is-active", "is-dimmed");
          card.setAttribute("aria-pressed", "false");
        });
        svgPaths.forEach(function (path) {
          path.classList.remove("is-active", "is-dimmed");
        });
        if (claimHub) {
          claimHub.classList.remove("is-active-branch", "is-all-active");
        }
      }

      // Hover and keyboard focus listeners on branch cards
      branchCards.forEach(function (card) {
        const id = card.getAttribute("data-branch");

        card.addEventListener("mouseenter", function () {
          if (!pinnedBranch) highlightBranch(id);
        });
        card.addEventListener("mouseleave", function () {
          if (!pinnedBranch) resetGraph();
        });

        card.addEventListener("focus", function () {
          highlightBranch(id);
        });
        card.addEventListener("blur", function () {
          if (!pinnedBranch) resetGraph();
        });

        // Touch & click support: tap to toggle pin
        card.addEventListener("click", function () {
          if (pinnedBranch === id) {
            pinnedBranch = null;
            resetGraph();
          } else {
            pinnedBranch = id;
            highlightBranch(id);
          }
        });

        // Keyboard Enter / Space support
        card.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (pinnedBranch === id) {
              pinnedBranch = null;
              resetGraph();
            } else {
              pinnedBranch = id;
              highlightBranch(id);
            }
          }
        });
      });

      // Claim Hub hover and keyboard focus
      if (claimHub) {
        claimHub.addEventListener("mouseenter", function () {
          if (!pinnedBranch) highlightAllBranches();
        });
        claimHub.addEventListener("mouseleave", function () {
          if (!pinnedBranch) resetGraph();
        });
        claimHub.addEventListener("focus", function () {
          if (!pinnedBranch) highlightAllBranches();
        });
        claimHub.addEventListener("blur", function () {
          if (!pinnedBranch) resetGraph();
        });
      }

      // Touch outside to dismiss pinned state
      document.addEventListener("click", function (e) {
        if (pinnedBranch && !evidenceSection.contains(e.target)) {
          pinnedBranch = null;
          resetGraph();
        }
      });
    }

    // ------------------------------------------------------------------------
    // Chapter 6: Safety Fallback (Meter & Refusal)
    // ------------------------------------------------------------------------
    const fallbackSection = document.getElementById("safety-fallback");
    if (fallbackSection) {
      const meterScore = fallbackSection.querySelector(".meter-score");
      const fallbackObserver = createSectionObserver({
        threshold: 0.2,
        once: true,
        onEnter: function () {
          if (meterScore && !reduced) {
            setTimeout(function () {
              meterScore.textContent = "22% • INSUFFICIENT SUPPORT";
              meterScore.style.color = "var(--color-error)";
            }, 850);
          }
        }
      });
      fallbackObserver.observe(fallbackSection);
    }

    // ------------------------------------------------------------------------
    // Chapter 8: BISure inside BISure Mini-Simulation (Phase 5)
    // Purely deterministic controlled dataset, zero external network calls.
    // ------------------------------------------------------------------------
    const traceSection = document.getElementById("system-trace");
    if (traceSection) {
      const scenarioButtons = traceSection.querySelectorAll(".scenario-btn");
      const replayBtn = traceSection.querySelector("#btn-replay-trace");
      const stepItems = traceSection.querySelectorAll(".trace-step-item");

      const traceDatasets = {
        gold: [
          {
            name: "Query Processing",
            text: '"Can a jeweler sell 20-carat gold jewellery with an authentic BIS hallmark?"'
          },
          {
            name: "ChromaDB Retrieval",
            text: "Query embedded via sentence-transformers; top-k semantic search matches IS 1417:2016 (similarity 0.91) and Hallmarking Directive 2021 (similarity 0.86)."
          },
          {
            name: "Corpus Chunk Assembly",
            text: "Retrieved context identifies six recognized purity grades: 14K (585), 18K (750), 20K (833), 22K (916), 23K (958), and 24K (999)."
          },
          {
            name: "Constraint Verification",
            text: "Clause 4.1.2 explicitly validates 20K (833 fineness) under the amended hallmarking directives, confirming applicability alongside 22K and 18K."
          },
          {
            name: "Synthesized Response",
            text: '"Yes. Under IS 1417 (as amended in 2021), 20-carat gold (833 fineness) is officially recognized for mandatory hallmarking alongside 14K, 18K, 22K, 23K, and 24K [01]."'
          }
        ],
        electronics: [
          {
            name: "Query Processing",
            text: '"Is BIS certification mandatory for mobile phone chargers under Scheme-I or Scheme-II?"'
          },
          {
            name: "ChromaDB Retrieval",
            text: "Cosine retrieval across MeitY Orders identifies Electronics & IT Goods (Requirement for Compulsory Registration) Order (similarity 0.94)."
          },
          {
            name: "Corpus Chunk Assembly",
            text: "Retrieved Gazette Notification S.O. 2357(E), Schedule Item 1: Power Adapters for IT & Telecommunication Equipment."
          },
          {
            name: "Constraint Verification",
            text: "Clause links charger electrical safety verification to test standard IS 13252 (Part 1):2010, confirming CRS registration requirement."
          },
          {
            name: "Synthesized Response",
            text: '"Mobile phone adapters and chargers fall strictly under Scheme-II (CRS) under IS 13252 (Part 1). Factory audit Scheme-I (ISI) is not applicable [01]."'
          }
        ]
      };

      let activeScenario = "gold";
      let simTimer = null;

      function renderScenarioContent(key) {
        const data = traceDatasets[key];
        if (!data) return;
        stepItems.forEach(function (item, idx) {
          const itemData = data[idx];
          if (!itemData) return;
          const nameEl = item.querySelector(".trace-step-name");
          const textEl = item.querySelector(".trace-step-text");
          if (nameEl) nameEl.textContent = itemData.name;
          if (textEl) textEl.textContent = itemData.text;
        });
      }

      function runTraceSimulation() {
        clearTimeout(simTimer);

        if (reduced) {
          stepItems.forEach(function (item) {
            item.classList.add("step-active");
            item.classList.remove("step-pending");
          });
          return;
        }

        // Reset steps to pending state
        stepItems.forEach(function (item) {
          item.classList.remove("step-active");
          item.classList.add("step-pending");
        });

        let stepIndex = 0;
        function activateNext() {
          if (stepIndex < stepItems.length) {
            stepItems[stepIndex].classList.add("step-active");
            stepItems[stepIndex].classList.remove("step-pending");
            stepIndex++;
            simTimer = setTimeout(activateNext, 340);
          }
        }

        simTimer = setTimeout(activateNext, 120);
      }

      // Scenario tab switching
      scenarioButtons.forEach(function (btn) {
        btn.addEventListener("click", function () {
          const scenario = btn.getAttribute("data-scenario");
          if (scenario === activeScenario) {
            runTraceSimulation();
            return;
          }
          activeScenario = scenario;
          scenarioButtons.forEach(function (b) {
            const isMatch = b === btn;
            b.classList.toggle("is-active", isMatch);
            b.setAttribute("aria-selected", isMatch ? "true" : "false");
          });
          renderScenarioContent(scenario);
          runTraceSimulation();
        });
      });

      // Replay button
      if (replayBtn) {
        replayBtn.addEventListener("click", function () {
          runTraceSimulation();
        });
      }

      // Gated Section Entrance: run trace once when entering viewport
      const traceObserver = createSectionObserver({
        threshold: 0.15,
        once: true,
        onEnter: function () {
          runTraceSimulation();
        }
      });
      traceObserver.observe(traceSection);
    }
  }

  // ==========================================================================
  // BARBA.JS INTEGRATION — Continuous Editorial Page Transitions
  // ==========================================================================

  function destroyPageMotion() {
    activeSectionObservers.forEach(function (obs) {
      try {
        obs.disconnect();
      } catch (e) {}
    });
    activeSectionObservers.clear();
  }

  function initPageMotion(container) {
    destroyPageMotion();
    initNarrativeAnimations(container);
  }

  const NARRATIVE_ORDER = {
    home: 0,
    features: 1,
    "how-it-works": 2,
    about: 3
  };

  const URL_TO_NAMESPACE = {
    "index.html": "home",
    "": "home",
    "features.html": "features",
    "how-it-works.html": "how-it-works",
    "about.html": "about",
    "chat.html": "chat"
  };

  function getNamespaceFromUrl(urlStr) {
    if (!urlStr) return "";
    try {
      const url = new URL(urlStr, typeof window !== "undefined" ? window.location.href : "http://localhost");
      const path = url.pathname;
      const parts = path.split("/").filter(Boolean);
      const filename = parts.length > 0 ? parts[parts.length - 1].toLowerCase() : "";
      return URL_TO_NAMESPACE[filename] || "";
    } catch {
      return "";
    }
  }

  function getNavigationDirection(currentNs, nextNs) {
    if (!currentNs || !nextNs) return "neutral";
    if (currentNs === "chat" || nextNs === "chat") return "neutral";
    const currentOrder = NARRATIVE_ORDER[currentNs];
    const nextOrder = NARRATIVE_ORDER[nextNs];
    if (currentOrder === undefined || nextOrder === undefined) return "neutral";
    return nextOrder > currentOrder ? "forward" : (nextOrder < currentOrder ? "backward" : "neutral");
  }

  // Native Cross-Document View Transition Lifecycle (Directional Bias)
  if (typeof window !== "undefined") {
    // 1. Outgoing page swap: identify direction before transition snapshot is created
    window.addEventListener("pageswap", function (e) {
      if (!e.viewTransition) return;
      if (prefersReducedMotion.matches()) {
        try {
          sessionStorage.removeItem("bisure-transition-direction");
        } catch (_) {}
        return;
      }
      const fromNs = getNamespaceFromUrl(window.location.href);
      const toUrl = e.activation && e.activation.entry ? e.activation.entry.url : null;
      const toNs = getNamespaceFromUrl(toUrl);
      const direction = getNavigationDirection(fromNs, toNs);

      if (direction !== "neutral") {
        if (e.viewTransition.types) {
          e.viewTransition.types.add(direction);
        }
        document.documentElement.dataset.transitionDirection = direction;
        try {
          sessionStorage.setItem("bisure-transition-direction", direction);
        } catch (_) {}
      } else {
        try {
          sessionStorage.removeItem("bisure-transition-direction");
        } catch (_) {}
      }
    });

    // 2. Incoming page reveal: apply direction to incoming document snapshot
    window.addEventListener("pagereveal", function (e) {
      if (!e.viewTransition) return;
      if (prefersReducedMotion.matches()) {
        try {
          sessionStorage.removeItem("bisure-transition-direction");
        } catch (_) {}
        return;
      }
      let direction = "neutral";
      try {
        direction = sessionStorage.getItem("bisure-transition-direction") || "neutral";
        sessionStorage.removeItem("bisure-transition-direction");
      } catch (_) {}

      if (direction !== "neutral") {
        if (e.viewTransition.types) {
          e.viewTransition.types.add(direction);
        }
        document.documentElement.dataset.transitionDirection = direction;
      }
    });
  }

  // Automatic bootstrap on DOM Ready
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        initPageMotion(document);
      });
    } else {
      initPageMotion(document);
    }
  }

  // Public API
  const BISureMotionAPI = {
    prefersReducedMotion: prefersReducedMotion,
    createSectionObserver: createSectionObserver,
    createScrollProgress: function (options) {
      const manager = getScrollManager();
      if (options && typeof options.callback === "function") {
        if (options.element) {
          return manager.track(options.element, options.callback, options);
        }
        return manager.subscribe(options.callback);
      }
      return manager;
    },
    getScrollManager: getScrollManager,
    initPageMotion: initPageMotion,
    destroyPageMotion: destroyPageMotion
  };

  if (typeof window !== "undefined") {
    window.BISureMotion = BISureMotionAPI;
  }

  return BISureMotionAPI;
});
