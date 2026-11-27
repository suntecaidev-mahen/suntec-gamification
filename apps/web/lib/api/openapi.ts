/**
 * OpenAPI 3.1 description of /api/v1 (served at /api/v1/openapi.json).
 * Request bodies are documented from the same Zod schemas the handlers validate with.
 */
import { z } from 'zod';
import {
  attemptGrantBodySchema,
  checkinBodySchema,
  eventSchema,
  handoffBodySchema,
  notificationsReadBodySchema,
  playBodySchema,
  preferencesBodySchema,
  qrScanBodySchema,
  quizSubmitBodySchema,
} from '@suntec/core';

const schema = (s: z.ZodType) => z.toJSONSchema(s, { io: 'input', unrepresentable: 'any' });

const errorRef = { $ref: '#/components/schemas/Error' };
const errors = (...codes: number[]) =>
  Object.fromEntries(codes.map((c) => [String(c), { description: 'Error', content: { 'application/json': { schema: errorRef } } }]));
const okJson = (description: string, status = '200') => ({
  [status]: { description, content: { 'application/json': { schema: { type: 'object' } } } },
});
const body = (s: z.ZodType) => ({ required: true, content: { 'application/json': { schema: schema(s) } } });
const idParam = (name = 'id') => ({ name, in: 'path', required: true, schema: { type: 'string' } });
const idemHeader = {
  name: 'Idempotency-Key',
  in: 'header',
  required: true,
  description: 'Unique per user action (e.g. a UUID per tap). Retries with the same key return the original result.',
  schema: { type: 'string', minLength: 8, maxLength: 200 },
};
const member = [{ memberSession: [] }, { bearer: [] }];
const client = [{ apiKey: [] }];

