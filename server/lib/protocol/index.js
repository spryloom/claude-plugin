/**
 * The wire contract between the CLI, the agent tools, and the control plane.
 *
 * Shared so both sides are built against one definition rather than two
 * descriptions of the same thing that drift apart. Nothing here has behaviour;
 * it is names, shapes and the wording of failures.
 */
export const API_VERSION = 1;
/** Sent on every authenticated request. */
export const AUTH_HEADER = 'authorization';
/**
 * How the platform's own dashboard, published as an app, identifies the person
 * it is acting for (D76).
 *
 * An app is told who its visitor is by the identity token the proxy mints per
 * request. The dashboard app forwards that token to the public API in place
 * of a bearer token, with the method and path of the request it was minted
 * for, so the API can verify the signature. The API accepts it only from the
 * one app it is configured to trust, and only on routes that read.
 */
export const IDENTITY_AUTH_SCHEME = 'Spryloom-Identity';
/** `<METHOD> <path>` of the request the identity token is bound to. */
export const IDENTITY_REQUEST_HEADER = 'identity-request';
/**
 * Which client is calling, as `spry/<version>`.
 *
 * Sent by the CLI and the agent tools on every request, so the control plane
 * can turn away a client too old for the API it serves, with an upgrade
 * command, rather than failing somewhere confusing (D99).
 */
export const CLIENT_HEADER = 'x-spryloom-client';
/** Prefix on every token we issue, so one found in a log is recognisable. */
export const TOKEN_PREFIX = 'spry_';
export const isApiError = (value) => typeof value === 'object' &&
    value !== null &&
    typeof value.error === 'string' &&
    typeof value.message === 'string';
/**
 * How a terminal proves it is the one that asked.
 *
 * The poll token travels as a bearer token on the poll request. Written down
 * because it is otherwise a convention two sides have to remember rather than a
 * contract either can check.
 */
export const POLL_AUTH = 'bearer';
/**
 * A publish.
 *
 * The app's files are sent as a gzipped tar in the request body, and everything
 * else travels in the query string, because the body is already the archive.
 */
/** Content type of a publish body. The archive itself, not a form. */
export const PUBLISH_CONTENT_TYPE = 'application/gzip';
/** The stages each kind goes through, in order. Clients draw these. */
export const OPERATION_STAGES = {
    publish: ['preparing', 'database', 'building', 'starting', 'health', 'jobs', 'switching'],
    delete: ['stopping', 'domains', 'machine', 'database', 'secrets', 'verifying'],
    rollback: ['preparing', 'starting', 'health', 'jobs', 'switching'],
    restore: ['preparing', 'starting', 'health', 'jobs'],
    restart: ['starting', 'health'],
};
/**
 * The stages of a page's operations (D105). A page is files in storage, so
 * there is nothing to build, start or check: it is stored, then switched to.
 */
export const PAGE_OPERATION_STAGES = {
    publish: ['preparing', 'storing', 'switching'],
    rollback: ['preparing', 'switching'],
    restore: ['preparing'],
    delete: ['stopping', 'files', 'domains', 'verifying'],
};
/** A page that is built first (D107): a static app with a build step and no server. */
export const BUILT_PAGE_PUBLISH_STAGES = ['preparing', 'building', 'storing', 'switching'];
/** The stages an operation goes through, for an app, a page, or a page that is built first. */
export const operationStages = (kind, page = false, built = false) => page && built && kind === 'publish'
    ? BUILT_PAGE_PUBLISH_STAGES
    : ((page ? PAGE_OPERATION_STAGES[kind] : undefined) ?? OPERATION_STAGES[kind]);
