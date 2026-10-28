import { NextRequest } from "next/server";
import { MongoClient, Db } from "mongodb";

const CSRF_URL =
  "https://www.jobsatamazon.co.uk/authorize/api/csrf?countryCode=UK";
const GRAPHQL_URL = "https://www.jobsatamazon.co.uk/graphql";

const DEFAULT_DB_URL =
  process.env.DATABASE_URL ||
  [
    "mongodb+srv://muzammilk1763_db_user:Muzammil@",
    "cluster0.tfieyg1.mongodb.net/amazonjobtool?retryWrites=true&w=majority&appName=Cluster0",
  ].join("");

const PROFILE_MARKER_ID = "__CANDIDATE_PROFILE__";

const BASE_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-GB,en;q=0.9",
  Referer: "https://www.jobsatamazon.co.uk/app",
  Origin: "https://www.jobsatamazon.co.uk",
};

const SEARCH_JOB_CARDS_QUERY = `query searchJobCardsByLocation($searchJobRequest: SearchJobRequest!) {
  searchJobCardsByLocation(searchJobRequest: $searchJobRequest) {
    nextToken
    jobCards {
      jobId
      jobUuid
      language
      dataSource
      requisitionType
      jobTitle
      jobType
      employmentType
      city
      state
      postalCode
      locationName
      totalPayRateMin
      totalPayRateMax
      tagLine
      bannerText
      scheduleCount
      currencyCode
      geoClusterDescription
      jobTypeL10N
      employmentTypeL10N
      totalPayRateMinL10N
      totalPayRateMaxL10N
    }
  }
}`;

const SEARCH_SCHEDULE_CARDS_QUERY = `query searchScheduleCards($searchScheduleRequest: SearchScheduleRequest!) {
  searchScheduleCards(searchScheduleRequest: $searchScheduleRequest) {
    nextToken
    scheduleCards {
      scheduleId
      scheduleUuid
      jobId
      externalJobTitle
      hireStartDate
      hoursPerWeek
      scheduleText
      city
      postalCode
      address
      totalPayRateL10N
      laborDemandAvailableCount
    }
  }
}`;

export interface HourlyJob {
  id: string;
  jobId: string;
  scheduleId: string;
  title: string;
  location: string;
  city: string;
  country: string;
  jobType: string;
  category: string;
  description: string;
  applyUrl: string;
  postedAt: string;
  isNew?: boolean;
  matchScore?: number;
  passes?: boolean;
  autoApplied?: boolean;
  appliedAt?: string | null;
  applicationStatus?: string | null;
}

export interface Prefs {
  id?: string;
  locations?: string[];
  radius?: number;
  keywords?: string[];
  categories?: string[];
  jobTypes?: string[];
  excludeKeywords?: string[];
  minMatchScore?: number;
  postedWithinHours?: number;
  remoteOnly?: boolean;
  autoApplyEnabled?: boolean;
  autoApplyMinScore?: number;
  amazonEmail?: string;
  amazonPassword?: string;
  hasAmazonPassword?: boolean;
  emailEnabled?: boolean;
  emailAddress?: string;
  emailMinScore?: number;
  browserNotify?: boolean;
  pollIntervalMins?: number;
}

interface RawJobCard {
  jobId?: string;
  id?: string;
  scheduleId?: string;
  jobTitle?: string;
  title?: string;
  geoClusterDescription?: string;
  locationName?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  jobTypeL10N?: string;
  jobType?: string;
  employmentTypeL10N?: string;
  employmentType?: string;
  totalPayRateMinL10N?: string;
  totalPayRateMin?: number;
  totalPayRateMaxL10N?: string;
  totalPayRateMax?: number;
  tagLine?: string;
  scheduleCount?: number;
}

interface RawScheduleCard {
  scheduleId?: string;
  jobId?: string;
  externalJobTitle?: string;
  hireStartDate?: string;
  hoursPerWeek?: number;
  scheduleText?: string;
  city?: string;
  postalCode?: string;
  totalPayRateL10N?: string;
  laborDemandAvailableCount?: number;
}

// ── MongoDB Singleton Connection ─────────────────────────────────────────────
const globalForMongo = globalThis as unknown as {
  _mongoClientPromise?: Promise<MongoClient>;
};

export async function getDb(): Promise<Db | null> {
  try {
    if (!globalForMongo._mongoClientPromise) {
      const client = new MongoClient(DEFAULT_DB_URL, {
        maxPoolSize: 5,
        serverSelectionTimeoutMS: 5000,
      });
      globalForMongo._mongoClientPromise = client.connect();
    }
    const client = await globalForMongo._mongoClientPromise;
    return client.db("amazonjobtool");
  } catch {
    globalForMongo._mongoClientPromise = undefined;
    return null;
  }
}

let cachedToken: string | null = null;
let cachedTokenExpiresAt = 0;
let cachedJobs: HourlyJob[] | null = null;
let cachedJobsExpiresAt = 0;
let cachedFetchedAt: string | null = null;
let cachedUnverifiedJobs = 0;
const scheduleCache = new Map<
  string,
  { cards: RawScheduleCard[]; expiresAt: number }
>();
const availabilityGlobal = globalThis as typeof globalThis & { rejectedAmazonSchedules?: Map<string, number> };
const rejectedSchedules = availabilityGlobal.rejectedAmazonSchedules ??= new Map<string, number>();
export function markScheduleUnavailable(jobId: string, scheduleId: string) {
  rejectedSchedules.set(`${jobId}:${scheduleId}`, Date.now() + 10 * 60 * 1000);
  scheduleCache.delete(jobId); cachedJobsExpiresAt = 0;
}
function wasRejected(jobId: string, scheduleId: string) {
  const key = `${jobId}:${scheduleId}`, until = rejectedSchedules.get(key);
  if (until && until > Date.now()) return true;
  rejectedSchedules.delete(key); return false;
}

let memoryPrefs: Prefs = {
  locations: [],
  radius: 30,
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
  emailEnabled: false,
  emailAddress: "",
  emailMinScore: 50,
  browserNotify: true,
  pollIntervalMins: 1,
};

let memoryProfile: Record<string, unknown> = {
  firstName: "",
  lastName: "",
  phone: "",
  postcode: "",
  addressLine1: "",
  city: "",
  rightToWorkType: "Not specified",
  rightToWorkUk: false,
  over18: false,
  previouslyWorkedAtAmazon: false,
  requiresVisaSponsorship: false,
  declarationsConfirmed: false,
  cvFileName: "",
  aiFormFillerEnabled: true,
  autoClickNextEnabled: true,
  requireHumanApproval: true,
};

