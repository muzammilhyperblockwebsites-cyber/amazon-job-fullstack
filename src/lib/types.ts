export interface AmazonJob {
  id: string;
  scheduleId?: string;
  title: string;
  location: string;
  city?: string;
  country: string;
  jobType?: string;
  category?: string;
  description?: string;
  applyUrl: string;
  postedAt: string;
}

export interface AmazonApiJob {
  id?: string;
  jobId?: string;
  jobUuid?: string;
  scheduleId?: string;
  scheduleText?: string;
  hireStartDate?: string;
  hoursPerWeek?: number;
  jobTitle?: string;
  title?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  locationName?: string;
  geoClusterDescription?: string;
  country_code?: string;
  normalized_location?: string;
  location?: string | {
    city?: string;
    country?: string;
    state?: string;
    postal_code?: string;
  };
  tagLine?: string;
  bannerText?: string;
  description_short?: string;
  description?: string;
  job_category?: string;
  jobType?: string;
  jobTypeL10N?: string;
  employmentType?: string;
  employmentTypeL10N?: string;
  totalPayRateMin?: number;
  totalPayRateMax?: number;
  totalPayRateMinL10N?: string;
  totalPayRateMaxL10N?: string;
  scheduleCount?: number;
  job_type?: string;
  job_schedule_type?: string;
  job_path?: string;
  posted_date?: string;
  updated_time?: string;
  url_next_step?: string;
}

export interface JobWithScore {
  id: string;
  jobId: string;
  title: string;
  location: string;
  city: string;
  country: string;
  jobType: string;
  category: string;
  description: string;
  applyUrl: string;
  postedAt: Date;
  detectedAt: Date;
  isNew: boolean;
  matchScore: number;
  notified: boolean;
  autoApplied: boolean;
  appliedAt: Date | null;
  applicationStatus: string | null;
}

export interface UserPreferences {
  locations: string[];
  radius: number;
  keywords: string[];
  categories: string[];
  jobTypes: string[];
  excludeKeywords: string[];
  minMatchScore: number;
  postedWithinHours: number;
  remoteOnly: boolean;
  autoApplyEnabled: boolean;
  autoApplyMinScore: number;
  emailEnabled: boolean;
  emailAddress: string;
  emailMinScore: number;
  browserNotify: boolean;
  pollIntervalMins: number;
}

export interface StatsData {
  totalJobs: number;
  newToday: number;
  avgMatchScore: number;
  lastChecked: string | null;
  isMonitoring: boolean;
  autoAppliedTotal: number;
}
