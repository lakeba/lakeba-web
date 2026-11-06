/** Prefixes a site path with the deploy base (e.g. /lakeba-web on GitHub Pages). */
export const href = (path: string) => `${import.meta.env.BASE_URL.replace(/\/$/, '')}${path}`;