let memoryAppliedJobs: HourlyJob[] = [];
const memorySeenIds = new Set<string>();

export function buildJobsAtAmazonUrl(jobId: string, scheduleId = ""): string {
  if (!jobId) return "https://www.jobsatamazon.co.uk/app#/jobSearch";
  const jId = encodeURIComponent(String(jobId));
  const schedParam = scheduleId
    ? `&scheduleId=${encodeURIComponent(String(scheduleId))}`
    : "";
  return `https://www.jobsatamazon.co.uk/application/uk/?CS=true&jobId=${jId}&locale=en-GB${schedParam}&resumeApplicationLogicOnReturnFromAuth=true#/consent?CS=true&jobId=${jId}&locale=en-GB${schedParam}&resumeApplicationLogicOnReturnFromAuth=true`;
}

async function getHvhToken(forceRefresh = false): Promise<string> {
  const now = Date.now();
  if (!forceRefresh && cachedToken && now < cachedTokenExpiresAt) {
    return cachedToken;
  }
  const res = await fetch(CSRF_URL, {
    headers: BASE_HEADERS,
    cache: "no-store",
  });
  const data = (await res.json()) as { token?: string };
  if (!data?.token) {
    throw new Error("Failed to obtain CSRF token from jobsatamazon.co.uk");
  }
  cachedToken = data.token;
  cachedTokenExpiresAt = now + 10 * 60 * 1000;
  return cachedToken;
}

export async function fetchSchedulesForJob(
  jobId: string,
  forceRefresh = false
): Promise<RawScheduleCard[]> {
  if (!jobId) return [];
  const now = Date.now();
  const hit = scheduleCache.get(jobId);
  if (!forceRefresh && hit && now < hit.expiresAt) return hit.cards.filter(card => isAvailableSchedule(card) && !wasRejected(jobId, card.scheduleId || ""));

  try {
    const token = await getHvhToken(false);
    const today = ukToday();
    const searchScheduleRequest = {
      locale: "en-GB",
      country: "United Kingdom",
      keyWords: "",
      equalFilters: [],
      containFilters: [{ key: "isPrivateSchedule", val: ["false"] }],
      rangeFilters: [],
      orFilters: [],
      dateFilters: [{ key: "firstDayOnSite", range: { startDate: today } }],
      sorters: [{ fieldName: "totalPayRateMax", ascending: "false" }],
      pageSize: 25,
      jobId,
      consolidateSchedule: true,
    };

    const res = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: {
        ...BASE_HEADERS,
        "Content-Type": "application/json",
        Authorization: `Bearer Status|unauthenticated|Session|${token}`,
        "x-amz-access-token": token,
      },
      body: JSON.stringify({
        operationName: "searchScheduleCards",
        variables: { searchScheduleRequest },
        query: SEARCH_SCHEDULE_CARDS_QUERY,
      }),
      cache: "no-store",
    });
    const json = (await res.json()) as {
      errors?: unknown[];
      data?: { searchScheduleCards?: { scheduleCards?: RawScheduleCard[] } };
    };
    const rawCards = json?.data?.searchScheduleCards?.scheduleCards;
    if (!res.ok || json.errors?.length || !Array.isArray(rawCards)) {
      throw new Error("Live schedule availability could not be verified. Please retry.");
    }
    const cards = rawCards
      .filter((s) => (!s.jobId || s.jobId === jobId) && isAvailableSchedule(s) && !wasRejected(jobId, s.scheduleId || ""))
      .sort(
        (a, b) =>
          (b.laborDemandAvailableCount ?? 1) -
          (a.laborDemandAvailableCount ?? 1)
      );
    scheduleCache.set(jobId, { cards, expiresAt: Date.now() + 8_000 });
    return cards;
  } catch (error) {
    scheduleCache.delete(jobId);
    throw error;
  }
}

function ukToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function isAvailableSchedule(schedule: RawScheduleCard): boolean {
  const startDate = schedule.hireStartDate?.slice(0, 10);
  return Boolean(
    schedule.scheduleId &&
    typeof schedule.laborDemandAvailableCount === "number" &&
    schedule.laborDemandAvailableCount > 0 &&
    (!startDate || (/^\d{4}-\d{2}-\d{2}$/.test(startDate) && startDate >= ukToday()))
  );
}

function normaliseJob(
  raw: RawJobCard,
  schedules: RawScheduleCard[] = []
): HourlyJob {
  const id = String(raw.jobId || raw.id || "");
  const bestSchedule =
    schedules.find((s) => (s.laborDemandAvailableCount ?? 1) > 0) ||
    schedules[0];
  const scheduleId = bestSchedule?.scheduleId || raw.scheduleId || "";

  const title =
    raw.jobTitle ||
    bestSchedule?.externalJobTitle ||
    raw.title ||
    "Amazon Warehouse Associate";
  const area = raw.geoClusterDescription || raw.locationName || "";
  const fallbackCity = (raw.locationName || raw.geoClusterDescription || "")
    .replace(/^Locations\s+Near\s+/i, "")
    .replace(/\s*Area$/i, "")
    .replace(/,\s*UK$/i, "")
    .trim();
  const city = raw.city || bestSchedule?.city || fallbackCity || "";
  const state = raw.state || "United Kingdom";
  const postalCode = raw.postalCode || bestSchedule?.postalCode || "";

  const locationParts = [city, state].filter(Boolean).join(", ");
  const locationStr = postalCode
    ? `${locationParts} (${postalCode})`
    : locationParts || area || "United Kingdom";

  const jobType = raw.jobTypeL10N || raw.jobType || "Full Time";
  const rawEmp = raw.employmentTypeL10N || raw.employmentType || "Fixed-term";
  const employmentType =
    rawEmp.toLowerCase().includes("regular") ||
    rawEmp.toLowerCase().includes("permanent")
      ? "Permanent"
      : "Fixed-term";
  const payMin =
    raw.totalPayRateMinL10N ||
    bestSchedule?.totalPayRateL10N ||
    (raw.totalPayRateMin ? `£${raw.totalPayRateMin}` : "");
  const payMax =
    raw.totalPayRateMaxL10N ||
    (raw.totalPayRateMax ? `£${raw.totalPayRateMax}` : "");
  const payDisplay =
    payMin && payMax && payMin !== payMax
      ? `${payMin} - ${payMax}/hr`
      : payMin
      ? `From ${payMin}/hr`
      : "";

  const descParts = [
    raw.tagLine,
    payDisplay ? `Pay rate: ${payDisplay}` : "",
    `Duration: ${employmentType}`,
    bestSchedule?.scheduleText ? `Shift: ${bestSchedule.scheduleText}` : "",
    bestSchedule?.hireStartDate ? `Start: ${bestSchedule.hireStartDate}` : "",
    raw.scheduleCount ? `${raw.scheduleCount} shift(s) available` : "",
    area && area !== city ? `Area: ${area}` : "",
  ].filter(Boolean);

  return {
    id,
    jobId: id,
    scheduleId,
    title,
    location: locationStr,
    city,
    country: "GB",
    jobType,
    category: employmentType,
    description:
      descParts.join(" • ") || "Amazon UK Fulfilment & Delivery Associate role.",
    applyUrl: buildJobsAtAmazonUrl(id, scheduleId),
    postedAt: new Date().toISOString(),
  };
}

