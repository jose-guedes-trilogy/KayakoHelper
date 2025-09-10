/**
 * @description A TypeScript library for interacting with the AIHorizons School API.
 * This library is designed to be used in a browser environment, such as a Chrome extension,
 * to assist support agents by providing direct access to student and school data.
 */

// --- Type Definitions for API Responses ---

/**
 * Represents the structure of a paginated API response.
 */
interface PaginatedResponse<T> {
    count: number;
    next: string | null;
    previous: string | null;
    results: T[];
}

/**
 * Represents a user's address.
 */
interface Address {
    address_1: string;
    address_2: string;
    city: string;
    state_province: string;
    zip_code: string;
    country: string;
}

/**
 * Represents a user's demographic information.
 */
interface Demographics {
    birth_date: string;
    sex: string;
    american_indian_or_alaska_native: boolean;
    asian: boolean;
    black_or_african_american: boolean;
    native_hawaiian_or_other_pacific_islander: boolean;
    white: boolean;
    demographic_race_two_or_more_races: boolean;
    hispanic_or_latino_ethnicity: boolean;
    country_of_birth_code: string | null;
    state_of_birth_abbreviation: string | null;
    city_of_birth: string | null;
    public_school_residence_status: string | null;
}

/**
 * Represents an external user identifier (e.g., from HubSpot).
 */
interface UserId {
    type: string;
    identifier: string;
}

/**
 * Represents a file or document associated with a user.
 */
interface File {
    id: string;
    created_at: string;
    modified_at: string;
    file_type: string;
    file_name: string;
    file: string; // URL
    user: string;
}

/**
 * Represents a sub-step in an admission or enrollment process.
 */
interface SubStep {
    id: string;
    sourced_id: string;
    name: string;
    description: string;
    parent_step: string;
    previous_sub_step: string | null;
    transformation_config: {
        confirmed: boolean;
    };
}

/**
 * Represents a user's role within an organization.
 */
interface Role {
    id: string;
    role_type: string;
    role: string;
    org: Organization;
    begin_date: string | null;
    end_date: string | null;
    sub_step: SubStep | null;
}

/**
 * Represents a user object (student, staff, or agent/parent).
 */
interface User {
    sourced_id: string;
    username: string;
    first_name: string;
    middle_name: string | null;
    last_name: string;
    email: string;
    image: string | null;
    user_master_identifier?: string;
    preferred_first_name: string | null;
    preferred_middle_name: string | null;
    preferred_last_name: string | null;
    first_name_phonetic: string | null;
    last_name_phonetic: string | null;
    pronouns: string | null;
    roles: Role[];
    primary_org: Organization;
    sms: string | null;
    phone: string | null;
    confirmed: boolean;
    email_stop: boolean;
    time_zone: string | null;
    description: string | null;
    image_alt: string | null;
    metadata: number | null;
    user_ids: UserId[];
    initiated: boolean;
    level: string | null;
    student_id: string;
    test_account: boolean;
    grades: string | null;
    demographics: Demographics | null;
    student_group: any | null; // Type not fully defined in HAR
    admission_status: string;
}

/**
 * Represents an agent (parent/guardian) associated with a student.
 */
interface Agent extends User {
    emergency_contact: boolean;
    authorized_pickup: boolean;
    primary: boolean;
    relationship: string;
}

/**
 * Represents a notification object.
 */
interface Notification {
    count: number;
    unread_count: number;
    results: any[]; // Replace 'any' with a specific NotificationItem interface if available
}

/**
 * Represents an organization object (school or district).
 */
interface Organization {
    sourced_id: string;
    name: string;
    type: string;
    identifier: string | null;
    image: string | null;
    domain: string | null;
    aliases: string[] | null;
    base_tuition: string;
    start_date: string;
    end_date: string;
    all_year_round: boolean;
}

/**
 * Represents a student's full profile details, extending the base User interface.
 */
