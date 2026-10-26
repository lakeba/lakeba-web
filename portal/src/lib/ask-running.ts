// Ask Lakeba answers being written right now, by conversation. An answer keeps
// being written when the person leaves the page (so it is there when they come
// back); only the Stop button stops it. Kept in memory: the portal runs as a
// single server process, and an answer only lives here while it is written.
export type Running = { userId: string; companyCode: string; question: string; answer: string; stop: AbortController };
export const running = new Map<string, Running>();