export async function fetchAllUKHourlyJobs(): Promise<{
  jobs: HourlyJob[];
  fetchedAt: string;
  unverifiedJobs: number;
}> {
  const now = Date.now();
  if (cachedJobs && cachedFetchedAt && now < cachedJobsExpiresAt) {
    return { jobs: cachedJobs.filter(job => !wasRejected(job.id, job.scheduleId)), fetchedAt: cachedFetchedAt, unverifiedJobs: cachedUnverifiedJobs };
  }

  let token = await getHvhToken(false);
  const rawList: RawJobCard[] = [];
  let nextToken: string | undefined;
  const cursors = new Set<string>();

  do {
    const searchJobRequest = {
      locale: "en-GB",
      country: "United Kingdom",
      keyWords: "",
      equalFilters: [],
      containFilters: [{ key: "isPrivateSchedule", val: ["false"] }],
      rangeFilters: [],
      orFilters: [],
      dateFilters: [{ key: "firstDayOnSite", range: { startDate: ukToday() } }],
      sorters: [{ fieldName: "totalPayRateMax", ascending: "false" }],
      pageSize: 100,
      consolidateSchedule: true,
      ...(nextToken ? { nextToken } : {}),
    };

    const send = async (tok: string) =>
      fetch(GRAPHQL_URL, {
        method: "POST",
        headers: {
          ...BASE_HEADERS,
          "Content-Type": "application/json",
          Authorization: `Bearer Status|unauthenticated|Session|${tok}`,
          "x-amz-access-token": tok,
        },
        body: JSON.stringify({
          operationName: "searchJobCardsByLocation",
          variables: { searchJobRequest },
          query: SEARCH_JOB_CARDS_QUERY,
        }),
        cache: "no-store",
      });

    let res = await send(token);
    if (res.status === 401 || res.status === 403) {
      token = await getHvhToken(true);
      res = await send(token);
    }
    const data = (await res.json()) as {
      errors?: unknown[];
      data?: {
        searchJobCardsByLocation?: {
          nextToken?: string;
          jobCards?: RawJobCard[];
        };
      };
    };
    const result = data?.data?.searchJobCardsByLocation;
    if (!res.ok || data.errors?.length || !Array.isArray(result?.jobCards)) {
      throw new Error("Official UK jobs could not be verified. Please retry.");
    }
    const cards = Array.isArray(result?.jobCards) ? result.jobCards : [];
    for (const card of cards) {
      const id = card.jobId || card.id || "";
      if (!/^(JOB-UK-[A-Za-z0-9_-]+|a0R[A-Za-z0-9]+)$/.test(id)) continue;
      rawList.push(card);
    }
    nextToken = result?.nextToken || undefined;
    if (nextToken && cursors.has(nextToken)) break;
    if (nextToken) cursors.add(nextToken);
  } while (nextToken && rawList.length < 500);

  const map = new Map<string, HourlyJob>();
  const unique = Array.from(new Map(rawList.map((raw) => [String(raw.jobId || raw.id), raw])).values());
  let unverifiedJobs = 0;
  let firstFailure: unknown;
  // Bound requests while verifying every job, including jobs with stale summary counts.
  for (let offset = 0; offset < unique.length; offset += 8) {
    const verified = await Promise.allSettled(unique.slice(offset, offset + 8).map(async (raw) => {
      const id = String(raw.jobId || raw.id || "");
      const schedules = await fetchSchedulesForJob(id);
      return schedules.length ? normaliseJob(raw, schedules) : null;
    }));
    for (const result of verified) {
      if (result.status === "fulfilled") { if (result.value) map.set(result.value.id, result.value); }
      else { unverifiedJobs++; firstFailure ??= result.reason; }
    }
  }
  // A partial response may contain verified shifts, but never present total failure as zero vacancies.
  if (unique.length > 0 && unverifiedJobs === unique.length) {
    throw firstFailure instanceof Error ? firstFailure : new Error("Amazon's live shift checks are temporarily unavailable. Please retry.");
  }
  const jobs = Array.from(map.values());
  const fetchedAt = new Date().toISOString();
  cachedJobs = jobs;
  cachedFetchedAt = fetchedAt;
  cachedUnverifiedJobs = unverifiedJobs;
  cachedJobsExpiresAt = Date.now() + 8_000;
  return { jobs, fetchedAt, unverifiedJobs };
}

