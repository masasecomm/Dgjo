import { canonicalCircularName, circularArchiveAnchor } from "./circulars.js";

const FEED_TYPES = new Set([
  "feed", "rss", "rss2", "atom", "rdf",
  "application/rss+xml", "application/atom+xml", "application/rdf+xml"
]);

export function isFeedRequest(input) {
  const url = input instanceof URL ? input : new URL(String(input), "https://dpsagovernmentjobs.co.za");
  const format = url.searchParams.get("format")?.toLowerCase();
  const type = url.searchParams.get("type")?.toLowerCase();
  if (url.searchParams.has("feed") || FEED_TYPES.has(format) || FEED_TYPES.has(type)) return true;

  const pathname = url.pathname.toLowerCase();
  if (pathname === "/sitemap.xml") return false;
  return /(?:^|\/)(?:feed|feeds|rss|atom|rdf)(?:\/|\.|$)/i.test(pathname) ||
    /\.(?:xml|rss|atom|rdf)$/i.test(pathname);
}

export function legacyCircularRedirectTarget(input) {
  const url = input instanceof URL ? input : new URL(String(input), "https://dpsagovernmentjobs.co.za");
  const match = url.pathname.match(/(?:dpsa-)?circular-(\d{1,3})-of-(20\d{2})(?=[-/]|$)/i);
  if (!match) return null;

  const circularName = canonicalCircularName(`Circular ${match[1]} of ${match[2]}`);
  const anchor = circularArchiveAnchor(circularName);
  return anchor ? `/dpsa-vacancy-circulars/#${anchor}` : "/dpsa-vacancy-circulars/";
}

if (typeof window !== "undefined") {
  const target = isFeedRequest(window.location.href)
    ? "/"
    : document.body?.dataset.redirectNotFound === "true"
      ? legacyCircularRedirectTarget(window.location.href) ?? "/"
      : null;
  if (target) window.location.replace(target);
}