interface StudentProfile extends User {
    agents: Agent[];
    files: File[];
    user_files: File[];
    family_members: User[];
    address: Address;
    group: any | null;
    full_student_id: string;
    is_staff: boolean;
    agent_relationship_reverse: any | null;
    hubspot_contact_id: string;
    payment_url: string;
    allergy_plan: string;
    instructions: string;
    t_shirt_size: string;
    physical_exam: string;
    food_allergies: string;
    enrollment_date: string;
    medication_name: string;
    shadow_day_date: string;
    tuition_profile: string;
    academic_session: string;
    base_tuition2526: number;
    consent_to_treat: boolean;
    lunch_amount2526: number | null;
    billing_frequency: string;
    billing_parent_id: string;
    birth_certificate: string;
    lunch_program2526: string;
    medication_dosage: string;
    guardian_last_name: string;
    space_x_family2526: boolean;
    [key: string]: any; // For dynamic fields like 'field_1738...'
}

/**
 * Represents a form configuration object.
 */
interface FormConfig {
    sourced_id: string;
    name: string;
    description: string;
    identifier: string;
    config: any[]; // The structure of config is complex and dynamic
    date_last_modified: string;
    validation_seconds: number;
    is_active: boolean;
    requires_student_signature: boolean;
    tags: string[];
}

/**
 * Represents a signature object from a submitted form.
 */
interface Signature {
    original: string;
    thumbnail: string;
    medium: string;
    large: string;
}

/**
 * Represents a user's submitted form data.
 */
interface UserForm {
    sourced_id: string;
    user: User;
    form: FormConfig;
    data?: any; // Some responses are large; not always included/needed for list views
    submitted: boolean;
    closed: boolean;
    valid_till: string;
    last_submission: string;
    tags: string[];
    pdf_url?: string | null;
    signature?: Signature | null;
    student_signature?: Signature | null;
}

/**
 * Represents a detailed step in the admission process.
 */
interface StepDetail {
    id: string;
    name: string;
    description: string;
    parent_step: ParentStep;
    previous_sub_step: string | null;
}

/**
 * Represents a parent step in the admission process, containing sub-steps.
 */
interface ParentStep {
    id: string;
    name: string;
    description: string | null;
    previous_step: string | null;
    process: string;
    sub_steps: SubStep[];
}

/**
 * Represents a student's full admission process status.
 */
interface AdmissionProcessStep {
    current: StepDetail;
    total: ParentStep[];
}


// --- API Library Class ---

/**
 * A client library for making authenticated requests to the AIHorizons School API.
 */
export class AIHorizonsAPI {
    private readonly baseUrl: string = 'https://api.aihorizons.school/api/v1';
    private customSisRole: string;

    /**
     * Creates an instance of the AIHorizonsAPI client.
     * @param {string} customSisRole - The authorization role ID for the support agent.
     * This is required for all authenticated API calls.
     * @param {object} [opts]
     * @param {typeof fetch} [opts.fetcher] - Optional override to route requests (e.g., via a hidden aihorizons tab).
     * @param {() => string | null} [opts.csrfGetter] - Optional override to read the CSRF token.
     */
    constructor(customSisRole: string, opts?: { fetcher?: typeof fetch; csrfGetter?: () => string | null }) {
        if (!customSisRole) {
            throw new Error('A custom SIS role is required for API authentication.');
        }
        this.customSisRole = customSisRole;
        if (opts?.fetcher) this._fetch = opts.fetcher;
        if (opts?.csrfGetter) this._csrfGetter = opts.csrfGetter;
        // Ensure fetch has correct this-binding in browser contexts to avoid Illegal invocation
        try {
            // @ts-ignore - window may not exist in some contexts but try-catch protects
            const g: any = typeof window !== 'undefined' ? window : globalThis;
            // bind only if native fetch exists and supports bind
            if (g && typeof g.fetch === 'function' && typeof g.fetch.bind === 'function') {
                this._fetch = g.fetch.bind(g);
            }
        } catch {}
    }

    // Internal fetch (can be overridden from constructor)
    private _fetch: typeof fetch = fetch;

    // CSRF token getter (overridable)
    private _csrfGetter: () => string | null = () => {
        // Typical Django/DRF name is "csrftoken"
        const m = document.cookie.match(/(?:^|;\s*)(?:csrftoken|CSRF-TOKEN)=([^;]+)/);
        const token = m && m[1] ? m[1] : null;
        return token ? decodeURIComponent(token) : null;
    };