/** What a stage is called on screen. */
export const STAGE_LABELS = {
    preparing: 'Preparing',
    database: 'Database',
    building: 'Building',
    starting: 'Starting',
    health: 'Health check',
    jobs: 'Jobs',
    switching: 'Switching over',
    stopping: 'Stopping',
    machine: 'Removing the machine',
    secrets: 'Removing secrets',
    domains: 'Removing domains',
    verifying: 'Checking it is all gone',
    storing: 'Storing the files',
    files: 'Removing the files',
    // Where one stage name means something different in a delete.
    'delete:database': 'Deleting the database',
};
/** What a stage is called on screen, for the kind of operation it belongs to. */
export const stageLabel = (kind, stage) => STAGE_LABELS[`${kind}:${stage}`] ?? STAGE_LABELS[stage] ?? stage.charAt(0).toUpperCase() + stage.slice(1);
export * from './notify.js';
// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
/**
 * Every route in one place, so the client cannot drift from the server.
 *
 * Functions rather than strings, because a slug that is not escaped is a way to
 * reach a path nobody meant to expose.
 */
export const routes = {
    loginStart: () => '/api/v1/login',
    loginPoll: (requestId) => `/api/v1/login/${encodeURIComponent(requestId)}`,
    loginApprove: (requestId) => `/api/v1/login/${encodeURIComponent(requestId)}/approve`,
    whoAmI: () => '/api/v1/me',
    secrets: (slug) => `/api/v1/apps/${encodeURIComponent(slug)}/secrets`,
    secret: (slug, name) => `/api/v1/apps/${encodeURIComponent(slug)}/secrets/${encodeURIComponent(name)}`,
    /** Revoke every token this person holds, on every machine. */
    signOutEverywhere: () => '/api/v1/me/tokens',
    /** Revoke the token this request carries, and no other. */
    signOut: () => '/api/v1/me/token',
    apps: () => '/api/v1/apps',
    app: (slug) => `/api/v1/apps/${encodeURIComponent(slug)}`,
    exportApp: (slug) => `/api/v1/apps/${encodeURIComponent(slug)}/export`,
    /** A page's saved data (D113), as the signed-in person. By workspace, so a page someone was invited to elsewhere works too. */
    pageData: (workspace, slug) => `/api/v1/pages/${encodeURIComponent(workspace)}/${encodeURIComponent(slug)}/data`,
    /** Every record of a page, for its owner and admins (D113). */
    pageDataExport: (workspace, slug) => `/api/v1/pages/${encodeURIComponent(workspace)}/${encodeURIComponent(slug)}/data/export`,
    publish: (slug) => `/api/v1/apps/${encodeURIComponent(slug)}/publish`,
    operation: (id) => `/api/v1/operations/${encodeURIComponent(id)}`,
    activeOperation: (slug) => `/api/v1/apps/${encodeURIComponent(slug)}/operation`,
    logs: (slug) => `/api/v1/apps/${encodeURIComponent(slug)}/logs`,
    rollback: (slug) => `/api/v1/apps/${encodeURIComponent(slug)}/rollback`,
    invite: (slug) => `/api/v1/apps/${encodeURIComponent(slug)}/invite`,
    revokeInvite: (slug, email) => `/api/v1/apps/${encodeURIComponent(slug)}/invite?email=${encodeURIComponent(email)}`,
    archive: (slug) => `/api/v1/apps/${encodeURIComponent(slug)}/archive`,
    /**
     * Deleting takes the name again, in the query string.
     *
     * Not politeness: it is the difference between a delete somebody meant and a
     * delete that was one argument away from a different app.
     */
    deleteApp: (slug, confirm) => `/api/v1/apps/${encodeURIComponent(slug)}?confirm=${encodeURIComponent(confirm)}`,
    restore: (slug) => `/api/v1/apps/${encodeURIComponent(slug)}/restore`,
    restart: (slug) => `/api/v1/apps/${encodeURIComponent(slug)}/restart`,
    /** The dashboard's two reads (D76): a workspace at a glance, and one app in full. */
    workspaceOverview: () => '/api/v1/workspace/overview',
    appOverview: (slug) => `/api/v1/apps/${encodeURIComponent(slug)}/overview`,
    jobs: (slug) => `/api/v1/apps/${encodeURIComponent(slug)}/jobs`,
    jobRun: (slug, job) => `/api/v1/apps/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(job)}/run`,
    jobResume: (slug, job) => `/api/v1/apps/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(job)}/resume`,
    jobRuns: (slug, job) => `/api/v1/apps/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(job)}/runs`,
    domains: (slug) => `/api/v1/apps/${encodeURIComponent(slug)}/domains`,
    domainVerify: (slug, hostname) => `/api/v1/apps/${encodeURIComponent(slug)}/domains/${encodeURIComponent(hostname)}/verify`,
    domain: (slug, hostname) => `/api/v1/apps/${encodeURIComponent(slug)}/domains/${encodeURIComponent(hostname)}`,
};
/**
 * The same routes as patterns, for a server to register.
 *
 * Separate from `routes` on purpose. Those escape what they are given, which is
 * right for building a URL and wrong for registering a route: a pattern like
 * `:slug` comes back percent-encoded and then matches nothing.
 */