// ── Matcher helpers ──────────────────────────────────────────────────────────
const UK_COORDS: Record<string, [number, number]> = {
  london: [51.5074, -0.1278],
  birmingham: [52.4862, -1.8904],
  manchester: [53.4808, -2.2426],
  liverpool: [53.4084, -2.9916],
  leeds: [53.8008, -1.5491],
  sheffield: [53.3811, -1.4701],
  bristol: [51.4545, -2.5879],
  glasgow: [55.8642, -4.2518],
  edinburgh: [55.9533, -3.1883],
  cardiff: [51.4816, -3.1791],
  belfast: [54.5973, -5.9301],
  newcastle: [54.9783, -1.6178],
  nottingham: [52.9548, -1.1581],
  leicester: [52.6369, -1.1398],
  coventry: [52.4068, -1.5197],
  "milton keynes": [52.0406, -0.7594],
  northampton: [52.2405, -0.9027],
  dunfermline: [56.0719, -3.4393],
  dundee: [56.462, -2.9707],
  bathgate: [55.9022, -3.6435],
  "garden city": [53.2045, -3.0229],
  deeside: [53.2045, -3.0229],
  chester: [53.193, -2.8931],
  carlisle: [54.8925, -2.9329],
  "bognor regis": [50.7828, -0.6746],
  ipswich: [52.0567, 1.1482],
  norwich: [52.6309, 1.2974],
  plymouth: [50.3755, -4.1427],
  exeter: [50.7184, -3.5339],
  "port talbot": [51.5906, -3.7986],
  swansea: [51.6214, -3.9436],
  rochester: [51.3889, 0.5056],
  dartford: [51.4462, 0.2146],
  tilbury: [51.4616, 0.3578],
  thurrock: [51.4816, 0.2831],
  rm: [51.4816, 0.2831],
  rm20: [51.4816, 0.2831],
  me: [51.3889, 0.5056],
  da: [51.4462, 0.2146],
  ig: [51.5397, 0.0808],
  en: [51.6522, -0.0808],
  e: [51.5465, -0.016],
  se: [51.4627, -0.0359],
  sw: [51.4613, -0.1657],
  nw: [51.5492, -0.1945],
  w: [51.5136, -0.2143],
  ub: [51.5465, -0.4783],
  tw: [51.4826, -0.3082],
  cr: [51.3762, -0.0982],
  br: [51.406, 0.0132],
  cm: [51.7356, 0.4685],
  ss: [51.5459, 0.7077],
  lu: [51.8787, -0.42],
  mk: [52.0406, -0.7594],
  nn: [52.2405, -0.9027],
  le: [52.6369, -1.1398],
  ng: [52.9548, -1.1581],
  de: [52.9225, -1.4746],
  cv: [52.4068, -1.5197],
  b: [52.4862, -1.8904],
  m: [53.4808, -2.2426],
  l: [53.4084, -2.9916],
  wa: [53.39, -2.597],
  ls: [53.8008, -1.5491],
  s: [53.3811, -1.4701],
  dn: [53.5228, -1.1285],
  ne: [54.9783, -1.6178],
  eh: [55.9022, -3.6435],
  ky: [56.0719, -3.4393],
  g: [55.8642, -4.2518],
  cf: [51.4816, -3.1791],
  sa: [51.5906, -3.7986],
  bs: [51.4545, -2.5879],
  sn: [51.5558, -1.7797],
  so: [50.9097, -1.4044],
  po: [50.7828, -0.6746],
  bn: [50.8225, -0.1372],
  rh: [51.1091, -0.1872],
};

function cleanList(arr?: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((s) => String(s).trim()).filter(Boolean);
}

function normaliseSpelling(text: string): string {
  return String(text || "")
    .toLowerCase()
    .replace(/fulfillment/g, "fulfilment")
    .replace(/center/g, "centre");
}

function extractTokens(phrase: string): string[] {
  return normaliseSpelling(phrase)
    .split(/[\s,&/+-]+/)
    .map((t) => t.trim())
    .filter(
      (t) =>
        t.length >= 2 && !["and", "the", "for", "with", "area", "uk"].includes(t)
    );
}

function haversineMiles(
  [lat1, lon1]: [number, number],
  [lat2, lon2]: [number, number]
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function resolveUkCoords(text: string): [number, number][] {
  if (!text) return [];
  const lower = String(text).toLowerCase().trim();
  const found: [number, number][] = [];
  const postcodeRegex = /\b(([a-z]{1,2})\d[a-z\d]?)(?:\s*\d[a-z]{2})?\b/gi;
  let match: RegExpExecArray | null;
  while ((match = postcodeRegex.exec(lower)) !== null) {
    const outward = match[1].toLowerCase();
    const areaLetters = match[2].toLowerCase();
    if (UK_COORDS[outward]) found.push(UK_COORDS[outward]);
    else if (UK_COORDS[areaLetters]) found.push(UK_COORDS[areaLetters]);
  }
  for (const [key, coords] of Object.entries(UK_COORDS)) {
    if (key.length >= 3 && !/\d/.test(key)) {
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`\\b${escaped}\\b`, "i").test(lower)) {
        found.push(coords);
      }
    }
  }
  return found;
}

function getMinDistanceMiles(userLocs: string[], jobText: string): number | null {
  const jobCoords = resolveUkCoords(jobText);
  if (jobCoords.length === 0) return null;
  let minMiles: number | null = null;
  for (const uLoc of userLocs) {
    const uCoordsList = resolveUkCoords(uLoc);
    for (const uCoord of uCoordsList) {
      for (const jCoord of jobCoords) {
        const dist = haversineMiles(uCoord, jCoord);
        if (minMiles === null || dist < minMiles) minMiles = dist;
      }
    }
  }
  return minMiles;
}

export function hasActiveFilters(prefs?: Prefs | null): boolean {
  if (!prefs) return false;
  return (
    cleanList(prefs.locations).length > 0 ||
    cleanList(prefs.keywords).length > 0 ||
    cleanList(prefs.categories).length > 0 ||
    cleanList(prefs.jobTypes).length > 0 ||
    cleanList(prefs.excludeKeywords).length > 0 ||
    (prefs.postedWithinHours ?? 0) > 0 ||
    Boolean(prefs.remoteOnly) ||
    (prefs.minMatchScore ?? 0) > 0
  );
}

function matchesSingleLocation(
  loc: string,
  jobLocText: string,
  jobLocNoSpace: string
): boolean {
  const l = normaliseSpelling(loc).trim();
  if (!l) return false;
  const lNoSpace = l.replace(/\s+/g, "");
  const fullPostcodeMatch = /^([a-z]{1,2}\d[a-z\d]?)\s*\d[a-z]{2}$/i.exec(l);
  if (fullPostcodeMatch) {
    if (jobLocNoSpace.includes(lNoSpace)) return true;
    const outward = fullPostcodeMatch[1];
    return new RegExp(`\\b${outward}(?:\\s*\\d[a-z]{2})?\\b`, "i").test(
      jobLocText
    );
  }
  if (/^[a-z]{1,2}\d[a-z\d]?$/i.test(l)) {
    return new RegExp(`\\b${lNoSpace}(?:\\s*\\d[a-z]{2})?\\b`, "i").test(
      jobLocText
    );
  }
  const escaped = l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`\\b${escaped}\\b`, "i").test(jobLocText)) return true;
  const tokens = extractTokens(l);
  return (
    tokens.length > 0 &&
    tokens.every((t) => {
      const tokEsc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`\\b${tokEsc}\\b`, "i").test(jobLocText);
    })
  );
}