    /**
     * Creates the common headers required for most API requests.
     * NOTE: We do NOT manually set 'origin', 'referer', or 'user-agent' — the browser controls those.
     */
    private createHeaders(): Headers {
        const headers = new Headers();
        headers.append('accept', 'application/json, text/plain, */*');
        headers.append('custom-sis-role', this.customSisRole);
        return headers;
    }

    /**
     * Low-level request helper that always sends cookies and (optionally) adds X-CSRFToken.
     */
    private async request<T>(path: string, init: RequestInit = {}, opts?: { csrf?: boolean }): Promise<T> {
        const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
        const headers = init.headers instanceof Headers ? init.headers : new Headers(init.headers || {});
        // Merge our required headers
        const base = this.createHeaders();
        base.forEach((v, k) => { if (!headers.has(k)) headers.set(k, v); });

        // Only set content-type for requests with a body
        if (init.body && !headers.has('content-type')) {
            headers.set('content-type', 'application/json');
        }

        // Add CSRF for unsafe methods if requested
        if (opts?.csrf) {
            const token = this._csrfGetter();
            if (!token) {
                // Helpful message if called from Kayako (cross-site) and the cookie is not readable here
                console.warn('[AIHorizonsAPI] Missing CSRF cookie. If calling from a third-party context (e.g., Kayako), route via aihorizons.school or inject a csrfGetter.');
            } else {
                headers.set('X-CSRFToken', token);
            }
        }

        const response = await this._fetch(url, {
            credentials: 'include', // <-- critical: send session cookie
            // 'cors' mode is implicit for cross-origin in browsers
            ...init,
            headers
        });

        return this.handleResponse<T>(response);
    }

