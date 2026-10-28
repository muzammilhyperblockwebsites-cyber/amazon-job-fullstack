"use client";

import { useState, useEffect } from "react";

interface Prefs {
  locations: string[];
  keywords: string[];
  categories: string[];
  jobTypes: string[];
  excludeKeywords: string[];
  minMatchScore: number;
  postedWithinHours: number;
  remoteOnly: boolean;
  autoApplyEnabled: boolean;
  autoApplyMinScore: number;
  amazonEmail: string;
  amazonPassword: string;
  emailEnabled: boolean;
  emailAddress: string;
  emailMinScore: number;
  browserNotify: boolean;
  pollIntervalMins: number;
  radius: number;
}

const DEFAULT_PREFS: Prefs = {
  locations: [],
  keywords: [],
  categories: [],
  jobTypes: [],
  excludeKeywords: [],
  minMatchScore: 0,
  postedWithinHours: 0,
  remoteOnly: false,
  autoApplyEnabled: false,
  autoApplyMinScore: 100,
  amazonEmail: "",
  amazonPassword: "",
  emailEnabled: false,
  emailAddress: "",
  emailMinScore: 50,
  browserNotify: true,
  pollIntervalMins: 2,
  radius: 30,
};

// Exact options from https://www.jobsatamazon.co.uk/app#/jobSearch Filters panel
const COMMUTE_DISTANCE_OPTIONS = [
  { label: "Within 3 miles", value: 3 },
  { label: "Within 10 miles", value: 10 },
  { label: "Within 15 miles", value: 15 },
  { label: "Within 20 miles", value: 20 },
  { label: "Within 30 miles", value: 30 },
  { label: "Within 50 miles", value: 50 },
];

const WORK_HOURS_OPTIONS = [
  "Any",
  "Full time (30+ hours)",
  "Part time (0-30 hours)",
];

const LENGTH_OF_EMPLOYMENT_OPTIONS = [
  "Any",
  "Permanent",
  "Fixed-term",
];

const AMAZON_UK_ROLES = [
  "Warehouse Associate",
  "Fulfilment Centre Warehouse Associate",
  "XL Warehouse Associate",
  "Quick Ship Warehouse Associate",
  "Sortation Centre Warehouse Associate",
  "Delivery Station Warehouse Associate",
  "Warehouse Equipment Operator",
  "Customer Service Associate",
  "Remote Customer Service Associate",
];

const UK_LOCATIONS_SUGGESTIONS = [
  "Bathgate",
  "Belfast",
  "Bognor Regis",
  "Bristol",
  "Carlisle",
  "Dundee",
  "Dunfermline",
  "Exeter",
  "Garden City",
  "Ipswich",
  "Liverpool",
  "Norwich",
  "Plymouth",
  "Port Talbot",
  "Portadown",
  "Swansea",
  "London",
  "Manchester",
  "Birmingham",
  "Leeds",
  "Glasgow",
  "Edinburgh",
  "Cardiff",
  "Newcastle",
  "Nottingham",
  "Leicester",
  "Coventry",
  "Milton Keynes",
];

