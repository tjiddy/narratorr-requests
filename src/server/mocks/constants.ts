// Kept free of msw imports so the server boot can reference the base URL without
// statically bundling msw/graphql into production (narratorr-mode) builds.
export const MOCK_BASE_URL = 'http://narratorr.mock';