    /**
     * Handles the network response, parsing JSON and throwing errors for non-ok statuses.
     * @template T
     * @param {Response} response - The raw response from the fetch call.
     * @returns {Promise<T>} A promise that resolves with the parsed JSON data.
     * @private
     */
    private async handleResponse<T>(response: Response): Promise<T> {
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            // Provide a clearer hint for common auth/cookie issues in a cross-site context
            if (response.status === 401 || response.status === 403) {
                throw new Error(`API auth failed (${response.status}). This usually means the session cookie wasn't sent. If running from Kayako, either (a) allow third-party cookies for aihorizons.school, or (b) route via a hidden aihorizons.school tab / background proxy. Server said: ${text}`);
            }
            throw new Error(`API request failed with status ${response.status}: ${text}`);
        }
        // Handle cases where the response body might be empty (e.g., 204 No Content)
        const text = await response.text();
        return (text ? JSON.parse(text) : null) as T;
    }

    /**
     * NOTE ON PREFLIGHT REQUESTS (OPTIONS):
     * The browser automatically handles CORS preflight (OPTIONS) requests before making the actual
     * cross-origin fetch request (like GET or POST). We do not need to manually implement
     * these OPTIONS calls in our library. Because we include a custom header (custom-sis-role),
     * preflight will occur automatically — as seen in the HAR.
     */

    // --- Public API Methods ---

    /**
     * Fetches notifications for a specific recipient.
     * @param {string} recipientId - The unique identifier of the user.
     * @returns {Promise<Notification>} A promise that resolves with the user's notifications.
     */
    public async getNotifications(recipientId: string): Promise<Notification> {
        return this.request<Notification>(`/notifications?recipient=${encodeURIComponent(recipientId)}`);
    }

    /**
     * Fetches a paginated list of confirmed students.
     * @param {number} [page=1] - The page number to retrieve.
     * @param {number} [pageSize=4] - The number of students per page.
     * @returns {Promise<PaginatedResponse<User>>} A promise that resolves with the list of students.
     */
    public async getStudents(page: number = 1, pageSize: number = 4): Promise<PaginatedResponse<User>> {
        return this.request<PaginatedResponse<User>>(`/users?role=student&confirmed=true&page=${page}&page_size=${pageSize}`);
    }

    /**
     * Fetches a paginated list of staff members.
     * @param {number} [page=1] - The page number to retrieve.
     * @param {number} [pageSize=4] - The number of staff members per page.
     * @returns {Promise<PaginatedResponse<User>>} A promise that resolves with the list of staff.
     */
    public async getStaff(page: number = 1, pageSize: number = 4): Promise<PaginatedResponse<User>> {
        return this.request<PaginatedResponse<User>>(`/users?staff=true&page=${page}&page_size=${pageSize}`);
    }

    /**
     * Fetches a paginated list of organizations.
     * @param {number} [page=1] - The page number to retrieve.
     * @param {number} [pageSize=4] - The number of organizations per page.
     * @returns {Promise<PaginatedResponse<Organization>>} A promise that resolves with the list of organizations.
     */
    public async getOrganizations(page: number = 1, pageSize: number = 4): Promise<PaginatedResponse<Organization>> {
        return this.request<PaginatedResponse<Organization>>(`/orgs?page=${page}&page_size=${pageSize}`);
    }

    /**
     * Searches for users (students or staff) by a search term.
     * @param {string} searchTerm - The term to search for (e.g., the first letter of a name).
     * @param {number} [page=1] - The page number to retrieve.
     * @param {number} [pageSize=5] - The number of results per page.
     * @returns {Promise<PaginatedResponse<User>>} A promise that resolves with the search results.
     */
    public async searchUsers(searchTerm: string, page: number = 1, pageSize: number = 5): Promise<PaginatedResponse<User>> {
        return this.request<PaginatedResponse<User>>(`/users?search=${encodeURIComponent(searchTerm)}&page=${page}&page_size=${pageSize}`);
    }

    /**
     * Fetches the detailed profile for a specific student.
     * @param {string} studentId - The unique identifier of the student.
     * @returns {Promise<StudentProfile>} A promise that resolves with the student's profile data.
     */
    public async getStudentProfile(studentId: string): Promise<StudentProfile> {
        return this.request<StudentProfile>(`/users/${encodeURIComponent(studentId)}?role=student`);
    }

    /**
     * Fetches the configuration for all available forms.
     * @param {number} [page=1] - The page number to retrieve.
     * @param {number} [pageSize=100] - The number of forms per page.
     * @returns {Promise<PaginatedResponse<FormConfig>>} A promise that resolves with form configurations.
     */
    public async getFormConfig(page: number = 1, pageSize: number = 100): Promise<PaginatedResponse<FormConfig>> {
        return this.request<PaginatedResponse<FormConfig>>(`/form-config?page=${page}&page_size=${pageSize}`);
    }

    /**
     * Fetches the *single* submitted form object for a specific user, as seen in the HAR.
     * NOTE: The HAR shows the response is an object with a 'data' key containing one form object.
     * @param {string} userId - The unique identifier of the user.
     * @returns {Promise<UserForm>} A promise that resolves with the user's form.
     */
    public async getUserForm(userId: string): Promise<UserForm> {
        const wrapped = await this.request<{ data: UserForm }>(`/user-form/get-user-form?id=${encodeURIComponent(userId)}`);
        return wrapped.data;
    }

    /**
     * @deprecated The endpoint returns a single form object, not an array. Use getUserForm instead.
     * Kept as a thin wrapper so existing calls won't explode.
     */
    public async getUserForms(userId: string): Promise<any> {
        return this.getUserForm(userId);
    }

    /**
     * Fetches the current admission/enrollment process step for a student.
     * @param {string} userSourcedId - The sourced_id of the student.
     * @returns {Promise<AdmissionProcessStep>} A promise that resolves with the student's process step information.
     */
    public async getAdmissionProcessStep(userSourcedId: string): Promise<AdmissionProcessStep> {
        return this.request<AdmissionProcessStep>(`/user-admissions/get-student-process-step?user_sourced_id=${encodeURIComponent(userSourcedId)}`);
    }

    /**
     * Mirrors the app's POST /users/online call (sends X-CSRFToken).
     * Body in the HAR: {"location_window_url":"https://aihorizons.school/"}
     */
    // removed: markUserOnline (not required)
}