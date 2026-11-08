/** Shared setup for the catalog and playback tests: a fake fetch with visitor data and an InnerTube client. */
import { SEARCH_PARAMS } from "../constants";
import { Innertube, VisitorData } from "../http";
import { FakeFetch, text } from "./fakeFetch";

export const VISITOR = "CgsAAAAAAAAAAAAAAAAAAAAAAAA%3D%3D";

export const swBody = (value: string) =>
  `)]}'\n${JSON.stringify([[null, null, [[[null, null, null, null, null, null, null, null, null, null, null, null, null, value]]]]])}`;

export function harness(visitor = VISITOR) {
  const fake = new FakeFetch();
  fake.on("GET", "https://www.youtube.com/sw.js_data", text(swBody(visitor)));
  const visitorData = new VisitorData(fake.fetch);
  const yt = new Innertube(fake.fetch, visitorData);
  return { fake, yt, visitorData };
}

/** Body predicate for a search request with the given filter (no filter means the mixed request). */
export const searchFor = (filter?: keyof typeof SEARCH_PARAMS) => (body: Record<string, unknown>) =>
  body.params === (filter ? SEARCH_PARAMS[filter] : undefined);

export const signal = () => new AbortController().signal;
