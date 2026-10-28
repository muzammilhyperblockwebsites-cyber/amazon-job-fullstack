/* global GM_getValue, GM_setValue, GM_deleteValue, managedLaunch */
(function () {
  "use strict";
  if (globalThis.__amazonMonitorHelperV4) return;
  globalThis.__amazonMonitorHelperV4 = true;
  const STORAGE_PREFIX = "agm-launch:";
  const TTL = 30 * 60 * 1000;
  const managed = typeof managedLaunch !== "undefined" ? managedLaunch : null;
  const isAmazon = /^(www\.)?jobsatamazon\.co\.uk$/.test(location.hostname);
  const isDashboard = location.origin === "https://amazon-job-apply.vercel.app" || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const storage = {
    async get(key) {
      if (typeof GM_getValue === "function") return GM_getValue(key, null);
      return (await chrome.storage.local.get(key))[key] || null;
    },
    async set(key, value) {
      if (typeof GM_setValue === "function") return GM_setValue(key, value);
      return chrome.storage.local.set({ [key]: value });
    },
    async remove(key) {
      if (typeof GM_deleteValue === "function") return GM_deleteValue(key);
      return chrome.storage.local.remove(key);
    },
  };

  if (isDashboard) {
    window.addEventListener("message", async event => {
      const data = event.data;
      if (event.source !== window || event.origin !== location.origin || data?.channel !== "amazon-monitor" || !["ping", "launch"].includes(data.type)) return;
      let error;
      try {
        if (data.type === "launch") {
          if (!/^[a-f0-9-]{36}$/.test(data.launchId) || !data.jobId || !data.scheduleId || !data.profile) throw new Error("Invalid application handoff.");
          // Only candidate fields; Amazon credentials are never passed to the helper.
          const keys = ["firstName", "lastName", "phone", "addressLine1", "city", "postcode", "rightToWorkUk", "rightToWorkType", "over18", "declarationsConfirmed", "requiresVisaSponsorship", "previouslyWorkedAtAmazon", "cvFileName", "cvBase64", "aiFormFillerEnabled", "autoClickNextEnabled", "requireHumanApproval"];
          const profile = Object.fromEntries(keys.filter(key => key in data.profile).map(key => [key, data.profile[key]]));
          const entry = { jobId: data.jobId, scheduleId: data.scheduleId, profile, expiresAt: Date.now() + TTL };
          await storage.set(STORAGE_PREFIX + data.launchId, entry);
          setTimeout(() => { void storage.remove(STORAGE_PREFIX + data.launchId); }, TTL);
        }
      } catch { error = "The helper could not receive your profile. Check extension storage and retry."; }
      window.postMessage({ channel: "amazon-monitor-helper", requestId: data.requestId, error, version: "4.0.0" }, location.origin);
    });
    return;
  }
  if (!isAmazon) return;

  let launch = null;
  let panel;
  let running = false;
  let lastClick = 0;
  let routeKey = "";
  let routeClicks = 0;
  const uploaded = new WeakSet();
  const clicks = new WeakMap();
  const changed = new WeakSet();
  let verifiedAt = 0;
  let stopped = false;
  window.addEventListener("amazon-monitor-stop", () => {
    stopped = true;
    if (launch) sessionStorage.setItem("agm-stopped", `${launch.jobId}:${launch.scheduleId}`);
    say("Automation stopped. No application was withdrawn.", "stopped");
  });
  function say(message, stage = "running") {
    if (!document.body) return;
    if (!panel || !panel.isConnected) {
      panel = document.createElement("aside");
      panel.id = "amazon-monitor-helper-status";
      panel.setAttribute("role", "status");
      panel.style.cssText = "position:fixed;bottom:16px;right:16px;z-index:2147483647;background:#172433;color:white;padding:14px;border-radius:10px;max-width:340px;font:14px/1.5 sans-serif;box-shadow:0 3px 14px #0004";
      document.body.append(panel);
    }
    if (panel.textContent !== message) panel.textContent = message;
    panel.dataset.stage = stage;
  }
  function visible(element) {
    if (!element || element.closest("#amazon-monitor-helper-status") || element.hidden || element.closest('[hidden],[aria-hidden="true"]')) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  }
  function text(element) { return (element.innerText || element.textContent || element.value || "").trim().replace(/\s+/g, " ").toLowerCase(); }
  function label(element) {
    return [element.name, element.id, element.autocomplete, element.getAttribute("aria-label"), ...(element.labels ? Array.from(element.labels, item => item.textContent) : []), document.getElementById(element.getAttribute("aria-labelledby"))?.textContent].filter(Boolean).join(" ").toLowerCase();
  }
  function fill(element, value) {
    if (value === undefined || value === null || value === "" || element.disabled || element.readOnly || element.value === String(value)) return;
    // Preserve an existing answer or a correction made in the Amazon form.
    const placeholder = element.tagName === "SELECT" && element.selectedOptions[0]?.disabled;
    if (element.value && !placeholder) return;
    const proto = element.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(element, String(value));
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    changed.add(element);
  }
  function answerFor(question, profile) {
    if (!profile.declarationsConfirmed) return undefined;
    if (/18|eighteen/.test(question) && /age|old|over|least|18plus/.test(question)) return profile.over18;
    if (/sponsor/.test(question)) return profile.requiresVisaSponsorship;
    if (/previous|before|ever/.test(question) && /amazon/.test(question)) return profile.previouslyWorkedAtAmazon;
    if (/right.?to.?work|legally (authorized|authorised)|eligible to work/.test(question) && !/status|type|document/.test(question)) return profile.rightToWorkType === "Not specified" ? undefined : profile.rightToWorkUk;
    return undefined;
  }
  function completeFields(profile) {
    const fields = Array.from(document.querySelectorAll("input,select" )).filter(visible);
    for (const field of fields) {
      const key = label(field);
      if (field.tagName === "SELECT") {
        const answer = answerFor(key, profile);
        if (typeof answer === "boolean") {
          const option = Array.from(field.options).find(option => text(option) === (answer ? "yes" : "no"));
          if (option) fill(field, option.value);
        }
        continue;
      }
      if (["password", "hidden", "file", "submit", "button", "checkbox", "radio"].includes(field.type)) continue;
      let value;
      if (/given-name|first[\s_-]*name|firstname/.test(key)) value = profile.firstName;
      else if (/family-name|last[\s_-]*name|surname|lastname/.test(key)) value = profile.lastName;
      else if (/postal-code|post[\s_-]*code|postcode/.test(key)) value = profile.postcode;
      else if (/address-line1|address[\s_-]*line[\s_-]*1|street address/.test(key)) value = profile.addressLine1;
      else if (/address-level2|city|town/.test(key)) value = profile.city;
      else if (/tel|phone|mobile/.test(key) && !/code|country/.test(key)) value = profile.phone;
      fill(field, value);
    }
    const groups = Array.from(document.querySelectorAll("fieldset,[role='radiogroup']")).filter(visible);
    for (const group of groups) {
      const question = group.querySelector("legend")?.textContent || group.getAttribute("aria-label") || document.getElementById(group.getAttribute("aria-labelledby"))?.textContent || "";
      const answer = answerFor(question.toLowerCase(), profile);
      if (typeof answer !== "boolean" || group.querySelector("input:checked,[aria-checked='true']")) continue;
      const option = Array.from(group.querySelectorAll('input[type="radio"],[role="radio"]')).find(option => {
        const value = (option.labels?.[0]?.textContent || option.getAttribute("aria-label") || option.textContent || option.value || "").trim().toLowerCase();
        return value === (answer ? "yes" : "no");
      });
      if (option && !option.disabled) option.click();
    }
    for (const field of fields.filter(field => field.type === "checkbox")) {
      const answer = answerFor(label(field), profile);
      if (answer === true && !field.checked && !field.disabled && !changed.has(field)) {
        field.click(); changed.add(field);
      }
    }
    // Only the declared CV is attached, and only to an identifiable CV field.
    for (const input of fields.filter(field => field.type === "file")) {
      if (!/cv|resume|résumé/.test(label(input)) || uploaded.has(input) || !profile.cvBase64 || input.files?.length) continue;
      const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(profile.cvBase64);
      if (!match) continue;
      const bytes = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], profile.cvFileName || "CV.pdf", { type: match[1] }));
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      uploaded.add(input);
      lastClick = Date.now(); // Allow Amazon's upload to finish before continuing.
    }
  }
  async function verifyShift() {
    if (Date.now() - verifiedAt < 8000) return true;
    const csrf = await fetch("/authorize/api/csrf?countryCode=UK", { credentials: "include", cache: "no-store" });
    if (!csrf.ok) throw new Error("Shift check unavailable. Retry shortly.");
    const { token } = await csrf.json();
    if (!token) throw new Error("Sign in on Amazon to continue.");
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const response = await fetch("/graphql", {
      method: "POST", credentials: "include", cache: "no-store",
      headers: { "Content-Type": "application/json", Authorization: `Bearer Status|unauthenticated|Session|${token}`, "x-amz-access-token": token },
      body: JSON.stringify({ operationName: "searchScheduleCards", variables: { searchScheduleRequest: { locale: "en-GB", country: "United Kingdom", keyWords: "", equalFilters: [], containFilters: [{ key: "isPrivateSchedule", val: ["false"] }], rangeFilters: [], orFilters: [], dateFilters: [{ key: "firstDayOnSite", range: { startDate: today } }], sorters: [{ fieldName: "totalPayRateMax", ascending: "false" }], pageSize: 100, jobId: launch.jobId, consolidateSchedule: true } }, query: "query searchScheduleCards($searchScheduleRequest: SearchScheduleRequest!) { searchScheduleCards(searchScheduleRequest: $searchScheduleRequest) { scheduleCards { scheduleId jobId hireStartDate laborDemandAvailableCount } } }" }),
    });
    const result = await response.json();
    if (!response.ok || result.errors?.length || !Array.isArray(result.data?.searchScheduleCards?.scheduleCards)) throw new Error("Live shift could not be verified. Retry shortly.");
    const found = result.data.searchScheduleCards.scheduleCards.some(card => card.scheduleId === launch.scheduleId && (!card.jobId || card.jobId === launch.jobId) && card.laborDemandAvailableCount > 0 && (!card.hireStartDate || card.hireStartDate.slice(0, 10) >= today));
    if (!found) throw new Error("Selected shift is no longer available. Return to the dashboard and choose another shift.");
    // The application service checks ACTIVE status separately from the public search count.
    // Use this browser's own Amazon login only on Amazon's own origin.
    if (managed) {
      const accessToken = localStorage.getItem("accessToken");
      if (!accessToken) { say("Sign in once in this Amazon browser. The tool will resume automatically.", "waiting_login"); return false; }
      const detail = await fetch(`/application/api/job/get-schedule-details/${encodeURIComponent(launch.scheduleId)}?locale=en-GB`, {
        credentials: "include", cache: "no-store", headers: { Authorization: accessToken, "bb-ui-version": "bb-ui-v2" }, signal: AbortSignal.timeout(10000),
      });
      if (detail.status === 401 || detail.status === 403) { say("Complete Amazon sign-in or verification. The tool will resume afterwards.", "waiting_login"); return false; }
      if (!detail.ok) throw new Error("Amazon could not verify the selected shift. Retry when its application service is available.");
      const schedule = await detail.json();
      if (schedule.status !== "ACTIVE" || (schedule.scheduleId && schedule.scheduleId !== launch.scheduleId) || (schedule.jobId && schedule.jobId !== launch.jobId)) {
        say("Amazon's application service reports this shift unavailable. It has not been reserved; choose another live shift.", "shift_unavailable"); stopped = true; return false;
      }
    }
    verifiedAt = Date.now();
    return true;
  }
  function clickOnce(element) {
    if (!visible(element) || element.disabled || element.getAttribute("aria-disabled") === "true") return false;
    const fields = Array.from(document.querySelectorAll("input,select")).filter(visible).map(input => [input.name, input.type, input.value, input.checked]);
    const headings = Array.from(document.querySelectorAll("h1,h2,legend")).filter(visible).map(text);
    const key = location.hash + "|" + text(element) + "|" + JSON.stringify([fields, headings]);
    if (clicks.get(element) === key || routeClicks >= 8 || Date.now() - lastClick < 1800) return false;
    const form = element.closest("form");
    if (form && !form.checkValidity()) { say("Complete the highlighted required fields on Amazon; the helper will resume."); return false; }
    clicks.set(element, key);
    routeClicks++;
    lastClick = Date.now();
    element.click();
    return true;
  }
  async function tick() {
    if (stopped || running || !launch || !document.body) return;
    running = true;
    try {
      if (Date.now() >= launch.expiresAt) { sessionStorage.removeItem("agm-active"); say("Application helper session expired. Start again from the dashboard."); launch = null; return; }
      const url = new URL(location.href);
      const currentJob = new URLSearchParams(url.hash.split("?")[1] || "").get("jobId") || url.searchParams.get("jobId");
      if (currentJob && currentJob !== launch.jobId) { say("This is a different job. Start it from the dashboard."); return; }
      const currentSchedule = new URLSearchParams(url.hash.split("?")[1] || "").get("scheduleId") || url.searchParams.get("scheduleId");
      if (currentSchedule && currentSchedule !== launch.scheduleId) { say("This is a different shift. Start it from the dashboard."); return; }
      const route = (location.pathname + location.hash.split("?")[0]).toLowerCase();
      if (route !== routeKey) { routeKey = route; routeClicks = 0; }
      const body = document.body.cloneNode(true);
      body.querySelectorAll("script,style,template,noscript,#amazon-monitor-helper-status").forEach(element => element.remove());
      const bodyText = (body.innerText || body.textContent || "").toLowerCase();
      if (/assessment/.test(route) || document.querySelector("#assessment-video") || /start assessment|begin assessment|read assessment instructions|evaluate your fit at amazon/.test(bodyText)) {
        say("Assessment reached. Complete the assessment yourself; automatic actions have stopped.", "assessment_ready"); stopped = true; return;
      }
      if (Array.from(document.querySelectorAll('input[type="password"],input[autocomplete="one-time-code"],iframe[src*="captcha"],iframe[title*="CAPTCHA"]')).some(visible) || /captcha|login|signin|sign-in/.test(route)) {
        say("Complete Amazon sign-in, verification or CAPTCHA. The tool will resume afterwards.", "waiting_login"); return;
      }
      if (managed && !location.pathname.startsWith("/application/uk")) { say("Waiting for Amazon to return to the selected application.", "waiting_login"); return; }
      const visibleMessages = Array.from(document.querySelectorAll('[role="alert"],h1,h2,p,[data-test-id*="error"]')).filter(visible).map(text).join(" ");
      if (/(shift|schedule).*(no longer available|unavailable|expired)|no (shifts|schedules) available/.test(visibleMessages)) { say("Amazon reports this shift unavailable. It has not been reserved; choose another live shift.", "shift_unavailable"); stopped = true; return; }
      const profile = launch.profile;
      if (profile.aiFormFillerEnabled === false) { say("Form filling is disabled in your saved profile."); return; }
      completeFields(profile);
      if (profile.autoClickNextEnabled === false) { say("Saved details filled. Automatic Next is disabled."); return; }
      const errors = Array.from(document.querySelectorAll('[role="alert"],[aria-invalid="true"]')).filter(element => visible(element) && (text(element) || element.getAttribute("aria-invalid") === "true"));
      if (errors.length) { say("Resolve the validation message on Amazon. The tool will resume afterwards.", "needs_input"); return; }
      const buttons = Array.from(document.querySelectorAll('button,input[type="submit"],[role="button"]')).filter(visible);
      const final = buttons.find(button => /^(submit( application)?|finish( application)?|accept( job)? offer|withdraw( application)?)$/.test(text(button)));
      if (final) { say("Final application step reached. Review your details and submit yourself.", "needs_input"); return; }
      // Use Amazon's controls, never mutate its feature flags, requests or assessment state.
      const integrity = document.querySelector('[data-test-id="integrity-notice-agree-button"], [data-testid="integrity-notice-agree-button"]');
      const candidate = (visible(integrity) ? integrity : null) || buttons.find(button => !button.disabled && button.getAttribute("aria-disabled") !== "true" && (/^(start( application| my application)?|apply( now)?|continue( application| applying)?|next|save (and|&) continue|i agree|agree and continue|confirm shift|select shift)$/.test(text(button)) || button.id === "startApplicationButton"));
      if (!candidate) { say("Waiting for Amazon. Complete any unanswered question or choose your saved shift to continue."); return; }
      if (/job-opportunities|schedule|shift-selection/.test(route)) {
        const selected = Array.from(document.querySelectorAll('[aria-checked="true"],[aria-selected="true"],input:checked')).find(element => element.getAttribute("data-schedule-id") === launch.scheduleId || element.value === launch.scheduleId || element.closest('[data-schedule-id]')?.getAttribute("data-schedule-id") === launch.scheduleId);
        const card = Array.from(document.querySelectorAll('[data-schedule-id],input[type="radio"]')).find(element => element.getAttribute("data-schedule-id") === launch.scheduleId || element.value === launch.scheduleId);
        if (!selected) {
          if (card && await verifyShift()) clickOnce(card);
          say("Select the exact shift you chose on the dashboard, then continue."); return;
        }
      }
      const starting = /^(start|apply|confirm shift|select shift|i agree)/.test(text(candidate)) || candidate.id === "startApplicationButton" || candidate === integrity;
      if (starting && !await verifyShift()) return;
      if (clickOnce(candidate)) say("Application helper is completing saved details and continuing towards assessment.");
    } catch (error) {
      const unavailable = /no longer available|expired/.test(error.message || "");
      if (unavailable) stopped = true;
      say(error.message || "Application helper paused. Check the Amazon page.", unavailable ? "shift_unavailable" : "needs_input");
    }
    finally { running = false; }
  }
  async function init() {
    try {
      if (managed) {
        launch = managed;
        if (sessionStorage.getItem("agm-stopped") === `${launch.jobId}:${launch.scheduleId}`) {
          stopped = true; say("Automation stopped. Start a new application from the tool to resume.", "stopped"); return;
        }
        await tick();
        setInterval(() => { void tick(); }, 700);
        return;
      }
      const id = new URLSearchParams(location.hash.split("?")[1] || "").get("agmLaunch");
      if (id && /^[a-f0-9-]{36}$/.test(id)) {
        launch = await storage.get(STORAGE_PREFIX + id);
        if (launch) {
          sessionStorage.setItem("agm-active", JSON.stringify(launch));
          await storage.remove(STORAGE_PREFIX + id);
          const url = new URL(location.href);
          const [path, query] = url.hash.split("?");
          const params = new URLSearchParams(query); params.delete("agmLaunch");
          url.hash = `${path}?${params}`;
          history.replaceState(history.state, "", url);
        }
      }
      if (!launch) launch = JSON.parse(sessionStorage.getItem("agm-active") || "null");
      if (!launch) return;
      await tick();
      setInterval(() => { void tick(); }, 700);
    } catch { say("Profile handoff failed. Return to the dashboard and start again."); }
  }
  void init();
})();
