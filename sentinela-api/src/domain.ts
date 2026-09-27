import { createHash } from 'node:crypto';
import { EventDto, FilterDto } from './contracts';
export function hashKey(key: string): string { return createHash('sha256').update(key).digest('hex'); }
export function sanitizeText(text: string): string {
  return text
    .replace(/\bBearer\s+[^\s,;"']+/gi, 'Bearer [REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .replace(/(["']?(?:password|passwd|pwd|senha|token|access_token|refresh_token|authorization|api[_-]?key|secret|cookie|x-application-key)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&}]+)/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/(https?:\/\/[^\s?#]+)\?[^\s#]*/gi, '$1');
}
export function cleanEvent(event: EventDto, secrets: string[] = []): EventDto {
  const clean = (value: string) => sanitizeText(secrets.filter(Boolean).reduce((text,secret)=>text.split(secret).join('[REDACTED]'),value));
  const metadata: Record<string, unknown> = {};
  for (const key of ['scenario','service','operation','code','durationMs','retryCount','version']) {
    const value = event.metadata?.[key];
    if (typeof value === 'string') metadata[key] = clean(value).slice(0,500);
    else if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) metadata[key] = value;
  }
  return { ...event, environment: clean(event.environment), correlationId: event.correlationId ? clean(event.correlationId) : undefined,
    type: clean(event.type).slice(0,120), message: clean(event.message).slice(0,8000),
    stackTrace: event.stackTrace ? clean(event.stackTrace).slice(0,32000) : undefined,
    origin: event.origin ? clean(event.origin).slice(0,500) : undefined,
    endpoint: event.endpoint ? clean(event.endpoint.split(/[?#]/)[0]).slice(0,1000) : undefined,
    metadata: Object.keys(metadata).length ? metadata : undefined };
}
export function normalizeMessage(message: string): string {
  return message.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/\b\d{4}-\d\d-\d\dT[\d:.]+(?:Z|[+-]\d\d:\d\d)/g, '<date>')
    .replace(/\b0x[0-9a-f]+\b/gi, '<hex>').replace(/\b\d+(?:\.\d+)?\b/g, '<n>').replace(/\s+/g,' ').trim();
}
function normalizeOrigin(value: string): string {
  return value.replace(/\\/g,'/').replace(/:\d+(?::\d+)?/g,'').replace(/(?:[A-Za-z]:)?(?:\/[^\s():]+)+\/([^/\s():]+)/g,'$1').replace(/\s+/g,' ').trim().slice(0,500);
}
export function fingerprint(applicationId: string, event: EventDto) {
  const frame = event.stackTrace?.split('\n').find(line => /^\s*at\s/.test(line) && !/node:|node_modules/.test(line));
  const origin = event.origin ? normalizeOrigin(event.origin) : frame ? normalizeOrigin(frame.trim()) : normalizeMessage(event.message).slice(0,500);
  return { origin, signature: hashKey(JSON.stringify([1,applicationId.toLowerCase(),event.environment,event.type,origin])) };
}
export function windowFor(filter: FilterDto, now = new Date()) {
  const duration = { '24h': 24, '7d': 168, '30d': 720 }[filter.period] * 3600000;
  const end = filter.asOf ? new Date(filter.asOf) : now;
  return { end, start: new Date(end.getTime()-duration), previous: new Date(end.getTime()-2*duration), duration };
}
export function growth(current: number, previous: number) {
  return { current, previous, percentage: previous ? Math.round((current-previous)/previous*10000)/100 : null,
    increased: current > previous, noPreviousOccurrences: previous === 0 };
}