// ── Section wrapper ────────────────────────────────────────────────────────
function Section({
  title,
  icon,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden mb-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        <span className="font-semibold text-sm text-gray-800 flex items-center gap-2">
          <span>{icon}</span>
          {title}
        </span>
        <span className="text-gray-400 text-xs">{open ? "▲" : "▼"}</span>
      </button>
      {open && <div className="px-4 py-3.5">{children}</div>}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export default function PreferencesPanel({
  onSaved,
}: {
  onSaved?: (preOpenedTab?: Window | null) => void;
}) {
  const [prefs, setPrefs] = useState<Prefs>({ ...DEFAULT_PREFS });
  const [locationDraft, setLocationDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Candidate Profile & AI Agent settings state
  const [candidateProfile, setCandidateProfile] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    addressLine1: "",
    city: "",
    postcode: "",
    rightToWorkUk: false,
    rightToWorkType: "Not specified",
    over18: false,
    declarationsConfirmed: false,
    requiresVisaSponsorship: false,
    previouslyWorkedAtAmazon: false,
    shiftPreference: "Any Shift",
    cvFileName: "",
    cvBase64: "",
    aiFormFillerEnabled: true,
    autoClickNextEnabled: true,
    requireHumanApproval: true,
  });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

  useEffect(() => {
    let base = "".replace(/\/$/, "");
    if (
      typeof window !== "undefined" &&
      window.location.hostname !== "localhost" &&
      window.location.hostname !== "127.0.0.1" &&
      (base.includes("localhost") || base.includes("127.0.0.1"))
    ) {
      base = "";
    }
    fetch("/api/preferences")
      .catch(() => (base ? fetch(`${base}/api/preferences`) : Promise.reject()))
      .then((r) => r.json())
      .then((data) => {
        setPrefs({
          ...DEFAULT_PREFS,
          ...data,
          radius: COMMUTE_DISTANCE_OPTIONS.some((o) => o.value === data.radius)
            ? data.radius
            : 30,
          autoApplyEnabled: data.autoApplyEnabled ?? false,
        });
        setLoading(false);
      })
      .catch(() => setLoading(false));

    fetch("/api/agent")
      .catch(() => (base ? fetch(`${base}/api/agent`) : Promise.reject()))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.profile) {
          setCandidateProfile((prev) => ({
            ...prev,
            ...data.profile,
          }));
        }
      })
      .catch(() => {});
  }, []);

  const handleCvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { setSaveError("CV must be 3 MB or smaller."); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const resultStr = typeof reader.result === "string" ? reader.result : "";
      setCandidateProfile((prev) => ({
        ...prev,
        cvFileName: file.name,
        cvBase64: resultStr,
      }));
    };
    reader.readAsDataURL(file);
  };

  const saveCandidateProfile = async () => {
    setProfileSaving(true);
    try {
      let base = "".replace(/\/$/, "");
      if (
        typeof window !== "undefined" &&
        window.location.hostname !== "localhost" &&
        window.location.hostname !== "127.0.0.1" &&
        (base.includes("localhost") || base.includes("127.0.0.1"))
      ) {
        base = "";
      }
      const init: RequestInit = {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(candidateProfile),
      };
      const response = await fetch('/api/agent', init);
      if (!response.ok) throw new Error('Candidate profile was not saved. Please retry.');
      setSaveError(null);
      window.dispatchEvent(
        new CustomEvent("agent-profile-updated")
      );
      setCandidateProfile((previous) => ({ ...previous, cvBase64: "" }));
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 3000);
    } catch (error) { setSaveError(error instanceof Error ? error.message : "Profile save failed");
    } finally {
      setProfileSaving(false);
    }
  };

  const set = <K extends keyof Prefs>(key: K, value: Prefs[K]) =>
    setPrefs((p) => ({ ...p, [key]: value }));

  const persistAndFilterImmediately = async (nextPrefs: Prefs) => {
    window.dispatchEvent(
      new CustomEvent("filters-updated", { detail: nextPrefs })
    );
    let base = "".replace(/\/$/, "");
    if (
      typeof window !== "undefined" &&
      window.location.hostname !== "localhost" &&
      window.location.hostname !== "127.0.0.1" &&
      (base.includes("localhost") || base.includes("127.0.0.1"))
    ) {
      base = "";
    }
    const init: RequestInit = {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nextPrefs),
    };
    try {
      const response = await fetch('/api/preferences', init);
      if (!response.ok) throw new Error('Preferences were not saved. Please retry.');
      setSaveError(null);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Preferences save failed');
      throw error;
    }
  };

  const addLocation = (val: string) => {
    const parts = val
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length > 0) {
      const next = [...prefs.locations];
      for (const p of parts) {
        if (!next.includes(p)) next.push(p);
      }
      const nextPrefs = { ...prefs, locations: next };
      setPrefs(nextPrefs);
      void persistAndFilterImmediately(nextPrefs).catch(() => {});
    }
    setLocationDraft("");
  };

  const removeLocation = (loc: string) => {
    const nextPrefs = {
      ...prefs,
      locations: prefs.locations.filter((l) => l !== loc),
    };
    setPrefs(nextPrefs);
    void persistAndFilterImmediately(nextPrefs).catch(() => {});
  };

  const toggleRole = (role: string) => {
    const nextKeywords = prefs.keywords.includes(role)
      ? prefs.keywords.filter((r) => r !== role)
      : [...prefs.keywords, role];
    const nextPrefs = { ...prefs, keywords: nextKeywords };
    setPrefs(nextPrefs);
    void persistAndFilterImmediately(nextPrefs).catch(() => {});
  };

  const selectedWorkHours = prefs.jobTypes[0] || "Any";
  const selectedEmploymentLength = prefs.categories[0] || "Any";

  const handleWorkHoursChange = (val: string) => {
    const nextPrefs = { ...prefs, jobTypes: val === "Any" ? [] : [val] };
    setPrefs(nextPrefs);
    void persistAndFilterImmediately(nextPrefs).catch(() => {});
  };

  const handleEmploymentLengthChange = (val: string) => {
    const nextPrefs = { ...prefs, categories: val === "Any" ? [] : [val] };
    setPrefs(nextPrefs);
    void persistAndFilterImmediately(nextPrefs).catch(() => {});
  };

  const handleRadiusChange = (val: number) => {
    const nextPrefs = { ...prefs, radius: val };
    setPrefs(nextPrefs);
    void persistAndFilterImmediately(nextPrefs).catch(() => {});
  };

  const clearAllFilters = async () => {
    const clearedPrefs: Prefs = {
      ...prefs,
      locations: [],
      keywords: [],
      categories: [],
      jobTypes: [],
      excludeKeywords: [],
      minMatchScore: 0,
      postedWithinHours: 0,
      remoteOnly: false,
      radius: 30,
    };
    setPrefs(clearedPrefs);
    setLocationDraft("");
    setSaving(true);
    try {
      await persistAndFilterImmediately(clearedPrefs);
      onSaved?.(null);
    } catch { /* Save error is displayed by persistAndFilterImmediately. */
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    const mergedLocations = [...prefs.locations];
    if (locationDraft.trim()) {
      for (const part of locationDraft
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)) {
        if (!mergedLocations.includes(part)) mergedLocations.push(part);
      }
    }

    const finalPrefs: Prefs = {
      ...prefs,
      locations: mergedLocations,
    };

    setPrefs(finalPrefs);
    setLocationDraft("");

    setSaving(true);
    try {
      await persistAndFilterImmediately(finalPrefs);
      window.dispatchEvent(
        new CustomEvent("browser-notify-preference-changed", {
          detail: { browserNotify: finalPrefs.browserNotify },
        })
      );
      setSaved(true);
      onSaved?.(null);
      setTimeout(() => setSaved(false), 3000);
    } catch { /* Save error is displayed by persistAndFilterImmediately. */
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 animate-pulse">
        <div className="h-5 bg-gray-200 rounded w-1/2 mb-4" />
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-10 bg-gray-100 rounded-xl mb-3" />
        ))}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
      {saveError && <p role="alert" className="text-red-700 p-3">{saveError}</p>}
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-bold text-gray-900 text-base flex items-center gap-2">
          ⚙️ Filters (jobsatamazon.co.uk)
        </h2>
        <button
          type="button"
          onClick={clearAllFilters}
          className="text-xs font-semibold text-blue-600 hover:text-blue-800 underline cursor-pointer"
        >
          Clear filter
        </button>
      </div>

      {/* ── 1. AI Auto-Apply Agent & Candidate Profile ── */}
      <Section title="AI Auto-Apply Agent & Candidate Profile" icon="🤖" defaultOpen={true}>
        <p className="text-xs text-gray-500 mb-3">
          Save your UK candidate details &amp; CV so the AI Agent can automatically fill Amazon UK application forms, select right-to-work options, upload your CV, and click Next/Continue.
        </p>

        <div className="grid grid-cols-2 gap-2 mb-2.5">
          <div>
            <label className="block text-[11px] font-semibold text-gray-700 mb-1">
              First Name
            </label>
            <input
              type="text"
              value={candidateProfile.firstName}
              onChange={(e) =>
                setCandidateProfile((p) => ({ ...p, firstName: e.target.value }))
              }
              placeholder="e.g. Ali"
              className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-gray-700 mb-1">
              Last Name
            </label>
            <input
              type="text"
              value={candidateProfile.lastName}
              onChange={(e) =>
                setCandidateProfile((p) => ({ ...p, lastName: e.target.value }))
              }
              placeholder="e.g. Khan"
              className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-2.5">
          <div>
            <label className="block text-[11px] font-semibold text-gray-700 mb-1">
              UK Phone Number
            </label>
            <input
              type="tel"
              value={candidateProfile.phone}
              onChange={(e) =>
                setCandidateProfile((p) => ({ ...p, phone: e.target.value }))
              }
              placeholder="+44 7700 900000"
              className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-gray-700 mb-1">
              UK Postcode
            </label>
            <input
              type="text"
              value={candidateProfile.postcode}
              onChange={(e) =>
                setCandidateProfile((p) => ({ ...p, postcode: e.target.value }))
              }
              placeholder="e.g. RM20 3ED"
              className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-2.5">
          <div>
            <label className="block text-[11px] font-semibold text-gray-700 mb-1">
              Address Line 1
            </label>
            <input
              type="text"
              value={candidateProfile.addressLine1}
              onChange={(e) =>
                setCandidateProfile((p) => ({
                  ...p,
                  addressLine1: e.target.value,
                }))
              }
              placeholder="Street address"
              className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-gray-700 mb-1">
              City / Town
            </label>
            <input
              type="text"
              value={candidateProfile.city}
              onChange={(e) =>
                setCandidateProfile((p) => ({ ...p, city: e.target.value }))
              }
              placeholder="e.g. London"
              className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
          </div>
        </div>

        <div className="mb-2.5">
          <label className="block text-[11px] font-semibold text-gray-700 mb-1">
            UK Right-to-Work Eligibility
          </label>
          <select
            value={candidateProfile.rightToWorkType}
            onChange={(e) =>
              setCandidateProfile((p) => ({
                ...p,
                rightToWorkType: e.target.value,
                declarationsConfirmed: false,
                rightToWorkUk: !["Requires Visa Sponsorship", "Not specified"].includes(e.target.value),
              }))
            }
            className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-orange-400"
          >
            <option value="Not specified">Select your actual right-to-work status</option>
            <option value="UK Citizen / Passport">UK Citizen / British Passport</option>
            <option value="Settled / Pre-Settled Status">EU Settled / Pre-Settled Status</option>
            <option value="Graduate / Skilled Worker BRP">Biometric Residence Permit (BRP / Share Code)</option>
            <option value="Student Visa (20 hrs/wk)">UK Student Visa (Term-Time Eligible)</option>
            <option value="Requires Visa Sponsorship">Requires Visa Sponsorship</option>
          </select>
        </div>

        <div className="space-y-2 mb-3 text-xs text-gray-700">
          <label className="flex gap-2 items-center"><input type="checkbox" checked={candidateProfile.over18} onChange={e => setCandidateProfile(p => ({ ...p, over18: e.target.checked, declarationsConfirmed: false }))} />I am at least 18 years old</label>
          <label className="flex gap-2 items-center"><input type="checkbox" checked={candidateProfile.previouslyWorkedAtAmazon} onChange={e => setCandidateProfile(p => ({ ...p, previouslyWorkedAtAmazon: e.target.checked, declarationsConfirmed: false }))} />I previously worked at Amazon</label>
          <label className="flex gap-2 items-center"><input type="checkbox" checked={candidateProfile.requiresVisaSponsorship} onChange={e => setCandidateProfile(p => ({ ...p, requiresVisaSponsorship: e.target.checked, declarationsConfirmed: false }))} />I require visa sponsorship</label>
          <label className="flex gap-2 items-start font-medium"><input type="checkbox" checked={candidateProfile.declarationsConfirmed} onChange={e => setCandidateProfile(p => ({ ...p, declarationsConfirmed: e.target.checked }))} />Use these saved eligibility answers on my applications. I have checked that they are accurate.</label>
        </div>
        <div className="mb-3">
          <label className="block text-[11px] font-semibold text-gray-700 mb-1">
            Upload CV / Resume (PDF or DOCX)
          </label>
          <input
            type="file"
            accept=".pdf,.doc,.docx"
            onChange={handleCvUpload}
            className="w-full text-xs text-gray-600 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-orange-100 file:text-orange-800 hover:file:bg-orange-200 cursor-pointer"
          />
          {candidateProfile.cvFileName && (
            <p className="text-[11px] text-green-700 font-medium mt-1">
              📄 Active CV: {candidateProfile.cvFileName}
            </p>
          )}
        </div>

        <div className="space-y-2 border-t border-gray-100 pt-2.5 mb-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={candidateProfile.aiFormFillerEnabled}
              onChange={(e) =>
                setCandidateProfile((p) => ({
                  ...p,
                  aiFormFillerEnabled: e.target.checked,
                }))
              }
              className="w-4 h-4 accent-orange-500"
            />
            <span className="text-xs text-gray-800 font-medium">
              Fill saved details automatically
            </span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={candidateProfile.autoClickNextEnabled} onChange={e => setCandidateProfile(p => ({ ...p, autoClickNextEnabled: e.target.checked }))} className="w-4 h-4 accent-orange-500" />
            <span className="text-xs text-gray-800 font-medium">Continue automatically to assessment</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={true}
              disabled
              className="w-4 h-4 accent-orange-500"
            />
            <span className="text-xs text-gray-800 font-medium">
              Pause before final submission (assessment always pauses)
            </span>
          </label>
        </div>

        <button
          type="button"
          onClick={saveCandidateProfile}
          disabled={profileSaving}
          className="w-full py-2 rounded-lg font-bold text-xs text-white bg-gray-900 hover:bg-gray-800 disabled:opacity-50 transition-all cursor-pointer"
        >
          {profileSaving
            ? "Saving Profile…"
            : profileSaved
            ? "✅ Candidate Profile & AI Agent Saved!"
            : "💾 Save Candidate Profile & Agent Settings"}
        </button>
      </Section>

      {/* ── 2. Location (Postcode / Location + Commute distance) ── */}
      <Section title="Location" icon="📍">
        <div className="mb-3">
          <label className="block text-xs font-semibold text-gray-700 mb-1.5">
            Postcode or Location
          </label>

          {prefs.locations.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {prefs.locations.map((loc) => (
                <span
                  key={loc}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800"
                >
                  📍 {loc}
                  <button
                    type="button"
                    onClick={() => removeLocation(loc)}
                    className="font-bold text-orange-500 hover:text-orange-700 leading-none"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="flex gap-1.5">
            <input
              value={locationDraft}
              onChange={(e) => {
                const val = e.target.value;
                if (UK_LOCATIONS_SUGGESTIONS.includes(val.trim())) {
                  addLocation(val);
                  return;
                }
                setLocationDraft(val);
              }}
              onBlur={() => {
                if (locationDraft.trim()) addLocation(locationDraft);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addLocation(locationDraft);
                }
              }}
              placeholder="Enter postcode or city (e.g. Dundee, EH48 2FB)"
              list="uk-postcode-location-list"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
            <datalist id="uk-postcode-location-list">
              {UK_LOCATIONS_SUGGESTIONS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <button
              type="button"
              onClick={() => addLocation(locationDraft)}
              className="px-3 py-2 rounded-lg bg-orange-100 text-orange-700 font-bold text-sm hover:bg-orange-200 transition-colors"
            >
              +
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1.5">
            Commute distance
          </label>
          <select
            value={prefs.radius}
            onChange={(e) => handleRadiusChange(Number(e.target.value))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-orange-400"
          >
            {COMMUTE_DISTANCE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </Section>

      {/* ── 2. Availability (Work hours + Length of employment) ── */}
      <Section title="Availability" icon="🕒">
        <div className="mb-3">
          <label className="block text-xs font-semibold text-gray-700 mb-1.5">
            Work hours
          </label>
          <select
            value={selectedWorkHours}
            onChange={(e) => handleWorkHoursChange(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-orange-400"
          >
            {WORK_HOURS_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1.5">
            Length of employment
          </label>
          <select
            value={selectedEmploymentLength}
            onChange={(e) => handleEmploymentLengthChange(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-orange-400"
          >
            {LENGTH_OF_EMPLOYMENT_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
      </Section>

      {/* ── 3. Job Types — Role (Exact 9 roles from jobsatamazon.co.uk) ── */}
      <Section title="Job Types — Role" icon="👷">
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          Role
        </label>
        <div className="flex flex-col gap-2">
          {AMAZON_UK_ROLES.map((role) => {
            const selected = prefs.keywords.includes(role);
            return (
              <button
                key={role}
                type="button"
                onClick={() => toggleRole(role)}
                className={`w-full text-left px-3.5 py-2.5 rounded-lg text-xs font-semibold border transition-all flex items-center justify-between ${
                  selected
                    ? "bg-blue-50 border-blue-600 text-blue-900 shadow-sm"
                    : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
                }`}
              >
                <span>{role}</span>
                {selected && (
                  <span className="text-blue-600 font-bold text-sm">✓</span>
                )}
              </button>
            );
          })}
        </div>
      </Section>

      {/* ── 5. Auto-Apply & Notifications ── */}
      <Section title="Auto-Apply & Alerts" icon="🚀" defaultOpen={true}>
        <label className="flex items-center gap-3 cursor-pointer mb-3">
          <div
            onClick={() => set("autoApplyEnabled", !prefs.autoApplyEnabled)}
            className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${
              prefs.autoApplyEnabled ? "bg-orange-500" : "bg-gray-200"
            }`}
          >
            <span
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                prefs.autoApplyEnabled ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </div>
          <div>
            <span className="text-sm text-gray-800 font-medium block">
              Prepare applications (100% match only)
            </span>
            <span className="text-xs text-gray-400">
              Prepares matching applications. Review eligibility and submit manually on Amazon.
            </span>
          </div>
        </label>

        <label className="flex items-center gap-3 cursor-pointer mb-3">
          <input
            type="checkbox"
            checked={prefs.browserNotify}
            onChange={(e) => set("browserNotify", e.target.checked)}
            className="w-4 h-4 accent-orange-500"
          />
          <div>
            <span className="text-sm text-gray-700 font-medium block">
              Browser sound & desktop alerts
            </span>
          </div>
        </label>

        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Poll every {prefs.pollIntervalMins} min
            {prefs.pollIntervalMins > 1 ? "s" : ""}
          </label>
          <input
            type="range"
            min={1}
            max={30}
            step={1}
            value={prefs.pollIntervalMins}
            onChange={(e) => set("pollIntervalMins", Number(e.target.value))}
            className="w-full accent-orange-500"
          />
        </div>
      </Section>

      {/* Action buttons (Clear filter + Apply Filters) */}
      <div className="flex gap-2 mt-2">
        <button
          type="button"
          onClick={clearAllFilters}
          disabled={saving}
          className="px-4 py-3 rounded-xl font-semibold text-sm text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 transition-all"
        >
          Clear filter
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="flex-1 py-3 rounded-xl font-bold text-sm text-white bg-orange-500 hover:bg-orange-600 disabled:opacity-50 transition-all"
        >
          {saving ? "Applying…" : saved ? "✅ Filters Applied!" : "Apply Filters"}
        </button>
      </div>
    </div>
  );
}