export function openApiDocument(serverUrl: string) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Suntec+ Play & Win API',
      version: '1.0.0',
      description:
        'Gamification & engagement API for the Suntec+ app. Outcomes and rewards are decided server-side. ' +
        'Errors: `{ "error": { "code", "message", "details", "request_id" } }`. ' +
        'Codes: INVALID, VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_ELIGIBLE, MEMBER_BLOCKED, MEMBER_NOT_LINKED, NOT_FOUND, ' +
        'NOT_ACTIVE, NO_ATTEMPTS, INSUFFICIENT_PP, OUT_OF_STOCK, CAP_REACHED, ALREADY_SCANNED, IDEMPOTENCY_MISMATCH, SESSION_EXPIRED, ' +
        'LIMIT_REACHED, COOLDOWN, VELOCITY, RATE_LIMITED, INVALID_API_KEY, INSUFFICIENT_SCOPE.',
    },
    servers: [{ url: `${serverUrl}/api/v1` }],
    tags: [
      { name: 'Member', description: 'Customer-facing (Supabase session cookie or Bearer access token)' },
      { name: 'Games' },
      { name: 'Engagement' },
      { name: 'Rewards' },
      { name: 'Integration', description: 'Server-to-server (X-API-Key with scopes)' },
      { name: 'System' },
    ],
    components: {
      securitySchemes: {
        memberSession: { type: 'apiKey', in: 'cookie', name: 'sb-<project>-auth-token' },
        bearer: { type: 'http', scheme: 'bearer', description: 'Supabase access token of the member' },
        apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
        cron: { type: 'http', scheme: 'bearer', description: 'CRON_SECRET' },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: { code: { type: 'string' }, message: { type: 'string' }, details: {}, request_id: { type: 'string' } },
              required: ['code', 'message'],
            },
          },
        },
      },
    },
    paths: {
      '/health': { get: { tags: ['System'], summary: 'Liveness/configuration check', responses: okJson('OK') } },
      '/me': { get: { tags: ['Member'], security: member, summary: 'My profile summary', responses: { ...okJson('Summary'), ...errors(401, 403) } } },
      '/me/preferences': {
        patch: { tags: ['Member'], security: member, summary: 'Leaderboard privacy & notification preferences', requestBody: body(preferencesBodySchema), responses: { ...okJson('Updated summary'), ...errors(400, 401) } },
      },
      '/me/rewards': { get: { tags: ['Rewards'], security: member, summary: 'My rewards wallet', responses: okJson('Rewards') } },
      '/me/history': { get: { tags: ['Member'], security: member, summary: 'Play history and Play Points ledger', responses: okJson('History') } },
      '/home': { get: { tags: ['Member'], security: member, summary: 'Home screen: summary, check-in, campaigns, games, missions', responses: okJson('Home') } },
      '/games/{id}': {
        get: { tags: ['Games'], security: member, summary: 'Game display config + my availability (no weights/answers)', parameters: [idParam()], responses: { ...okJson('Game'), ...errors(404) } },
      },
      '/games/{id}/play': {
        post: {
          tags: ['Games'],
          security: member,
          summary: 'Start a play (spin/scratch decided immediately; quiz returns questions)',
          parameters: [idParam(), idemHeader],
          requestBody: body(playBodySchema),
          responses: { ...okJson('Game session', '201'), ...errors(400, 401, 403, 404, 409, 429) },
        },
      },
      '/sessions/{id}': { get: { tags: ['Games'], security: member, summary: 'One of my sessions', parameters: [idParam()], responses: okJson('Session') } },
      '/sessions/{id}/answers': {
        post: { tags: ['Games'], security: member, summary: 'Submit quiz answers (scored server-side)', parameters: [idParam()], requestBody: body(quizSubmitBodySchema), responses: { ...okJson('Scored session'), ...errors(404, 410) } },
      },
      '/checkin': {
        get: { tags: ['Engagement'], security: member, summary: 'Check-in status, streak and ladder', responses: okJson('Status') },
        post: { tags: ['Engagement'], security: member, summary: 'Daily check-in (idempotent per day)', requestBody: body(checkinBodySchema), responses: { ...okJson('Result'), ...errors(403, 409) } },
      },
      '/qr/scan': { post: { tags: ['Engagement'], security: member, summary: 'Scan a Play & Win QR code', requestBody: body(qrScanBodySchema), responses: { ...okJson('Result'), ...errors(404, 409) } } },
      '/missions': { get: { tags: ['Engagement'], security: member, summary: 'Missions with my progress', responses: okJson('Missions') } },
      '/missions/{id}/enrol': { post: { tags: ['Engagement'], security: member, summary: 'Join an opt-in mission', parameters: [idParam()], responses: okJson('Enrolled') } },
      '/rewards': { get: { tags: ['Rewards'], security: member, summary: 'Rewards catalogue (Play Points)', responses: okJson('Catalogue') } },
      '/rewards/{id}/redeem': {
        post: { tags: ['Rewards'], security: member, summary: 'Redeem with Play Points', parameters: [idParam(), idemHeader], responses: { ...okJson('Reward transaction', '201'), ...errors(404, 409) } },
      },
      '/badges': { get: { tags: ['Engagement'], security: member, summary: 'Badges with progress', responses: okJson('Badges') } },
      '/leaderboards': { get: { tags: ['Engagement'], security: member, summary: 'Active leaderboards', responses: okJson('Leaderboards') } },
      '/leaderboards/{id}': {
        get: {
          tags: ['Engagement'],
          security: member,
          summary: 'Ranking (masked names) and my rank',
          parameters: [idParam(), { name: 'period', in: 'query', schema: { enum: ['daily', 'weekly', 'monthly', 'overall'] } }],
          responses: okJson('Leaderboard'),
        },
      },
      '/notifications': { get: { tags: ['Member'], security: member, summary: 'Inbox', responses: okJson('Notifications') } },
      '/notifications/read': { post: { tags: ['Member'], security: member, summary: 'Mark as read', requestBody: body(notificationsReadBodySchema), responses: okJson('OK') } },
      '/integrations/sessions': {
        post: {
          tags: ['Integration'],
          security: client,
          summary: 'Create a single-use (60 s) WebView sign-in URL for a member. Scope sessions:write',
          requestBody: body(handoffBodySchema),
          responses: { ...okJson('{ url, code, expires_at }', '201'), ...errors(401, 403) },
        },
      },
      '/integrations/events': {
        post: {
          tags: ['Integration'],
          security: client,
          summary: 'Ingest behavioural events (single or {events:[…]}). Idempotent on external_id. Scope events:write',
          requestBody: { required: true, content: { 'application/json': { schema: schema(eventSchema) } } },
          responses: { ...okJson('Per-event results', '202'), ...errors(400, 401, 403) },
        },
      },
      '/integrations/members/{memberId}/attempts': {
        post: { tags: ['Integration'], security: client, summary: 'Grant bonus attempts. Scope attempts:write', parameters: [idParam('memberId')], requestBody: body(attemptGrantBodySchema), responses: okJson('Balance', '201') },
      },
      '/integrations/members/{memberId}/summary': {
        get: { tags: ['Integration'], security: client, summary: 'Play & Win summary for a member. Scope members:read', parameters: [idParam('memberId')], responses: okJson('Summary') },
      },
      '/auth/exchange': {
        get: { tags: ['System'], summary: 'WebView handoff: consume code, set session cookie, redirect to /embed', parameters: [{ name: 'code', in: 'query', required: true, schema: { type: 'string' } }], responses: { '302': { description: 'Redirect' } } },
      },
      '/jobs/tick': { post: { tags: ['System'], security: [{ cron: [] }], summary: 'Scheduled maintenance + outbox delivery', responses: okJson('Job result') } },
    },
  };
}