export const patterns = {
    /**
     * Whether the control plane is working, for something outside it to poll.
     *
     * Outside `/api/v1` and unauthenticated on purpose: a monitor cannot hold a
     * credential that survives the platform being down, and a check that needs
     * one goes silent at exactly the moment it is wanted.
     */
    health: '/health',
    loginStart: '/api/v1/login',
    loginPoll: '/api/v1/login/:requestId',
    loginApprove: '/api/v1/login/:requestId/approve',
    whoAmI: '/api/v1/me',
    secrets: '/api/v1/apps/:slug/secrets',
    secret: '/api/v1/apps/:slug/secrets/:name',
    signOutEverywhere: '/api/v1/me/tokens',
    signOut: '/api/v1/me/token',
    apps: '/api/v1/apps',
    app: '/api/v1/apps/:slug',
    exportApp: '/api/v1/apps/:slug/export',
    pageData: '/api/v1/pages/:workspace/:slug/data',
    pageDataExport: '/api/v1/pages/:workspace/:slug/data/export',
    publish: '/api/v1/apps/:slug/publish',
    operation: '/api/v1/operations/:id',
    activeOperation: '/api/v1/apps/:slug/operation',
    logs: '/api/v1/apps/:slug/logs',
    rollback: '/api/v1/apps/:slug/rollback',
    invite: '/api/v1/apps/:slug/invite',
    archive: '/api/v1/apps/:slug/archive',
    restore: '/api/v1/apps/:slug/restore',
    restart: '/api/v1/apps/:slug/restart',
    workspaceOverview: '/api/v1/workspace/overview',
    appOverview: '/api/v1/apps/:slug/overview',
    jobs: '/api/v1/apps/:slug/jobs',
    jobRun: '/api/v1/apps/:slug/jobs/:job/run',
    jobResume: '/api/v1/apps/:slug/jobs/:job/resume',
    jobRuns: '/api/v1/apps/:slug/jobs/:job/runs',
    /** The page an app-mail footer links to, and the one-click unsubscribe target. */
    mute: '/mute',
    /** Postmark's bounce and complaint webhook. Mounted only when a token is configured. */
    postmarkHook: '/hooks/postmark',
};
/** Names for the failures a caller is expected to handle. */
export const errorCodes = {
    notSignedIn: 'not_signed_in',
    notFound: 'not_found',
    notAllowed: 'not_allowed',
    invalid: 'invalid',
    publishFailed: 'publish_failed',
    rollbackFailed: 'rollback_failed',
    tooLarge: 'too_large',
    rateLimited: 'rate_limited',
    /** Another publish or delete of this app is already running (D99). */
    busy: 'busy',
    /** This spry is older than the API it is talking to. */
    clientTooOld: 'client_too_old',
    deleteFailed: 'delete_failed',
};
/** The oldest spry the API accepts publishes and deletes from (D99). */
export const MIN_CLIENT_VERSION = '0.1.4';
//# sourceMappingURL=index.js.map