function matchesRole(job: HourlyJob, keyword: string): boolean {
  const title = normaliseSpelling(job.title || "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const role = normaliseSpelling(keyword)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!role) return false;
  if (role.includes("delivery station"))
    return (
      title.includes("delivery station") &&
      /warehouse|associate|operative/.test(title)
    );
  if (role.includes("sortation")) return title.includes("sortation");
  if (role.includes("fulfilment"))
    return (
      title.includes("fulfilment") ||
      /^(amazon )?warehouse (associate|operative)$/.test(title)
    );
  const tokens = extractTokens(role);
  return (
    tokens.length > 0 &&
    tokens.every((token) => new RegExp(`\\b${token}\\b`).test(title))
  );
}

export function passesHardFilters(job: HourlyJob, prefs?: Prefs | null): boolean {
  if (!prefs) return true;
  const excludeKeywords = cleanList(prefs.excludeKeywords);
  if (excludeKeywords.length > 0) {
    const titleDesc = normaliseSpelling(`${job.title} ${job.description}`);
    if (excludeKeywords.some((kw) => titleDesc.includes(normaliseSpelling(kw))))
      return false;
  }
  const locations = cleanList(prefs.locations);
  if (locations.length > 0) {
    const jobLocOnly = normaliseSpelling(`${job.location} ${job.city}`);
    const jobLocText = normaliseSpelling(
      `${job.location} ${job.city} ${job.title}`
    );
    const jobLocNoSpace = jobLocText.replace(/\s+/g, "");
    let locationMatch = locations.some((loc) =>
      matchesSingleLocation(loc, jobLocText, jobLocNoSpace)
    );
    if (!locationMatch) {
      const dist = getMinDistanceMiles(locations, jobLocOnly);
      const radiusMiles = Number(prefs.radius) || 30;
      if (dist !== null && dist <= radiusMiles) locationMatch = true;
    }
    if (!locationMatch) return false;
  }
  const keywords = cleanList(prefs.keywords);
  if (keywords.length > 0) {
    if (!keywords.some((kw) => matchesRole(job, kw))) return false;
  }
  const categories = cleanList(prefs.categories);
  if (categories.length > 0) {
    const catText = normaliseSpelling(
      `${job.category} ${job.title} ${job.description}`
    );
    const catMatch = categories.some((cat) => {
      const c = normaliseSpelling(cat);
      if (c === "any") return true;
      if (c.includes("permanent"))
        return catText.includes("permanent") || catText.includes("regular");
      if (c.includes("fixed"))
        return (
          catText.includes("fixed") ||
          catText.includes("seasonal") ||
          catText.includes("temporary")
        );
      return catText.includes(c);
    });
    if (!catMatch) return false;
  }
  const jobTypes = cleanList(prefs.jobTypes);
  if (jobTypes.length > 0 && job.jobType) {
    const jtLower = job.jobType.toLowerCase();
    const normJobType = jtLower.replace(/[-_\s]/g, "");
    const typeMatch = jobTypes.some((t) => {
      const tl = t.toLowerCase();
      if (tl === "any") return true;
      if (tl.includes("full"))
        return jtLower.includes("full") || jtLower.includes("reduced");
      if (tl.includes("part"))
        return jtLower.includes("part") || jtLower.includes("flex");
      const normT = tl.replace(/[-_\s]/g, "");
      return normJobType.includes(normT) || normT.includes(normJobType);
    });
    if (!typeMatch) return false;
  }
  return true;
}

export function scoreJob(job: HourlyJob, prefs?: Prefs | null): number {
  if (!prefs) return 85;
  let score = 0;
  let factors = 0;
  const locations = cleanList(prefs.locations);
  const keywords = cleanList(prefs.keywords);
  const categories = cleanList(prefs.categories);
  const jobTypes = cleanList(prefs.jobTypes);

  const jobLocOnly = normaliseSpelling(`${job.location} ${job.city}`);
  const jobLocText = normaliseSpelling(
    `${job.location} ${job.city} ${job.title}`
  );
  const jobLocNoSpace = jobLocText.replace(/\s+/g, "");

  if (locations.length > 0) {
    factors += 35;
    if (
      locations.some((loc) =>
        matchesSingleLocation(loc, jobLocText, jobLocNoSpace)
      )
    ) {
      score += 35;
    } else {
      const dist = getMinDistanceMiles(locations, jobLocOnly);
      const radiusMiles = Number(prefs.radius) || 30;
      if (dist !== null && dist <= radiusMiles) score += 35;
    }
  }
  if (keywords.length > 0) {
    factors += 35;
    if (keywords.some((kw) => matchesRole(job, kw))) score += 35;
  }
  if (categories.length > 0) {
    factors += 20;
    score += 20;
  }
  if (jobTypes.length > 0) {
    factors += 10;
    score += 10;
  }
  if (factors === 0) return 85;
  if (passesHardFilters(job, prefs) && score >= factors) return 100;
  return Math.min(99, Math.max(0, Math.round((score / factors) * 95)));
}

// ── Preferences (MongoDB UserPreferences) ───────────────────────────────────
export async function getStoredPreferences(): Promise<Prefs> {
  const db = await getDb();
  if (db) {
    const doc = await db.collection("UserPreferences").findOne({});
    if (doc) {
      const { _id, amazonPassword, ...rest } = doc;
      const safe: Prefs = {
        ...memoryPrefs,
        ...(rest as Prefs),
        id: String(_id),
        hasAmazonPassword: Boolean(amazonPassword),
      };
      memoryPrefs = safe;
      return safe;
    }
  }
  return memoryPrefs;
}

export async function handlePreferencesRequest(
  req: NextRequest,
  rawBody?: string
): Promise<Response> {
  if (req.method === "GET") {
    const prefs = await getStoredPreferences();
    return Response.json(prefs, { headers: { "Cache-Control": "no-store" } });
  }

  try {
    const incoming = JSON.parse(rawBody || "{}") as Record<string, unknown>;
    const current = await getStoredPreferences();
    const updateData: Record<string, unknown> = {
      locations: Array.isArray(incoming.locations)
        ? cleanList(incoming.locations)
        : current.locations ?? [],
      radius:
        incoming.radius !== undefined
          ? Number(incoming.radius) || 30
          : current.radius ?? 30,
      keywords: Array.isArray(incoming.keywords)
        ? cleanList(incoming.keywords)
        : current.keywords ?? [],
      categories: Array.isArray(incoming.categories)
        ? cleanList(incoming.categories)
        : current.categories ?? [],
      jobTypes: Array.isArray(incoming.jobTypes)
        ? cleanList(incoming.jobTypes)
        : current.jobTypes ?? [],
      excludeKeywords: Array.isArray(incoming.excludeKeywords)
        ? cleanList(incoming.excludeKeywords)
        : current.excludeKeywords ?? [],
      minMatchScore:
        incoming.minMatchScore !== undefined
          ? Number(incoming.minMatchScore) || 0
          : current.minMatchScore ?? 0,
      postedWithinHours:
        incoming.postedWithinHours !== undefined
          ? Number(incoming.postedWithinHours) || 0
          : current.postedWithinHours ?? 0,
      remoteOnly:
        incoming.remoteOnly !== undefined
          ? Boolean(incoming.remoteOnly)
          : Boolean(current.remoteOnly),
      autoApplyEnabled:
        incoming.autoApplyEnabled !== undefined
          ? Boolean(incoming.autoApplyEnabled)
          : Boolean(current.autoApplyEnabled),
      autoApplyMinScore:
        incoming.autoApplyMinScore !== undefined
          ? Number(incoming.autoApplyMinScore) || 100
          : current.autoApplyMinScore ?? 100,
      amazonEmail:
        typeof incoming.amazonEmail === "string"
          ? incoming.amazonEmail.trim()
          : current.amazonEmail ?? "",
      emailEnabled:
        incoming.emailEnabled !== undefined
          ? Boolean(incoming.emailEnabled)
          : Boolean(current.emailEnabled),
      emailAddress:
        typeof incoming.emailAddress === "string"
          ? incoming.emailAddress.trim()
          : current.emailAddress ?? "",
      emailMinScore:
        incoming.emailMinScore !== undefined
          ? Number(incoming.emailMinScore) || 50
          : current.emailMinScore ?? 50,
      browserNotify:
        incoming.browserNotify !== undefined
          ? Boolean(incoming.browserNotify)
          : current.browserNotify ?? true,
      pollIntervalMins:
        incoming.pollIntervalMins !== undefined
          ? Math.max(1, Number(incoming.pollIntervalMins) || 1)
          : current.pollIntervalMins ?? 1,
      updatedAt: new Date(),
    };
    if (
      typeof incoming.amazonPassword === "string" &&
      incoming.amazonPassword.trim()
    ) {
      updateData.amazonPassword = incoming.amazonPassword.trim();
    }

    const db = await getDb();
    if (db) {
      const existing = await db.collection("UserPreferences").findOne({});
      if (existing) {
        await db
          .collection("UserPreferences")
          .updateOne({ _id: existing._id }, { $set: updateData });
      } else {
        await db.collection("UserPreferences").insertOne({
          ...updateData,
          createdAt: new Date(),
        });
      }
    }
    const { amazonPassword, ...safeUpdate } = updateData;
    memoryPrefs = {
      ...current,
      ...(safeUpdate as Prefs),
      hasAmazonPassword: Boolean(amazonPassword || current.hasAmazonPassword),
    };
    return Response.json(memoryPrefs, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { error: "Invalid preferences payload" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
}

async function loadActivePreferences(req: NextRequest): Promise<Prefs> {
  const sp = req.nextUrl.searchParams;
  if (sp.get("filterOverride") === "1") {
    const parseArr = (key: string) => {
      try {
        const val = JSON.parse(sp.get(key) || "[]");
        return Array.isArray(val) ? val : [];
      } catch {
        return [];
      }
    };
    return {
      locations: parseArr("locations"),
      radius: Number(sp.get("radius")) || 30,
      keywords: parseArr("keywords"),
      categories: parseArr("categories"),
      jobTypes: parseArr("jobTypes"),
    };
  }
  return getStoredPreferences();
}

async function getStoredAppliedJobs(): Promise<HourlyJob[]> {
  const db = await getDb();
  if (db) {
    const rows = await db
      .collection("AppliedJob")
      .find({ jobId: { $ne: PROFILE_MARKER_ID } })
      .sort({ appliedAt: -1 })
      .limit(100)
      .toArray();
    if (rows.length > 0) {
      return rows.map((r) => ({
        id: String(r.jobId),
        jobId: String(r.jobId),
        scheduleId: String(r.scheduleId || ""),
        title: String(r.title || "Amazon Warehouse Associate"),
        location: String(r.location || "United Kingdom"),
        city: "",
        country: "GB",
        jobType: String(r.jobType || "Full Time"),
        category: String(r.category || "Fixed-term"),
        description: "",
        applyUrl: String(
          r.applyUrl || buildJobsAtAmazonUrl(String(r.jobId))
        ),
        postedAt: r.appliedAt
          ? new Date(r.appliedAt as string | Date).toISOString()
          : new Date().toISOString(),
        isNew: false,
        matchScore: Number(r.matchScore) || 100,
        autoApplied: r.status === "applied",
        appliedAt: r.appliedAt
          ? new Date(r.appliedAt as string | Date).toISOString()
          : new Date().toISOString(),
        applicationStatus: String(r.status || "opened"),
      }));
    }
  }
  return memoryAppliedJobs;
}

export async function removeUnavailableStoredJobs(): Promise<{ removed: number; kept: number; unverified: number; removedLegacyJobs: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable. No saved jobs were removed.");
  const rows = await db.collection("AppliedJob").find({ jobId: { $ne: PROFILE_MARKER_ID } }).toArray();
  let removed = 0, kept = 0, unverified = 0;
  for (const row of rows) {
    const jobId = String(row.jobId || "");
    let unavailable = !/^(JOB-UK-[A-Za-z0-9_-]+|a0R[A-Za-z0-9]+)$/.test(jobId);
    if (!unavailable) {
      try {
        const schedules = await fetchSchedulesForJob(jobId, true);
        unavailable = row.scheduleId ? !schedules.some(schedule => schedule.scheduleId === row.scheduleId) : schedules.length === 0;
      } catch { unverified++; continue; }
    }
    // Browser-confirmed applications remain in history; unavailable legacy rows are recoverably archived.
    if (!unavailable || row.applicationId || row.shiftReserved === true) { kept++; continue; }
    await db.collection("ArchivedJob").replaceOne({ _id: row._id }, { ...row, archivedAt: new Date(), archiveReason: "unavailable_or_non_hourly_job" }, { upsert: true });
    const result = await db.collection("AppliedJob").deleteOne({ _id: row._id, appliedAt: row.appliedAt ?? { $exists: false } });
    removed += result.deletedCount;
    if (result.deletedCount) memoryAppliedJobs = memoryAppliedJobs.filter(job => job.id !== jobId);
  }
  cachedJobsExpiresAt = 0;
  const legacyJobs = await db.collection("Job").find({ jobId: { $not: /^(JOB-UK-[A-Za-z0-9_-]+|a0R[A-Za-z0-9]+)$/ } }).toArray();
  let removedLegacyJobs = 0;
  if (legacyJobs.length) {
    await db.collection("ArchivedLegacyJob").bulkWrite(legacyJobs.map(row => ({ replaceOne: { filter: { _id: row._id }, replacement: { ...row, archivedAt: new Date(), archiveReason: "legacy_non_hourly_job" }, upsert: true } })));
    removedLegacyJobs = (await db.collection("Job").deleteMany({ _id: { $in: legacyJobs.map(row => row._id) } })).deletedCount;
  }
  return { removed, kept, unverified, removedLegacyJobs };
}

export async function handleJobsFallback(req: NextRequest): Promise<Response> {
  try {
    const [{ jobs: rawJobs, fetchedAt, unverifiedJobs }, prefs, storedApplied] =
      await Promise.all([
        fetchAllUKHourlyJobs(),
        loadActivePreferences(req),
        getStoredAppliedJobs(),
      ]);

    const appliedById = new Map(storedApplied.map((j) => [j.id, j]));
    const sp = req.nextUrl.searchParams;
    const tab = sp.get("tab") || "all";
    const search = (sp.get("search") || "").trim().toLowerCase();
    const minScore = Number(sp.get("minScore")) || 0;
    const page = Math.max(1, Number(sp.get("page")) || 1);
    const limit = Math.max(1, Math.min(100, Number(sp.get("limit")) || 100));

    const filtersOn = hasActiveFilters(prefs);
    const scored = rawJobs
      .map((j) => {
        const passes = passesHardFilters(j, prefs);
        const matchScore = scoreJob(j, prefs);
        const appRec = appliedById.get(j.id);
        return {
          ...j,
          isNew: !memorySeenIds.has(j.id),
          passes,
          matchScore,
          autoApplied: appRec?.applicationStatus === "applied",
          appliedAt: appRec?.appliedAt || null,
          applicationStatus: appRec?.applicationStatus || null,
        };
      })
      .filter((j) => (!filtersOn || j.passes) && j.matchScore >= minScore)
      .filter((j) => {
        if (tab === "new") return j.isNew;
        return true;
      })
      .filter((j) => {
        if (!search) return true;
        const hay = `${j.title} ${j.location} ${j.city} ${j.category} ${j.description}`.toLowerCase();
        return hay.includes(search);
      });

    const list = tab === "applied" ? storedApplied : scored;
    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const paged = list.slice((page - 1) * limit, page * limit);
    const avgMatchScore =
      scored.length > 0
        ? Math.round(
            scored.reduce((sum, j) => sum + (j.matchScore || 0), 0) /
              scored.length
          )
        : 0;

    return Response.json(
      {
        jobs: paged,
        storedAppliedJobs: storedApplied,
        bestMatchJob: scored[0] || null,
        filtersActive: filtersOn,
        activePreferences: prefs,
        total,
        totalLiveJobs: rawJobs.length,
        avgMatchScore,
        page,
        totalPages,
        source: "live",
        jobFeed: {
          provider: "jobsatamazon.co.uk",
          stale: false,
          fetchedAt,
          complete: unverifiedJobs === 0,
          unverifiedJobs,
        },
        availabilityWarning: unverifiedJobs > 0 ? "Some Amazon shifts could not be checked. Showing verified active jobs only." : null,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return Response.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Official UK hourly jobs are temporarily unavailable",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function handleStatsFallback(req: NextRequest): Promise<Response> {
  if (req.method === "POST") {
    memoryAppliedJobs = [];
    memorySeenIds.clear();
    const db = await getDb();
    if (db) {
      await Promise.all([
        db
          .collection("AppliedJob")
          .deleteMany({ jobId: { $ne: PROFILE_MARKER_ID } }),
        db.collection("SeenJob").deleteMany({}),
      ]);
    }
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
  try {
    const [{ jobs: rawJobs, fetchedAt }, prefs, storedApplied] =
      await Promise.all([
        fetchAllUKHourlyJobs(),
        loadActivePreferences(req),
        getStoredAppliedJobs(),
      ]);
    const filtersOn = hasActiveFilters(prefs);
    const matching = rawJobs
      .map((j) => ({
        ...j,
        passes: passesHardFilters(j, prefs),
        matchScore: scoreJob(j, prefs),
      }))
      .filter((j) => !filtersOn || j.passes);

    const avgMatchScore =
      matching.length > 0
        ? Math.round(
            matching.reduce((sum, j) => sum + (j.matchScore || 0), 0) /
              matching.length
          )
        : 0;

    return Response.json(
      {
        totalJobs: rawJobs.length,
        matchingJobs: matching.length,
        newToday: matching.filter((j) => !memorySeenIds.has(j.id)).length,
        avgMatchScore,
        lastChecked: fetchedAt,
        isMonitoring: true,
        autoAppliedTotal: storedApplied.filter(job => job.applicationStatus === "applied").length,
        jobFeed: {
          provider: "jobsatamazon.co.uk",
          stale: false,
          fetchedAt,
          complete: true,
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return Response.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Official UK job counts are unavailable",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function handleAgentFallback(
  req: NextRequest,
  rawBody?: string
): Promise<Response> {
  const db = await getDb();

  if (req.method === "PUT" || req.method === "POST" || req.method === "PATCH") {
    try {
      const body = JSON.parse(rawBody || "{}") as Record<string, unknown>;
      const { cvBase64, ...rest } = body;
      if (cvBase64 && (typeof cvBase64 !== "string" || cvBase64.length > 4_200_000 || !/^data:(application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document);base64,[A-Za-z0-9+/=\r\n]+$/.test(cvBase64))) {
        return Response.json({ error: "Upload a valid PDF or Word CV, no larger than 3 MB." }, { status: 400 });
      }
      // Load the existing profile before merging, including the saved CV on cold starts.
      const existing = db ? await db.collection("AppliedJob").findOne({ jobId: PROFILE_MARKER_ID }) : null;
      if (existing?.profileData) memoryProfile = { ...memoryProfile, ...existing.profileData };
      memoryProfile = {
        ...memoryProfile,
        ...rest,
        ...(cvBase64 ? { cvBase64 } : {}),
        hasCv: Boolean(
          cvBase64 || memoryProfile.cvBase64
        ),
      };
      if (db) {
        await db.collection("AppliedJob").updateOne(
          { jobId: PROFILE_MARKER_ID },
          {
            $set: {
              jobId: PROFILE_MARKER_ID,
              title: "Candidate Profile",
              location: String(memoryProfile.postcode || "UK"),
              status: "profile",
              profileData: memoryProfile,
              appliedAt: new Date(),
            },
          },
          { upsert: true }
        );
      }
      return Response.json(
        { ok: true, profile: memoryProfile },
        { headers: { "Cache-Control": "no-store" } }
      );
    } catch {
      return Response.json(
        { error: "Invalid profile payload" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }
  }

  if (db) {
    const rec = await db
      .collection("AppliedJob")
      .findOne({ jobId: PROFILE_MARKER_ID });
    if (rec?.profileData && typeof rec.profileData === "object") {
      memoryProfile = { ...memoryProfile, ...(rec.profileData as object) };
    }
  }

  const storedApplied = await getStoredAppliedJobs();
  return Response.json(
    {
      profile: memoryProfile,
      logs: storedApplied.map((j) => ({
        jobId: j.id,
        title: j.title,
        status: j.applicationStatus === "applied" ? "applied" : "application_prepared",
        applyUrl: j.applyUrl,
        shiftReserved: false,
        steps: [
          `Application link prepared (${j.scheduleId || "No selected shift"})`,
          "View actual form and assessment progress in the Amazon tab.",
        ],
      })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function handleAutoApplyFallback(
  req: NextRequest,
  rawBody?: string
): Promise<Response> {
  const prefs = await getStoredPreferences();
  if (req.method === "POST") {
    try {
      const body = JSON.parse(rawBody || "{}") as {
        action?: string;
        email?: string;
        password?: string;
      };
      if (body.action === "connect_session") {
        if (body.email) {
          await handlePreferencesRequest(
            new NextRequest(req.url, { method: "PATCH" }),
            JSON.stringify({
              amazonEmail: body.email,
              ...(body.password ? { amazonPassword: body.password } : {}),
            })
          );
        }
        return Response.json(
          {
            connected: false,
            status: "sign_in_on_amazon",
            email: body.email || prefs.amazonEmail || null,
            message:
              "Sign in directly on Amazon in the browser used for applications. Saving an email does not verify an Amazon session.",
          },
          { headers: { "Cache-Control": "no-store" } }
        );
      }
    } catch {
      // ignore
    }
  }
  return Response.json(
    {
      connected: false,
      status: "sign_in_on_amazon",
      email: prefs.amazonEmail || null,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function handleMonitorFallback(req: NextRequest): Promise<Response> {
  try {
    const [{ jobs: rawJobs, fetchedAt }, prefs, storedApplied] =
      await Promise.all([
        fetchAllUKHourlyJobs(),
        loadActivePreferences(req),
        getStoredAppliedJobs(),
      ]);
    const filtersOn = hasActiveFilters(prefs);
    const matching = rawJobs
      .map((j) => ({
        ...j,
        isNew: !memorySeenIds.has(j.id),
        passes: passesHardFilters(j, prefs),
        matchScore: scoreJob(j, prefs),
      }))
      .filter((j) => !filtersOn || j.passes);

    matching.sort((a, b) => b.matchScore - a.matchScore);
    const bestMatchJob = matching[0] || null;

    return Response.json(
      {
        isRunning: true,
        lastChecked: fetchedAt,
        lastNewCount: matching.length,
        newJobsCount: matching.length,
        totalJobs: rawJobs.length,
        newJobs: matching.length,
        autoApplied: storedApplied.filter(job => job.applicationStatus === "applied").length,
        jobs: matching.slice(0, 20),
        bestMatchJob,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return Response.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to check official UK jobs",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function handleJobApplyFallback(
  req: NextRequest,
  rawBody?: string
): Promise<Response> {
  const sp = req.nextUrl.searchParams;
  let jobId = sp.get("jobId") || "";
  let scheduleId = sp.get("scheduleId") || "";
  let title = "Amazon UK Associate";
  let location = "United Kingdom";
  let category = "Fixed-term";
  let jobType = "Full Time";
  let matchScore = 100;

  if (rawBody) {
    try {
      const parsed = JSON.parse(rawBody) as Record<string, unknown>;
      jobId = String(parsed.jobId || parsed.id || jobId);
      scheduleId = String(parsed.scheduleId || scheduleId);
      if (parsed.title) title = String(parsed.title);
      if (parsed.location) location = String(parsed.location);
      if (parsed.category) category = String(parsed.category);
      if (parsed.jobType) jobType = String(parsed.jobType);
      if (parsed.matchScore !== undefined)
        matchScore = Number(parsed.matchScore) || 100;
    } catch {
      // ignore
    }
  }
  if (!/^(JOB-UK-[A-Za-z0-9_-]+|a0R[A-Za-z0-9]+)$/.test(jobId)) {
    return Response.json({ error: "A valid Amazon UK job ID is required." }, { status: 400 });
  }
  try {
    const schedules = await fetchSchedulesForJob(jobId, true);
    const selected = scheduleId
      ? schedules.find((schedule) => schedule.scheduleId === scheduleId)
      : schedules[0];
    if (!selected) {
      cachedJobsExpiresAt = 0;
      return Response.json(
        { error: "This shift has expired or is no longer available. Refresh jobs to choose a live shift." },
        { status: 409, headers: { "Cache-Control": "no-store" } }
      );
    }
    scheduleId = selected.scheduleId!;
  } catch {
    return Response.json(
      { error: "Live shift availability could not be verified. Please retry." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
  const applyUrl = buildJobsAtAmazonUrl(jobId, scheduleId);
  const jobRecord: HourlyJob = {
    id: jobId,
    jobId,
    scheduleId,
    title,
    location,
    city: "",
    country: "GB",
    jobType,
    category,
    description: "",
    applyUrl,
    postedAt: new Date().toISOString(),
    isNew: false,
    matchScore,
    autoApplied: false,
    appliedAt: new Date().toISOString(),
    applicationStatus: "application_prepared",
  };

  memoryAppliedJobs = [
    jobRecord,
    ...memoryAppliedJobs.filter((j) => j.id !== jobId),
  ];

  const db = await getDb();
  if (db && jobId) {
    await db.collection("AppliedJob").updateOne(
      { jobId },
      {
        $set: {
          jobId,
          scheduleId,
          title,
          location,
          category,
          jobType,
          applyUrl,
          matchScore,
          status: "application_prepared",
          appliedAt: new Date(),
        },
      },
      { upsert: true }
    );
  }

  return Response.json(
    { ok: true, jobId, scheduleId, applyUrl, job: jobRecord },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function handleMarkSeenRequest(rawBody?: string): Promise<Response> {
  try {
    const parsed = JSON.parse(rawBody || "{}") as { jobIds?: string[] };
    const ids = Array.isArray(parsed.jobIds) ? parsed.jobIds : [];
    for (const id of ids) memorySeenIds.add(String(id));
    const db = await getDb();
    if (db && ids.length > 0) {
      await Promise.all(
        ids.map((jobId) =>
          db
            .collection("SeenJob")
            .updateOne(
              { jobId: String(jobId) },
              { $set: { jobId: String(jobId), seenAt: new Date() } },
              { upsert: true }
            )
        )
      );
    }
    return Response.json(
      { ok: true, marked: ids.length },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return Response.json(
      { ok: true, marked: 0 },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
