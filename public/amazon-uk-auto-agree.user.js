// ==UserScript==
// @name         Amazon UK Jobs — Auto Bypass "I Agree" & Auto-Advance to Assessment
// @namespace    https://amazon-job-apply.vercel.app/
// @version      3.1.0
// @description  Completely bypasses "I Agree" (Application Integrity Notice), prevents tab reload loops, auto-resolves live shifts, and advances jobsatamazon.co.uk directly to Assessment.
// @author       Amazon Job Monitor UK
// @match        https://www.jobsatamazon.co.uk/*
// @match        https://jobsatamazon.co.uk/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  let integrityAgreed = false;
  let startClicked = false;
  let existingAppContinued = false;
  let candidatePreloaded = false;
  let applicationCreatedOrDispatched = false;
  let resolvedLiveScheduleId = "";
  let scheduleResolutionStarted = false;

  function getUrlParam(name) {
    try {
      const hashQuery = (window.location.hash || "").split("?")[1] || "";
      const hashParams = new URLSearchParams(hashQuery);
      if (hashParams.get(name)) return hashParams.get(name);
      const searchParams = new URLSearchParams(window.location.search || "");
      if (searchParams.get(name)) return searchParams.get(name);
      return sessionStorage.getItem(name) || "";
    } catch {
      return "";
    }
  }

  function sanitizeUrlParams(stripResumeFlag) {
    try {
      let changed = false;
      const url = new URL(window.location.href);
      if (url.searchParams.has("page")) {
        url.searchParams.delete("page");
        changed = true;
      }
      if (
        stripResumeFlag &&
        url.searchParams.has("resumeApplicationLogicOnReturnFromAuth")
      ) {
        url.searchParams.delete("resumeApplicationLogicOnReturnFromAuth");
        changed = true;
      }
      if (
        stripResumeFlag &&
        url.hash.includes("resumeApplicationLogicOnReturnFromAuth")
      ) {
        const parts = url.hash.split("?");
        if (parts[1]) {
          const hp = new URLSearchParams(parts[1]);
          hp.delete("resumeApplicationLogicOnReturnFromAuth");
          const qs = hp.toString();
          url.hash = qs ? `${parts[0]}?${qs}` : parts[0];
          changed = true;
        }
      }
      if (changed) {
        window.history.replaceState(
          window.history.state,
          document.title,
          url.toString()
        );
      }
      if (stripResumeFlag) {
        sessionStorage.removeItem("resumeApplicationLogicOnReturnFromAuth");
      }
    } catch {
      // ignore
    }
  }

  sanitizeUrlParams(false);

  function getCandidateId() {
    try {
      const fromLs = localStorage.getItem("bbCandidateId");
      if (fromLs) return fromLs;
      const store = window.reduxStore;
      const fromRedux =
        store?.getState?.()?.candidate?.results?.candidateData?.candidateId ||
        store?.getState?.()?.application?.results?.candidateId;
      return fromRedux || "";
    } catch {
      return "";
    }
  }

  function getBestScheduleId() {
    try {
      if (resolvedLiveScheduleId) return resolvedLiveScheduleId;
      const store = window.reduxStore;
      const fromRedux =
        store?.getState?.()?.schedule?.results?.scheduleDetail?.scheduleId;
      if (fromRedux) return fromRedux;
      return getUrlParam("scheduleId") || "";
    } catch {
      return "";
    }
  }

  async function resolveLiveScheduleForJob() {
    if (scheduleResolutionStarted) return;
    const jobId = getUrlParam("jobId");
    if (!jobId || !jobId.startsWith("JOB-")) return;
    scheduleResolutionStarted = true;

    try {
      const csrfRes = await fetch(
        "https://www.jobsatamazon.co.uk/authorize/api/csrf?countryCode=UK",
        { credentials: "include" }
      );
      if (!csrfRes.ok) return;
      const csrfData = await csrfRes.json();
      const token = csrfData?.token;
      if (!token) return;

      const today = new Date().toISOString().split("T")[0];
      const gqlRes = await fetch("https://www.jobsatamazon.co.uk/graphql", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer Status|unauthenticated|Session|${token}`,
          "x-amz-access-token": token,
        },
        body: JSON.stringify({
          operationName: "searchScheduleCards",
          variables: {
            searchScheduleRequest: {
              locale: "en-GB",
              country: "United Kingdom",
              keyWords: "",
              equalFilters: [],
              containFilters: [{ key: "isPrivateSchedule", val: ["false"] }],
              rangeFilters: [],
              orFilters: [],
              dateFilters: [
                { key: "firstDayOnSite", range: { startDate: today } },
              ],
              sorters: [{ fieldName: "totalPayRateMax", ascending: "false" }],
              pageSize: 25,
              jobId,
              consolidateSchedule: true,
            },
          },
          query: `query searchScheduleCards($searchScheduleRequest: SearchScheduleRequest!) {
            searchScheduleCards(searchScheduleRequest: $searchScheduleRequest) {
              scheduleCards {
                scheduleId
                jobId
                laborDemandAvailableCount
              }
            }
          }`,
        }),
      });
      if (!gqlRes.ok) return;
      const gqlData = await gqlRes.json();
      const rawCards =
        gqlData?.data?.searchScheduleCards?.scheduleCards || [];
      const activeCards = rawCards
        .filter(
          (c) =>
            (c.laborDemandAvailableCount ?? 1) > 0 && Boolean(c.scheduleId)
        )
        .sort(
          (a, b) =>
            (b.laborDemandAvailableCount ?? 1) -
            (a.laborDemandAvailableCount ?? 1)
        );

      if (activeCards.length > 0) {
        const urlSched = getUrlParam("scheduleId");
        const isUrlSchedActive = activeCards.some(
          (c) => c.scheduleId === urlSched
        );
        const chosen = isUrlSchedActive
          ? urlSched
          : activeCards[0].scheduleId;
        resolvedLiveScheduleId = chosen;
        sessionStorage.setItem("scheduleId", chosen);

        if (chosen && chosen !== urlSched) {
          try {
            const url = new URL(window.location.href);
            url.searchParams.set("scheduleId", chosen);
            if (url.hash.includes("?")) {
              const [hPath, hQuery] = url.hash.split("?");
              const hp = new URLSearchParams(hQuery);
              hp.set("scheduleId", chosen);
              url.hash = `${hPath}?${hp.toString()}`;
            }
            window.history.replaceState(
              window.history.state,
              document.title,
              url.toString()
            );
          } catch {
            // ignore
          }
        }

        if (window.reduxStore?.dispatch) {
          window.reduxStore.dispatch({
            type: "GET_DETAIL",
            payload: { locale: "en-GB", scheduleId: chosen },
            intermediateCall: true,
          });
        }
      }
    } catch {
      // ignore
    }
  }

  void resolveLiveScheduleForJob();

  function ensureCompleteIntegrityPayload() {
    try {
      const raw = sessionStorage.getItem("integrityNoticePayload");
      let parsed = {};
      if (raw) {
        try {
          parsed = JSON.parse(raw) || {};
        } catch {
          parsed = {};
        }
      }
      const store = window.reduxStore;
      const jobResults = store?.getState?.()?.job?.results;
      const jobId =
        parsed.jobId || jobResults?.jobId || getUrlParam("jobId") || "";
      const scheduleId = getBestScheduleId() || parsed.scheduleId || "";
      const candidateId = parsed.candidateId || getCandidateId() || "";

      if (jobId) {
        const patched = {
          jobId,
          scheduleId,
          candidateId,
          dspEnabled:
            typeof parsed.dspEnabled === "boolean"
              ? parsed.dspEnabled
              : Boolean(jobResults?.dspEnabled),
          jobAssessmentToggle:
            typeof parsed.jobAssessmentToggle === "boolean"
              ? parsed.jobAssessmentToggle
              : Boolean(jobResults?.bypassAssessment),
          jobAssessmentType:
            parsed.jobAssessmentType ?? jobResults?.assessmentType,
        };
        sessionStorage.setItem(
          "integrityNoticePayload",
          JSON.stringify(patched)
        );
      }
    } catch {
      // ignore
    }
  }

  function hookReduxStore(store) {
    if (!store || typeof store.getState !== "function") return;
    try {
      const disableNoticeFlags = () => {
        try {
          const state = store.getState();
          const fl = state?.appConfig?.results?.envConfig?.featureList;
          if (fl) {
            if (fl.ENABLE_APPLICATION_INTEGRITY_NOTICE) {
              fl.ENABLE_APPLICATION_INTEGRITY_NOTICE = {
                UK: { isAvailable: false, jobIdAllowList: "" },
              };
            }
            if (fl.ENABLE_EMPTY_SCHEDULE_CHECK) {
              fl.ENABLE_EMPTY_SCHEDULE_CHECK = {
                isAvailable: false,
                UK: { isAvailable: false },
              };
            }
          }
        } catch {
          // ignore
        }
      };

      disableNoticeFlags();

      if (!store.__agyHooked) {
        store.__agyHooked = true;

        if (typeof store.subscribe === "function") {
          store.subscribe(disableNoticeFlags);
        }

        if (typeof store.dispatch === "function") {
          const origDispatch = store.dispatch.bind(store);
          store.dispatch = function (action) {
            try {
              disableNoticeFlags();
              if (action && typeof action === "object") {
                if (
                  action.type === "CREATE_APPLICATION_AND_SKIP_SCHEDULE" ||
                  action.type === "CREATE_APPLICATION"
                ) {
                  applicationCreatedOrDispatched = true;
                  sanitizeUrlParams(true);

                  const cid =
                    action.payload?.candidateId || getCandidateId();
                  const sid =
                    resolvedLiveScheduleId ||
                    action.payload?.scheduleId ||
                    getBestScheduleId();

                  if (action.payload && typeof action.payload === "object") {
                    if (cid) action.payload.candidateId = cid;
                    if (sid) action.payload.scheduleId = sid;
                  }

                  if (action.type === "CREATE_APPLICATION" && sid) {
                    action.type = "CREATE_APPLICATION_AND_SKIP_SCHEDULE";
                    delete action.onSuccess;
                  }
                }
              }
            } catch {
              // ignore
            }
            return origDispatch(action);
          };
        }

        if (!candidatePreloaded && localStorage.getItem("bbCandidateId")) {
          candidatePreloaded = true;
          try {
            store.dispatch({
              type: "GET_CANDIDATE",
              displayAuthErrorMessage: false,
              hideLoaderOnSuccess: true,
              unsanitized: false,
            });
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }
  }

  try {
    let _reduxStore = window.reduxStore;
    if (_reduxStore) hookReduxStore(_reduxStore);
    Object.defineProperty(window, "reduxStore", {
      configurable: true,
      enumerable: true,
      get() {
        return _reduxStore;
      },
      set(val) {
        _reduxStore = val;
        hookReduxStore(val);
      },
    });
  } catch {
    // ignore
  }

  try {
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__agyUrl = typeof url === "string" ? url : "";
      if (
        this.__agyUrl.includes("/get-schedule-details/") &&
        resolvedLiveScheduleId
      ) {
        const fixedUrl = this.__agyUrl.replace(
          /\/get-schedule-details\/SCH-[^?&/]+/,
          `/get-schedule-details/${resolvedLiveScheduleId}`
        );
        this.__agyUrl = fixedUrl;
        return origOpen.call(this, method, fixedUrl);
      }
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (body) {
      try {
        if (
          this.__agyUrl &&
          this.__agyUrl.includes("/create-application") &&
          typeof body === "string" &&
          body.startsWith("{")
        ) {
          applicationCreatedOrDispatched = true;
          sanitizeUrlParams(true);
          const data = JSON.parse(body);
          if (!data.candidateId) {
            const cid = getCandidateId();
            if (cid) data.candidateId = cid;
          }
          const sid =
            resolvedLiveScheduleId || data.scheduleId || getBestScheduleId();
          if (sid) data.scheduleId = sid;
          body = JSON.stringify(data);
        } else if (
          this.__agyUrl &&
          this.__agyUrl.includes("/update-application") &&
          typeof body === "string" &&
          body.startsWith("{")
        ) {
          const data = JSON.parse(body);
          if (
            data.type === "job-confirm" &&
            data.payload &&
            !data.payload.scheduleId
          ) {
            const sid = getBestScheduleId();
            if (sid) data.payload.scheduleId = sid;
            body = JSON.stringify(data);
          }
        }
      } catch {
        // ignore
      }
      return origSend.call(this, body);
    };
  } catch {
    // ignore
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0"
    ) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isOnAssessment() {
    const hash = (window.location.hash || "").toLowerCase();
    if (hash.includes("assessment")) return true;
    if (document.querySelector("#assessment-video")) return true;
    const text = (document.body ? document.body.innerText : "").toLowerCase();
    return (
      text.includes("evaluate your fit at amazon") ||
      text.includes("read assessment instructions") ||
      text.includes("start assessment") ||
      text.includes("begin assessment")
    );
  }

  function clickSingleTime(btn) {
    if (!btn || btn.disabled || !isVisible(btn)) return false;
    if (btn.dataset.agyAutoClicked === "true") return false;
    btn.dataset.agyAutoClicked = "true";

    try {
      btn.scrollIntoView({ block: "center", behavior: "instant" });
    } catch {}

    try {
      btn.click();
    } catch {}

    console.log(
      "[Amazon UK Auto-Apply] Auto-clicked once:",
      (
        btn.innerText ||
        btn.textContent ||
        btn.getAttribute("data-test-id") ||
        ""
      ).trim()
    );
    return true;
  }

  function runAutoAdvance() {
    try {
      sanitizeUrlParams(false);
      void resolveLiveScheduleForJob();

      if (window.reduxStore) {
        hookReduxStore(window.reduxStore);
      }

      if (isOnAssessment()) return;

      const href = window.location.href || "";
      const hash = (window.location.hash || "").toLowerCase();

      if (!existingAppContinued) {
        const dialog = document.querySelector(
          '[aria-labelledby="existing-application-title"], [role="dialog"]'
        );
        if (dialog && isVisible(dialog)) {
          const buttons = Array.from(dialog.querySelectorAll("button"));
          const continueBtn = buttons.find((b) => {
            const t = (b.innerText || b.textContent || "").trim().toLowerCase();
            return (
              t === "continue" ||
              t.includes("continue") ||
              t.includes("proceed")
            );
          });
          if (continueBtn && !continueBtn.disabled && isVisible(continueBtn)) {
            existingAppContinued = true;
            clickSingleTime(continueBtn);
            return;
          }
        }
      }

      if (hash.includes("application-integrity-notice") || !integrityAgreed) {
        const integrityAgreeBtn = document.querySelector(
          'button[data-test-id="integrity-notice-agree-button"], [data-test-id="integrity-notice-agree-button"]'
        );
        if (
          integrityAgreeBtn &&
          !integrityAgreeBtn.disabled &&
          isVisible(integrityAgreeBtn) &&
          !integrityAgreed
        ) {
          sanitizeUrlParams(true);
          ensureCompleteIntegrityPayload();
          integrityAgreed = true;
          clickSingleTime(integrityAgreeBtn);
          return;
        }
      }

      if (hash.includes("job-opportunities")) {
        const shiftCard = document.querySelector(
          '[data-test-component="StencilReactCard"][role="button"], .schedule-card, [data-test-id*="schedule"]'
        );
        if (
          shiftCard &&
          isVisible(shiftCard) &&
          !shiftCard.dataset.agyAutoClicked
        ) {
          clickSingleTime(shiftCard);
        }
        const applyBtns = Array.from(document.querySelectorAll("button"));
        const continueShiftBtn = applyBtns.find((b) => {
          const t = (b.innerText || b.textContent || "").trim().toLowerCase();
          return (
            t === "continue" ||
            t === "apply" ||
            t === "next" ||
            t === "confirm"
          );
        });
        if (
          continueShiftBtn &&
          !continueShiftBtn.disabled &&
          isVisible(continueShiftBtn)
        ) {
          clickSingleTime(continueShiftBtn);
          return;
        }
      }

      if (
        integrityAgreed ||
        applicationCreatedOrDispatched ||
        href.includes("applicationId=")
      ) {
        return;
      }

      if (
        hash.includes("/consent") &&
        !startClicked &&
        sessionStorage.getItem("resumeApplicationLogicOnReturnFromAuth") !==
          "true"
      ) {
        const startBtn = document.querySelector("#startApplicationButton");
        if (startBtn && !startBtn.disabled && isVisible(startBtn)) {
          startClicked = true;
          clickSingleTime(startBtn);
          return;
        }
      }
    } catch {
      // ignore
    }
  }

  setInterval(runAutoAdvance, 150);
})();
