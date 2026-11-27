/**
 * OpenAPI 3.1 description of /api/v1 (served at /api/v1/openapi.json).
 * Request bodies are documented from the same Zod schemas the handlers validate with.
 */
import { z } from 'zod';
import {
  attemptGrantBodySchema,
  claimBodySchema,
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
const player = [{ memberSession: [] }, { bearer: [] }, { guestSession: [] }];
const client = [{ apiKey: [] }];

export function openApiDocument(serverUrl: string) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Suntec+ Play & Win API',
      version: '1.0.0',
      description:
        'Gamification & engagement API for the Suntec+ app. Outcomes and rewards are decided server-side. ' +
        'Members win Suntec+ Points (credited in Capillary). Guests on the public link can play too: their winnings are held for 30 days under a claim code until they sign in / sign up as a Suntec+ member. ' +
        'Errors: `{ "error": { "code", "message", "details", "request_id" } }`. ' +
        'Codes: INVALID, VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_ELIGIBLE, MEMBER_BLOCKED, MEMBER_NOT_LINKED, NOT_FOUND, ' +
        'NOT_ACTIVE, NO_ATTEMPTS, OUT_OF_STOCK, INVALID_CLAIM, CLAIM_USED, CLAIM_EXPIRED, CAP_REACHED, ALREADY_SCANNED, IDEMPOTENCY_MISMATCH, SESSION_EXPIRED, ' +
        'LIMIT_REACHED, COOLDOWN, VELOCITY, RATE_LIMITED, INVALID_API_KEY, INSUFFICIENT_SCOPE.',
    },
    servers: [{ url: `${serverUrl}/api/v1` }],
    tags: [
      { name: 'Member', description: 'Customer-facing: Suntec+ member (session cookie or Bearer token) or guest (guest cookie, where noted)' },
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
        guestSession: { type: 'apiKey', in: 'cookie', name: 'sp_guest', description: 'Guest player on the public link (POST /guest)' },
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
      '/guest': { post: { tags: ['Member'], summary: 'Start or resume guest play (sets the guest cookie; returns the claim code)', responses: { ...okJson('Guest', '201'), ...errors(429) } } },
      '/claims': {
        post: { tags: ['Member'], security: member, summary: 'Collect winnings from guest play with the claim code (members only)', requestBody: body(claimBodySchema), responses: { ...okJson('{ claimed, already, rewards, points }'), ...errors(400, 401, 404, 409, 410) } },
      },
      '/me': { get: { tags: ['Member'], security: player, summary: 'My profile summary', responses: { ...okJson('Summary'), ...errors(401, 403) } } },
      '/me/preferences': {
        patch: { tags: ['Member'], security: member, summary: 'Leaderboard privacy & notification preferences', requestBody: body(preferencesBodySchema), responses: { ...okJson('Updated summary'), ...errors(400, 401) } },
      },
      '/me/rewards': { get: { tags: ['Rewards'], security: player, summary: 'My rewards (Suntec+ Points, vouchers, gifts; held items for guests)', responses: okJson('Rewards') } },
      '/me/history': { get: { tags: ['Member'], security: member, summary: 'Play history', responses: okJson('History') } },
      '/home': { get: { tags: ['Member'], security: player, summary: 'Home screen: summary, check-in, campaigns, games, missions', responses: okJson('Home') } },
      '/games/{id}': {
        get: { tags: ['Games'], security: player, summary: 'Game display config + my availability (no weights/answers)', parameters: [idParam()], responses: { ...okJson('Game'), ...errors(404) } },
      },
      '/games/{id}/play': {
        post: {
          tags: ['Games'],
          security: player,
          summary: 'Start a play (spin/scratch decided immediately; quiz returns questions)',
          parameters: [idParam(), idemHeader],
          requestBody: body(playBodySchema),
          responses: { ...okJson('Game session', '201'), ...errors(400, 401, 403, 404, 409, 429) },
        },
      },
      '/sessions/{id}': { get: { tags: ['Games'], security: player, summary: 'One of my sessions', parameters: [idParam()], responses: okJson('Session') } },
      '/sessions/{id}/answers': {
        post: { tags: ['Games'], security: player, summary: 'Submit quiz answers (scored server-side)', parameters: [idParam()], requestBody: body(quizSubmitBodySchema), responses: { ...okJson('Scored session'), ...errors(404, 410) } },
      },
      '/checkin': {
        get: { tags: ['Engagement'], security: player, summary: 'Check-in status, streak and ladder', responses: okJson('Status') },
        post: { tags: ['Engagement'], security: player, summary: 'Daily check-in (idempotent per day)', requestBody: body(checkinBodySchema), responses: { ...okJson('Result'), ...errors(403, 409) } },
      },
      '/qr/scan': { post: { tags: ['Engagement'], security: player, summary: 'Scan a Play & Win QR code', requestBody: body(qrScanBodySchema), responses: { ...okJson('Result'), ...errors(404, 409) } } },
      '/missions': { get: { tags: ['Engagement'], security: player, summary: 'Missions with my progress', responses: okJson('Missions') } },
      '/missions/{id}/enrol': { post: { tags: ['Engagement'], security: player, summary: 'Join an opt-in mission', parameters: [idParam()], responses: okJson('Enrolled') } },
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
      '/integrations/members/{memberId}/claims': {
        post: { tags: ['Integration'], security: client, summary: 'After a new member signs up with a Play & Win claim code: move the guest winnings to them. Scope claims:write', parameters: [idParam('memberId')], requestBody: body(claimBodySchema), responses: { ...okJson('{ claimed, rewards, points }'), ...errors(400, 401, 403, 404, 409, 410) } },
      },
      '/integrations/members/{memberId}/summary': {
        get: { tags: ['Integration'], security: client, summary: 'Play & Win summary for a member. Scope members:read', parameters: [idParam('memberId')], responses: okJson('Summary') },
      },
      '/auth/exchange': {
        get: { tags: ['System'], summary: 'WebView handoff: consume code, set session cookie, redirect to /play (app mode)', parameters: [{ name: 'code', in: 'query', required: true, schema: { type: 'string' } }], responses: { '302': { description: 'Redirect' } } },
      },
      '/jobs/tick': { post: { tags: ['System'], security: [{ cron: [] }], summary: 'Scheduled maintenance + outbox delivery', responses: okJson('Job result') } },
    },
  };
}
